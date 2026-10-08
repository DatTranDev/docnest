"""Actual isolated MySQL 8.4 recovery-reference integration; no cloud/GCS calls.

Creates a new random container with no host ports or app volumes. Credentials stay in
the child environment; only counts/assertion names are reported. Always removes it.
"""

import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import secrets
import subprocess
import time
import uuid
from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "cloud_backup", ROOT / "tooling/scripts/cloud_backup.py"
)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
IMAGE = "mysql:8.4.7@sha256:0426ec38c7a10aa45ba383887df7878f74ee70e2fd589c7b69207f3577901903"
CONTAINER = "editor-restore-sql-check-" + uuid.uuid4().hex[:12]
CHECKS = []


def command(args, data=None, *, required=True):
    result = subprocess.run(args, input=data, capture_output=True, timeout=120)
    if required and result.returncode:
        raise AssertionError("Isolated command failed; protected output withheld")
    return result


def sql(source):
    return command(
        [
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "bash",
            "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names',
        ],
        source.encode("utf-8"),
    ).stdout.decode("utf-8")


class IsolatedDatabase:
    def query(self, database, query):
        if database not in backup.DBS:
            raise AssertionError("Test database outside allowlist")
        return [
            json.loads(line)
            for line in sql("USE " + database + ";\n" + query).splitlines()
            if line
        ]


def identifier():
    return str(uuid.uuid4())


