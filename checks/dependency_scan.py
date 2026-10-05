"""Read-only OSV scan of resolved Maven runtime artifacts; npm audit runs separately.

Sends public package coordinates/versions only. No code, credentials or application data.
"""

import io, json, pathlib, subprocess, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
scratch = ROOT / ".tools/dependency-scan"
scratch.mkdir(parents=True, exist_ok=True)
repo = pathlib.Path.home() / ".m2/repository"
index = {}
for p in repo.rglob("*.jar"):
    parts = p.relative_to(repo).parts
    if len(parts) >= 4:
        index.setdefault(p.name, set()).add(
            (".".join(parts[:-3]) + ":" + parts[-3], parts[-2])
        )
artifacts = set()
unresolved = []
for service in ["identity", "document", "processing"]:
    jar = (
        ROOT / f"services/{service}-service/target/{service}-service-1.0.0-SNAPSHOT.jar"
    )
    with zipfile.ZipFile(jar) as app:
        for name in app.namelist():
            if not name.startswith("BOOT-INF/lib/") or not name.endswith(".jar"):
                continue
            filename = name.rsplit("/", 1)[1]
            if filename.startswith("editor-common-"):
                continue
            found = set()
            with zipfile.ZipFile(io.BytesIO(app.read(name))) as lib:
                for props in lib.namelist():
                    if props.startswith("META-INF/maven/") and props.endswith(
                        "/pom.properties"
                    ):
                        fields = {
                            line.split("=", 1)[0]: line.split("=", 1)[1].strip()
                            for line in lib.read(props).decode("utf-8").splitlines()
                            if "=" in line and not line.startswith("#")
                        }
                        if {
                            "groupId",
                            "artifactId",
                            "version",
                        } <= fields.keys() and filename.startswith(
                            fields["artifactId"] + "-" + fields["version"]
                        ):
                            found.add(
                                (
                                    fields["groupId"] + ":" + fields["artifactId"],
                                    fields["version"],
                                )
                            )
            if not found:
                found = index.get(filename, set())
            if not found and filename.startswith("spring-boot-jarmode-tools-"):
                found = {
                    (
                        "org.springframework.boot:spring-boot-jarmode-tools",
                        filename.removeprefix(
                            "spring-boot-jarmode-tools-"
                        ).removesuffix(".jar"),
                    )
                }
            if len(found) != 1:
                unresolved.append(filename)
            else:
                artifacts.update(found)
findings = []
artifacts = sorted(artifacts)
for offset in range(0, len(artifacts), 100):
    batch = artifacts[offset : offset + 100]
    request = scratch / "request.json"
    response = scratch / "response.json"
    request.write_text(
        json.dumps(
            {
                "queries": [
                    {
                        "package": {"ecosystem": "Maven", "name": name},
                        "version": version,
                    }
                    for name, version in batch
                ]
            }
        ),
        encoding="utf-8",
    )
    subprocess.run(
        [
            "curl.exe" if __import__("os").name == "nt" else "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "10",
            "--max-time",
            "60",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@" + str(request),
            "--output",
            str(response),
            "https://api.osv.dev/v1/querybatch",
        ],
        check=True,
    )
    answers = json.loads(response.read_text())["results"]
    assert len(answers) == len(batch)
    assert not any(
        answer.get("next_page_token") for answer in answers
    ), "Pagination must be handled before calling this a complete scan"
    for (name, version), answer in zip(batch, answers):
        if answer.get("vulns"):
            findings.append(
                {"package": name, "version": version, "advisories": answer["vulns"]}
            )
report = {
    "status": "FINDINGS" if findings else ("UNVERIFIED" if unresolved else "PASS"),
    "source": "https://api.osv.dev/v1/querybatch",
    "scope": "resolved Maven runtime dependencies in three packaged jars; excludes OS/base images and tests",
    "packagesQueried": len(artifacts),
    "unresolved": sorted(set(unresolved)),
    "findings": findings,
}
(ROOT / "reports/maven-dependency-scan.json").write_text(
    json.dumps(report, indent=2), encoding="utf-8"
)
print(
    report["status"]
    + ": "
    + str(len(artifacts))
    + " Maven runtime packages queried; "
    + str(len(findings))
    + " packages with advisories; "
    + str(len(set(unresolved)))
    + " unresolved"
)
raise SystemExit(0 if report["status"] == "PASS" else 1)
