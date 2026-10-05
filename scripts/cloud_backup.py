#!/usr/bin/env python3
"""Operator-only, quiesced cloud backup and isolated recovery preparation.

No provisioning, SQL restore, reference patch execution, event replay or app startup.
Cloud operations execute only through explicit subcommands. Protected files contain
SQL/account data, capped event summaries and the private signing key; never publish them.
"""

import argparse
import base64
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
APPS = ("identity-service", "document-service", "processing-service", "web")
DBS = ("identity_db", "document_db", "processing_db")
REF_KEYS = {"provider", "bucket", "key", "generation"}


def fingerprint(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ref_identity(ref):
    if set(ref) != REF_KEYS or ref["provider"] != "GCS":
        raise ValueError("Expected exact GCS ObjectRef fields")
    bucket = ref["bucket"]
    key = ref["key"]
    if not isinstance(bucket, str) or not re.fullmatch(
        r"[a-z0-9][a-z0-9._-]{1,220}", bucket
    ):
        raise ValueError("Invalid bucket")
    if (
        not isinstance(key, str)
        or len(key) > 512
        or not key.startswith(("snapshots/", "results/"))
    ):
        raise ValueError("Invalid server object key")
    if any(char in key for char in "#?*[]\r\n\\") or any(
        part in ("", ".", "..") for part in key.split("/")
    ):
        raise ValueError("Unsafe object key")
    if not isinstance(ref["generation"], str) or not re.fullmatch(
        r"[0-9]{1,32}", ref["generation"]
    ):
        raise ValueError("Invalid generation")
    return (ref["bucket"], ref["key"], ref["generation"])


def refs_in(value):
    if isinstance(value, dict):
        if set(value) == REF_KEYS:
            ref_identity(value)
            yield value
        else:
            for item in value.values():
                yield from refs_in(item)
    elif isinstance(value, list):
        for item in value:
            yield from refs_in(item)


def rewrite_refs(value, mapping):
    """Match all four fields; preserve every envelope field, ID, key and unrelated value."""
    if isinstance(value, dict):
        if set(value) == REF_KEYS:
            identity = ref_identity(value)
            return dict(mapping.get(identity, value))
        return {key: rewrite_refs(item, mapping) for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite_refs(item, mapping) for item in value]
    return value


def run(command, *, data=None, output=None):
    try:
        result = subprocess.run(
            command,
            input=data,
            stdout=output or subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError(
            "Operator command unavailable or timed out; protected output withheld"
        ) from None
    if result.returncode:
        raise ValueError("Operator command failed; protected output withheld")
    return result.stdout


class Database:
    def __init__(self, args):
        if args.environment == "vm":
            if not args.compose_env:
                raise ValueError("VM requires an explicit protected --compose-env")
            self.prefix = [
                "docker",
                "compose",
                "--env-file",
                str(pathlib.Path(args.compose_env).resolve()),
                "-f",
                str(ROOT / "infra/compose/compose.yaml"),
                "-f",
                str(ROOT / "infra/gcp/compose.cloud.yaml"),
                "--profile",
                "app",
            ]
        else:
            if not args.kube_context:
                raise ValueError("GKE requires an explicit --kube-context")
            self.prefix = [
                "kubectl",
                "--context",
                args.kube_context,
                "-n",
                "editor-lab",
            ]
        self.environment = args.environment

    def quiesced(self):
        if self.environment == "vm":
            raw = (
                run(self.prefix + ["ps", "--all", "--format", "json"])
                .decode("utf-8")
                .strip()
            )
            rows = (
                json.loads(raw)
                if raw.startswith("[")
                else [json.loads(row) for row in raw.splitlines()]
            )
            if not set(APPS).issubset({row["Service"] for row in rows}):
                raise ValueError(
                    "Backup requires all application containers to exist and be stopped"
                )
            if any(
                row["Service"] in APPS + ("https",)
                and row["State"] not in ("exited", "dead", "created")
                for row in rows
            ):
                raise ValueError("Stop application/HTTPS containers before backup")
        else:
            deployments = json.loads(
                run(self.prefix + ["get", "deployments", *APPS, "-o", "json"])
            )["items"]
            if len(deployments) != len(APPS) or any(
                row.get("spec", {}).get("replicas", 1) != 0 for row in deployments
            ):
                raise ValueError(
                    "All application deployments must explicitly have zero replicas"
                )
            rows = json.loads(run(self.prefix + ["get", "pods", "-o", "json"]))["items"]
            if any(
                row.get("metadata", {}).get("labels", {}).get("app") in APPS
                and row.get("status", {}).get("phase") not in ("Succeeded", "Failed")
                for row in rows
            ):
                raise ValueError(
                    "Scale applications to zero and wait for their Pods to terminate"
                )

    def command(self, cli):
        shell = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec ' + cli
        if self.environment == "vm":
            return self.prefix + ["exec", "-T", "mysql", "bash", "-c", shell]
        return self.prefix + ["exec", "-i", "mysql-0", "--", "bash", "-c", shell]

    def query(self, database, sql):
        if database not in DBS:
            raise ValueError("Database is not allowlisted")
        raw = run(
            self.command(
                "mysql -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names "
                + database
            ),
            data=sql.encode("utf-8"),
        ).decode("utf-8")
        return [json.loads(row) for row in raw.splitlines() if row]


def capture_records(db):
    records = []
    # Scalar immutable references remain within Document's database.
    for table in ("document_versions", "upload_sessions"):
        where = "object_deleted_at IS NULL AND object_generation IS NOT NULL"
        for row in db.query(
            "document_db",
            "SELECT JSON_OBJECT('id',id,'ref',JSON_OBJECT('provider',storage_provider,'bucket',storage_bucket,'key',object_key,'generation',object_generation)) FROM "
            + table
            + " WHERE "
            + where
            + ";",
        ):
            records.append(
                {
                    "database": "document_db",
                    "table": table,
                    "primary": {"id": row["id"]},
                    "column": "scalar",
                    "value": row["ref"],
                    "required": table == "document_versions",
                }
            )
    for database, table, columns in (
        ("processing_db", "jobs", ("source_ref", "output_ref")),
        ("processing_db", "output_attempts", ("output_ref",)),
        ("document_db", "outbox_events", ("payload",)),
        ("processing_db", "outbox_events", ("payload",)),
        ("document_db", "idempotency_requests", ("response_body",)),
        ("processing_db", "idempotency_requests", ("response_body",)),
    ):
        primary = (
            "JSON_OBJECT('actor_user_id',actor_user_id,'operation_key',operation_key,'idempotency_key',idempotency_key)"
            if table == "idempotency_requests"
            else (
                "JSON_OBJECT('attempt_id',attempt_id)"
                if table == "output_attempts"
                else "JSON_OBJECT('id',id)"
            )
        )
        for column in columns:
            required = (
                "state IN ('QUEUED','READY','RUNNING')"
                if table == "jobs" and column == "source_ref"
                else (
                    "TRUE"
                    if table == "jobs"
                    else (
                        "published_at IS NULL" if table == "outbox_events" else "FALSE"
                    )
                )
            )
            sql = (
                "SELECT JSON_OBJECT('primary',"
                + primary
                + ",'value',"
                + column
                + ",'required',"
                + required
                + ") FROM "
                + table
                + " WHERE "
                + column
                + " IS NOT NULL;"
            )
            for row in db.query(database, sql):
                records.append(
                    {
                        "database": database,
                        "table": table,
                        "primary": row["primary"],
                        "column": column,
                        "value": row["value"],
                        "required": bool(row["required"]),
                    }
                )
    return records


def protected_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary.chmod(0o600)
    temporary.replace(path)


def backup(args):
    db = Database(args)
    db.quiesced()
    directory = pathlib.Path(args.directory).resolve()
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    objects = directory / "objects"
    objects.mkdir(mode=0o700)
    images = json.loads(pathlib.Path(args.images).read_text(encoding="utf-8"))
    if set(images) != set(APPS) or any(
        not re.fullmatch(r"[a-z0-9._:/-]+@sha256:[a-f0-9]{64}", value)
        for value in images.values()
    ):
        raise ValueError("Image manifest requires four immutable registry digests")
    secret = re.fullmatch(
        r"projects/([^/]+)/secrets/(editor-jwt)/versions/([0-9]+)",
        args.jwt_secret_version,
    )
    if not secret or secret[1] != args.project:
        raise ValueError(
            "JWT secret must specify this project and a numeric version, never latest"
        )
    records = capture_records(db)
    required = {}
    for record in records:
        if record["required"]:
            for ref in refs_in(record["value"]):
                required[ref_identity(ref)] = ref
    hashes = {
        ref_identity(row["ref"]): row["sha256"]
        for row in db.query(
            "document_db",
            "SELECT JSON_OBJECT('ref',JSON_OBJECT('provider',storage_provider,'bucket',storage_bucket,'key',object_key,'generation',object_generation),'sha256',native_sha256) FROM document_versions WHERE object_deleted_at IS NULL;",
        )
    }
    for row in db.query(
        "processing_db",
        "SELECT JSON_OBJECT('ref',source_ref,'sha256',source_native_sha256) FROM jobs WHERE state IN ('QUEUED','READY','RUNNING');",
    ):
        identity = ref_identity(row["ref"])
        if identity in hashes and hashes[identity] != row["sha256"]:
            raise ValueError("Source hash disagreement between immutable references")
        hashes[identity] = row["sha256"]
    entries = []
    for identity, ref in sorted(required.items()):
        name = hashlib.sha256(json.dumps(identity).encode("utf-8")).hexdigest() + ".bin"
        target = objects / name
        run(
            [
                "gcloud",
                "storage",
                "cp",
                "--project",
                args.project,
                "gs://" + ref["bucket"] + "/" + ref["key"] + "#" + ref["generation"],
                str(target),
            ]
        )
        digest = fingerprint(target)
        if identity in hashes and digest != hashes[identity]:
            raise ValueError(
                "Native content differs from committed hash; backup rejected"
            )
        entries.append(
            {"ref": ref, "file": name, "sha256": digest, "bytes": target.stat().st_size}
        )
    with (directory / "databases.sql").open("wb") as output:
        run(
            db.command(
                "mysqldump -uroot --default-character-set=utf8mb4 --hex-blob --single-transaction --routines --events --set-gtid-purged=OFF --databases identity_db document_db processing_db"
            ),
            output=output,
        )
    with (directory / "identity-key.pem").open("wb") as output:
        run(
            [
                "gcloud",
                "secrets",
                "versions",
                "access",
                secret[3],
                "--secret=editor-jwt",
                "--project",
                args.project,
            ],
            output=output,
        )
    if db.environment == "vm":
        mounted_key = directory / "mounted-key-verification.partial"
        run(
            db.prefix
            + ["cp", "identity-service:/data/keys/identity-key.pem", str(mounted_key)]
        )
        same_key = fingerprint(mounted_key) == fingerprint(
            directory / "identity-key.pem"
        )
        mounted_key.unlink()
    else:
        deployed = json.loads(
            run(db.prefix + ["get", "secret", "editor-jwt", "-o", "json"])
        )
        same_key = hashlib.sha256(
            base64.b64decode(deployed["data"]["identity-key.pem"], validate=True)
        ).hexdigest() == fingerprint(directory / "identity-key.pem")
    if not same_key:
        raise ValueError(
            "Recorded Secret Manager version differs from deployed signing key"
        )
    versions = {
        database: db.query(
            database,
            "SELECT JSON_OBJECT('version',version,'checksum',checksum,'success',success) FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;",
        )
        for database in DBS
    }
    manifest = {
        "format": 1,
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "project": args.project,
        "quiesced": True,
        "images": images,
        "jwtSecretVersion": args.jwt_secret_version,
        "flyway": versions,
        "sqlSha256": fingerprint(directory / "databases.sql"),
        "keySha256": fingerprint(directory / "identity-key.pem"),
        "objects": entries,
        "records": records,
        "note": "Physical version objects, active job sources, nonnull job results and pending outbox references copied. Historical deleted source/cleaned attempt references remain archived metadata.",
    }
    protected_json(directory / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "operation": "BACKUP_CAPTURED",
                "objects": len(entries),
                "databases": 3,
                "cloudRestore": "NOT_RUN",
            }
        )
    )