def fixture():
    owner, doc, version, upload, draft, job, queued, attempt, idem = [
        identifier() for _ in range(9)
    ]
    original_snapshot = {
        "provider": "GCS",
        "bucket": "source-private-snapshots",
        "key": f"snapshots/{doc}/{upload}.tedoc",
        "generation": "12345678901234567",
    }
    original_result = {
        "provider": "GCS",
        "bucket": "source-private-results",
        "key": f"results/{job}/{attempt}.html",
        "generation": "12345678901234568",
    }
    restored_snapshot = dict(
        original_snapshot,
        bucket="isolated-private-snapshots",
        generation="22345678901234567",
    )
    restored_result = dict(
        original_result,
        bucket="isolated-private-results",
        generation="22345678901234568",
    )
    raw = b"backup-object-payload"
    native_hash = hashlib.sha256(raw).hexdigest()
    text = "Tiếng Việt 👨‍👩‍👧‍👦 <>& '\\ newline\n二"
    saved = json.loads(
        (
            ROOT / "docs/contracts/events/document.version.saved.v1.example.json"
        ).read_text()
    )
    saved["eventId"] = identifier()
    saved["payload"].update(
        documentId=doc,
        versionId=version,
        ownerUserId=owner,
        actorUserId=owner,
        objectRef=original_snapshot,
        nativeSha256=native_hash,
        nativeBytes=len(raw),
        textUtf8Bytes=0,
        utf16Length=0,
        logicalLines=1,
    )
    completed = json.loads(
        (
            ROOT / "docs/contracts/events/processing.job.completed.v1.example.json"
        ).read_text()
    )
    completed["eventId"] = identifier()
    completed["payload"].update(
        jobId=job,
        documentId=doc,
        requestedByUserId=owner,
        outputRef=original_result,
        type="EXPORT_HTML",
        summary=None,
    )
    requested = json.loads(
        (
            ROOT / "docs/contracts/events/processing.job.requested.v1.example.json"
        ).read_text()
    )
    requested["eventId"] = identifier()
    requested["payload"].update(jobId=queued, documentId=doc, revision=1)
    S = backup.sql_text
    J = backup.sql_json
    source = [
        "SET time_zone='+00:00';",
        "USE identity_db;",
        f"INSERT INTO users(id,email_norm,password_hash,display_name,created_at,updated_at) VALUES({S(owner)},'recovery@example.test','fixture-hash',{S(text)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));",
        "USE document_db;",
        f"INSERT INTO owner_workspaces(owner_user_id,created_at) VALUES({S(owner)},UTC_TIMESTAMP(6));",
        f"INSERT INTO documents(id,owner_user_id,title,created_at,updated_at) VALUES({S(doc)},{S(owner)},{S(text)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));",
        f"INSERT INTO document_versions(id,document_id,revision,storage_provider,storage_bucket,object_key,object_generation,native_sha256,native_bytes,text_utf8_bytes,utf16_length,logical_lines,created_by_user_id,created_at,last_access_at) VALUES({S(version)},{S(doc)},1,'GCS',{S(original_snapshot['bucket'])},{S(original_snapshot['key'])},{S(original_snapshot['generation'])},{S(native_hash)},{len(raw)},0,0,1,{S(owner)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));",
        f"UPDATE documents SET head_revision=1,head_version_id={S(version)} WHERE id={S(doc)};",
        f"INSERT INTO upload_sessions(id,document_id,actor_user_id,expected_head_revision,expected_sha256,expected_native_bytes,storage_provider,storage_bucket,object_key,object_generation,state,committed_version_id,created_at,expires_at,resumable_uri) VALUES({S(upload)},{S(doc)},{S(owner)},0,{S(native_hash)},{len(raw)},'GCS',{S(original_snapshot['bucket'])},{S(original_snapshot['key'])},{S(original_snapshot['generation'])},'COMMITTED',{S(version)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 15 MINUTE,'https://private.invalid/session-capability');",
        f"INSERT INTO upload_sessions(id,document_id,actor_user_id,expected_head_revision,expected_sha256,expected_native_bytes,storage_provider,storage_bucket,object_key,object_generation,state,validation_lease_until,validation_lease_owner,created_at,expires_at,resumable_uri) VALUES({S(draft)},{S(doc)},{S(owner)},1,{S(native_hash)},{len(raw)},'GCS',{S(original_snapshot['bucket'])},{S('snapshots/'+doc+'/'+draft+'.tedoc')},'777','VALIDATING',UTC_TIMESTAMP(6)+INTERVAL 2 MINUTE,{S(identifier())},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 15 MINUTE,'https://private.invalid/another-capability');",
        f"INSERT INTO outbox_events(event_id,aggregate_id,aggregate_revision,topic,event_key,payload,created_at,next_attempt_at) VALUES({S(saved['eventId'])},{S(doc)},1,'document.version.saved.v1',{S(doc)},{J(saved)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));",
        f"INSERT INTO idempotency_requests(actor_user_id,operation_key,idempotency_key,request_sha256,response_status,response_body,created_at,expires_at) VALUES({S(owner)},'commitVersion',{S(idem)},{S('a'*64)},200,{J({'title':text,'objectRef':original_snapshot})},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 1 DAY);",
        "USE processing_db;",
        f"INSERT INTO requester_queues(requester_user_id,created_at) VALUES({S(owner)},UTC_TIMESTAMP(6));",
    ]
    for job_id, state, output in [
        (job, "SUCCEEDED", original_result),
        (queued, "QUEUED", None),
    ]:
        source.append(
            f"INSERT INTO jobs(id,document_id,document_revision,requested_by_user_id,job_type,state,source_ref,source_native_sha256,next_attempt_at,created_at,deadline_at,output_ref,output_bytes,summary_json) VALUES({S(job_id)},{S(doc)},1,{S(owner)},'EXPORT_HTML',{S(state)},{J(original_snapshot)},{S(native_hash)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 15 MINUTE,{J(output) if output else 'NULL'},{32 if output else 'NULL'},{J({'wordCount':1,'sampleText':text})});"
        )
    source += [
        f"INSERT INTO output_attempts(attempt_id,job_id,output_key,state,output_ref,created_at,updated_at) VALUES({S(attempt)},{S(job)},{S(original_result['key'])},'PUBLISHED',{J(original_result)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));"
    ]
    for event, topic in [
        (completed, "processing.job.completed.v1"),
        (requested, "processing.job.requested.v1"),
    ]:
        source.append(
            f"INSERT INTO outbox_events(event_id,aggregate_id,aggregate_revision,topic,event_key,payload,created_at,next_attempt_at) VALUES({S(event['eventId'])},{S(doc)},1,{S(topic)},{S(doc)},{J(event)},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));"
        )
    source.append(
        f"INSERT INTO idempotency_requests(actor_user_id,operation_key,idempotency_key,request_sha256,response_status,response_body,created_at,expires_at) VALUES({S(owner)},'createJob',{S(idem)},{S('b'*64)},201,{J({'displayName':text,'result':original_result})},UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 1 DAY);"
    )
    sql("\n".join(source))
    return {
        "old": [original_snapshot, original_result],
        "new": [restored_snapshot, restored_result],
        "owner": owner,
        "doc": doc,
        "version": version,
        "upload": upload,
        "draft": draft,
        "job": job,
        "queued": queued,
        "attempt": attempt,
        "idem": idem,
        "text": text,
        "hash": native_hash,
        "events": [saved, completed, requested],
    }


