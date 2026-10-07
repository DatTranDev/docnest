# Anonymous OS-image vulnerability scan

Prerequisites: Python 3.11+, internet for the initial public downloads, Docker Engine,
and the four local application images built by `python tooling/scripts/run.py up`.
These commands run on Windows x64 or Linux x64/ARM64 without registry login:

```text
python testing/checks/install_trivy.py
python testing/checks/image_os_scan.py --download-db
```

The installer pins [Trivy 0.75.0](https://github.com/aquasecurity/trivy/releases/tag/v0.75.0),
downloads its official release archive and checksum file over HTTPS, verifies the
archive SHA-256 and GitHub asset digest, and extracts only the executable. Each scan
checks that the executed executable still matches the installed binary hash.
Publisher signatures are not independently verified. The vulnerability DB comes
from the [official public GHCR repository](https://trivy.dev/docs/latest/configuration/db/).
Trivy verifies OCI blob digests; this procedure does not separately verify the DB's
publisher signature. The installer, binary and database cache stay in ignored
`.tools/trivy/`. No account is created, image uploaded, or cloud resource provisioned.

The scanner reads each locally built image by its immutable Docker image ID,
sequentially with `--image-src docker --parallel 1 --scanners vuln --pkg-types os
--offline-scan --skip-db-update --skip-java-db-update`. It does not fall back to
pulling the image from a registry. `--download-db` explicitly performs the anonymous
public DB update before scanning; omit it to repeat against the cached snapshot.

Evidence is in `testing/reports/image-os-scan.json`, with raw scanner JSON and exact-command
logs under `testing/reports/image-os/`. It includes DB timestamps, immutable image IDs,
OS-package counts, every CVE/package/installed-version/fixed-version/severity, and
a separate list of findings having a nonempty fixed version. Severity totals count
CVE/package/image combinations; `uniqueCveCount` counts distinct CVE IDs across
images. Three services share the Java runtime, so their findings can repeat.

Report `status` is `SCANNED_WITH_FINDINGS` when any severity remains; it is never
called a clean scan merely because there are no high or critical findings. The
separate `highCriticalGate` tests only those two severities. A partial four-image
run is `PENDING`, a failed or unsupported OS scan is `BLOCKED`, and their aggregate
gate remains `UNVERIFIED`. Exit 2 means a scanner/external dependency blocker,
exit 1 means high/critical advisories, and exit 0 means the requested scans completed
without high/critical advisories; inspect the report for full scope completion and
medium/low findings. Scanning fewer than all four images may still exit 0.

To scan service images while the frontend is being rebuilt, then append the final
frontend scan without losing earlier evidence:

```text
python testing/checks/image_os_scan.py --images text-editor/identity-service:local text-editor/document-service:local text-editor/processing-service:local
python testing/checks/image_os_scan.py --append --images text-editor/web:local
```

This check covers Linux OS packages in application runtime images. It excludes
Java/npm dependency advisories, infrastructure images, secret/IaC checks, and
exploitability assessment. Refresh the DB, rebuild pinned base images and repeat
the scan before a cloud rollout. An empty `FixedVersion` records what the DB knows;
it is not evidence that a finding is harmless or will never receive a fix.