def load_manifest(directory):
    directory = pathlib.Path(directory).resolve()
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != 1 or not manifest.get("quiesced"):
        raise ValueError("Unrecognized or nonquiesced archive")
    if (
        fingerprint(directory / "databases.sql") != manifest["sqlSha256"]
        or fingerprint(directory / "identity-key.pem") != manifest["keySha256"]
    ):
        raise ValueError("Archive SQL/key integrity mismatch")
    for item in manifest["objects"]:
        ref_identity(item["ref"])
        if not re.fullmatch(r"[a-f0-9]{64}\.bin", item["file"]):
            raise ValueError("Archive object path rejected")
        target = directory / "objects" / item["file"]
        if (
            target.is_symlink()
            or target.stat().st_size != item["bytes"]
            or fingerprint(target) != item["sha256"]
        ):
            raise ValueError("Archive object integrity mismatch")
    return directory, manifest


def restore_objects(args):
    if not args.confirm_isolated_restore:
        raise ValueError(
            "Requires --confirm-isolated-restore after reviewing isolated target buckets"
        )
    directory, manifest = load_manifest(args.directory)
    target_buckets = {
        "snapshots": args.target_snapshots_bucket,
        "results": args.target_results_bucket,
    }
    original = {item["ref"]["bucket"] for item in manifest["objects"]}
    if len(set(target_buckets.values())) != 2 or any(
        bucket in original for bucket in target_buckets.values()
    ):
        raise ValueError(
            "Restore targets must be distinct new buckets, separate from every live source bucket"
        )
    mapping_file = directory / "generation-remap.json"
    mapping = (
        json.loads(mapping_file.read_text(encoding="utf-8"))
        if mapping_file.exists()
        else {
            "sqlSha256": manifest["sqlSha256"],
            "project": args.project,
            "objects": [],
        }
    )
    if (
        mapping["sqlSha256"] != manifest["sqlSha256"]
        or mapping["project"] != args.project
    ):
        raise ValueError("Existing recovery map belongs to another archive/project")
    completed = {ref_identity(item["original"]): item for item in mapping["objects"]}
    for item in manifest["objects"]:
        source = item["ref"]
        identity = ref_identity(source)
        bucket = target_buckets[source["key"].split("/", 1)[0]]
        ref_identity(dict(source, bucket=bucket))
        destination = "gs://" + bucket + "/" + source["key"]
        if identity in completed:
            restored = completed[identity]["restored"]
            if restored["bucket"] != bucket:
                raise ValueError("Existing recovery map uses another target bucket")
        else:
            # Aborts rather than overwriting a preexisting target; no generation can be invented.
            run(
                [
                    "gcloud",
                    "storage",
                    "cp",
                    "--project",
                    args.project,
                    "--if-generation-match=0",
                    str(directory / "objects" / item["file"]),
                    destination,
                ]
            )
            metadata = json.loads(
                run(
                    [
                        "gcloud",
                        "storage",
                        "objects",
                        "describe",
                        "--project",
                        args.project,
                        destination,
                        "--format=json",
                    ]
                )
            )
            restored = dict(
                source, bucket=bucket, generation=str(metadata["generation"])
            )
            ref_identity(restored)
        verify = directory / "restore-verification.partial"
        run(
            [
                "gcloud",
                "storage",
                "cp",
                "--project",
                args.project,
                destination + "#" + restored["generation"],
                str(verify),
            ]
        )
        if fingerprint(verify) != item["sha256"]:
            raise ValueError("Restored generation failed content verification")
        verify.unlink()
        if identity not in completed:
            mapping["objects"].append(
                {"original": source, "restored": restored, "sha256": item["sha256"]}
            )
            protected_json(mapping_file, mapping)
    protected_json(mapping_file, mapping)
    print(
        json.dumps(
            {
                "operation": "OBJECTS_RESTORED_TO_ISOLATED_BUCKETS",
                "objects": len(mapping["objects"]),
                "sqlNotApplied": True,
            }
        )
    )