def check_recovery(data):
    db = IsolatedDatabase()
    records = backup.capture_records(db)
    CHECKS.append(
        "All reference columns captured from current V1/V2 plus Processing V3 schemas, including attempt_id"
    )
    manifest = {"objects": [{"ref": ref} for ref in data["old"]], "records": records}
    mapping = {
        "objects": [
            {"original": old, "restored": new}
            for old, new in zip(data["old"], data["new"])
        ]
    }
    patches = backup.reference_patch(manifest, mapping)
    for database in backup.DBS:
        sql(patches[database])
    CHECKS.append(
        "Three generated database-specific SQL files execute successfully against original schemas"
    )
    fresh = backup.capture_records(db)
    replacements = {
        backup.ref_identity(old): new for old, new in zip(data["old"], data["new"])
    }
    for row in fresh:
        previous = next(
            old
            for old in records
            if (old["database"], old["table"], old["column"], old["primary"])
            == (row["database"], row["table"], row["column"], row["primary"])
        )
        assert row["value"] == backup.rewrite_refs(previous["value"], replacements)
    CHECKS.append(
        "Scalar versions/uploads, job source/result, output-attempt, outbox and idempotency JSON references match exact remap"
    )
    for event, topic in zip(
        data["events"],
        [
            "document.version.saved.v1",
            "processing.job.completed.v1",
            "processing.job.requested.v1",
        ],
    ):
        database = "document_db" if topic.startswith("document.") else "processing_db"
        row = db.query(
            database,
            "SELECT payload FROM outbox_events WHERE event_id="
            + backup.sql_text(event["eventId"])
            + ";",
        )[0]
        assert row == backup.rewrite_refs(event, replacements)
        assert row["eventId"] == event["eventId"]
        schema = json.loads(
            (ROOT / f"docs/contracts/events/{topic}.schema.json").read_text()
        )
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(row)
    CHECKS.append(
        "All three business event envelopes retain eventId and every nonref field and satisfy authoritative schemas"
    )
    uploads = db.query(
        "document_db",
        "SELECT JSON_OBJECT('id',id,'state',state,'capability',resumable_uri,'lease',validation_lease_owner,'until',validation_lease_until) FROM upload_sessions ORDER BY id;",
    )
    assert all(
        row["capability"] is None and row["lease"] is None and row["until"] is None
        for row in uploads
    )
    assert (
        next(row for row in uploads if row["id"] == data["upload"])["state"]
        == "COMMITTED"
    )
    assert (
        next(row for row in uploads if row["id"] == data["draft"])["state"]
        == "ABANDONED"
    )
    CHECKS.append(
        "Committed retry state retained; unfinished ticket abandoned; every session capability and validation lease cleared"
    )
    user = db.query(
        "identity_db",
        "SELECT JSON_OBJECT('displayName',display_name,'id',id) FROM users;",
    )[0]
    assert user == {"displayName": data["text"], "id": data["owner"]}
    version = db.query(
        "document_db",
        "SELECT JSON_OBJECT('sha256',native_sha256,'key',object_key,'generation',object_generation) FROM document_versions;",
    )[0]
    assert version["sha256"] == data["hash"] and version["key"] == data["old"][0]["key"]
    assert version["generation"] == data["new"][0]["generation"]
    for database in ["document_db", "processing_db"]:
        response = db.query(
            database, "SELECT response_body FROM idempotency_requests;"
        )[0]
        assert response.get("title", response.get("displayName")) == data["text"]
    summaries = db.query("processing_db", "SELECT summary_json FROM jobs;")
    assert all(summary["sampleText"] == data["text"] for summary in summaries)
    traces = db.query(
        "processing_db", "SELECT JSON_OBJECT('traceId',trace_id) FROM jobs;"
    )
    assert traces and all(row["traceId"] == "a" * 32 for row in traces)
    CHECKS.append(
        "Processing V3 originating trace survives generation-reference restoration"
    )
    CHECKS.append(
        "Unicode/quotes/newline/emoji, signing-account data, native hash/key and >2^53 generation strings preserved"
    )
    # Replay of the SQL files is safe: exact-old-value guards stop a second remap.
    for database in backup.DBS:
        sql(patches[database])
    assert backup.capture_records(db) == fresh
    CHECKS.append(
        "Second application is harmless; original-reference guards prevent repeated or unrelated rewrites"
    )


def main():
    started = time.monotonic()
    created = False
    success = False
    cleanup = False
    failure = None
    env = os.environ.copy()
    env["MYSQL_ROOT_PASSWORD"] = secrets.token_hex(32)
    try:
        result = subprocess.run(
            [
                "docker",
                "run",
                "--detach",
                "--name",
                CONTAINER,
                "--memory=640m",
                "--cpus=1",
                "--env",
                "MYSQL_ROOT_PASSWORD",
                IMAGE,
                "--innodb-buffer-pool-size=64M",
                "--max-connections=20",
            ],
            env=env,
            capture_output=True,
            timeout=30,
        )
        if result.returncode:
            raise AssertionError("Isolated MySQL container unavailable")
        created = True
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            probe = command(
                [
                    "docker",
                    "exec",
                    CONTAINER,
                    "bash",
                    "-c",
                    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -uroot --silent',
                ],
                required=False,
            )
            if probe.returncode == 0:
                try:
                    version = sql("SELECT VERSION();").strip()
                    if version.startswith("8.4."):
                        break
                except AssertionError:
                    pass
            time.sleep(1)
        else:
            raise AssertionError("Isolated MySQL did not become ready")
        CHECKS.append(
            "Random no-port/no-volume MySQL8.4.7 container ready with bounded640MiB/oneCPU"
        )
        migrations = []
        for database in backup.DBS:
            service = database.removesuffix("_db")
            migrations.append(
                "CREATE DATABASE "
                + database
                + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; USE "
                + database
                + ";"
            )
            migrations.extend(
                path.read_text(encoding="utf-8")
                for path in sorted((ROOT / "backend/schema" / service).glob("V*.sql"))
            )
        sql("\n".join(migrations))
        data = fixture()
        sql("USE processing_db; UPDATE jobs SET trace_id='" + "a" * 32 + "';")
        check_recovery(data)
        success = True
    except (AssertionError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        failure = (
            type(error).__name__
            + ": integration failed; protected data/output withheld"
        )
    finally:
        if created:
            removed = command(
                ["docker", "rm", "--force", "--volumes", CONTAINER], required=False
            )
            cleanup = removed.returncode == 0
        else:
            cleanup = True
        report = {
            "status": "PASS" if success and cleanup else "FAIL",
            "scope": "actual new isolated MySQL8.4.7; preserved V1/V2 plus Processing V3; no cloud/GCS execution",
            "checks": CHECKS,
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "isolatedContainerRemoved": cleanup,
            "cloudBackupRestore": "NOT_RUN",
        }
        if failure:
            report["failure"] = failure
        (ROOT / "testing/reports/cloud-backup-mysql.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
    print(json.dumps(report))
    raise SystemExit(0 if success and cleanup else 1)


if __name__ == "__main__":
    main()