def sql_text(value):
    return "CONVERT(0x" + str(value).encode("utf-8").hex() + " USING utf8mb4)"


def sql_json(value):
    return (
        "CAST("
        + sql_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        + " AS JSON)"
    )


def reference_patch(manifest, mapping):
    replacements = {}
    for entry in mapping["objects"]:
        old = entry["original"]
        new = entry["restored"]
        identity = ref_identity(old)
        ref_identity(new)
        if old["key"] != new["key"] or old["bucket"] == new["bucket"]:
            raise ValueError(
                "Recovery must preserve object key and change to an isolated bucket"
            )
        replacements[identity] = new
    expected = {ref_identity(item["ref"]) for item in manifest["objects"]}
    if set(replacements) != expected:
        raise ValueError("Complete verified generation mapping required")
    output = {
        database: [
            "-- Operator-reviewed isolated restore reference patch; no cross-database queries.",
            "USE " + database + ";",
            "START TRANSACTION;",
        ]
        for database in DBS
    }
    allowed = {
        "document_db": {
            "document_versions": {"scalar"},
            "upload_sessions": {"scalar"},
            "outbox_events": {"payload"},
            "idempotency_requests": {"response_body"},
        },
        "processing_db": {
            "jobs": {"source_ref", "output_ref"},
            "output_attempts": {"output_ref"},
            "outbox_events": {"payload"},
            "idempotency_requests": {"response_body"},
        },
        "identity_db": {},
    }
    for record in manifest["records"]:
        database, table, column = (
            record[key] for key in ("database", "table", "column")
        )
        if database not in allowed or column not in allowed[database].get(table, set()):
            raise ValueError("Reference catalog table/column rejected")
        primary = record["primary"]
        primary_fields = (
            {"actor_user_id", "operation_key", "idempotency_key"}
            if table == "idempotency_requests"
            else ({"attempt_id"} if table == "output_attempts" else {"id"})
        )
        if set(primary) != primary_fields:
            raise ValueError("Reference catalog primary key rejected")
        where = " AND ".join(
            key + "=" + sql_text(value) for key, value in primary.items()
        )
        old = record["value"]
        new = rewrite_refs(old, replacements)
        if record["required"] and any(
            ref_identity(ref) not in replacements for ref in refs_in(old)
        ):
            raise ValueError("A required reference was not restored")
        if old == new:
            continue
        if column == "scalar":
            guard = " AND ".join(
                field + "=" + sql_text(old[key])
                for field, key in (
                    ("storage_provider", "provider"),
                    ("storage_bucket", "bucket"),
                    ("object_key", "key"),
                    ("object_generation", "generation"),
                )
            )
            assignment = (
                "storage_bucket="
                + sql_text(new["bucket"])
                + ",object_generation="
                + sql_text(new["generation"])
            )
        else:
            guard = column + "=" + sql_json(old)
            assignment = column + "=" + sql_json(new)
        output[database].append(
            "UPDATE "
            + table
            + " SET "
            + assignment
            + " WHERE "
            + where
            + " AND "
            + guard
            + ";"
        )
    output["document_db"].append(
        "UPDATE upload_sessions SET resumable_uri=NULL,validation_lease_until=NULL,validation_lease_owner=NULL,state=IF(state='COMMITTED','COMMITTED','ABANDONED');"
    )
    for rows in output.values():
        rows.append("COMMIT;")
    return {database: "\n".join(rows) + "\n" for database, rows in output.items()}


def prepare_remap(args):
    directory, manifest = load_manifest(args.directory)
    mapping = json.loads(
        (directory / "generation-remap.json").read_text(encoding="utf-8")
    )
    if mapping["sqlSha256"] != manifest["sqlSha256"]:
        raise ValueError("Generation map belongs to another SQL snapshot")
    for database, content in reference_patch(manifest, mapping).items():
        path = directory / (database + "-reference-patch.sql")
        path.write_text(content, encoding="utf-8")
        path.chmod(0o600)
    print(
        "PREPARED three database-specific SQL files; review before applying to isolated restored databases. No SQL executed."
    )


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=("backup", "restore-objects", "prepare-remap")
    )
    parser.add_argument("--directory", required=True)
    parser.add_argument("--project")
    parser.add_argument("--environment", choices=("vm", "gke"))
    parser.add_argument("--compose-env")
    parser.add_argument("--kube-context")
    parser.add_argument("--images")
    parser.add_argument("--jwt-secret-version")
    parser.add_argument("--target-snapshots-bucket")
    parser.add_argument("--target-results-bucket")
    parser.add_argument("--confirm-isolated-restore", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "backup":
            if not all(
                (args.project, args.environment, args.images, args.jwt_secret_version)
            ):
                raise ValueError(
                    "Backup requires project/environment/images/numeric JWT secret version"
                )
            backup(args)
        elif args.command == "restore-objects":
            if not all(
                (args.project, args.target_snapshots_bucket, args.target_results_bucket)
            ):
                raise ValueError(
                    "Restore requires project and two reviewed isolated target buckets"
                )
            restore_objects(args)
        else:
            prepare_remap(args)
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError):
        raise SystemExit(
            "FAILED: archive/command/integrity/precondition rejected; protected data withheld. Inspect protected artifacts locally."
        ) from None


if __name__ == "__main__":
    main()
