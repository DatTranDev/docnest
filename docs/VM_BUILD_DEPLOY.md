# One-button VM build and deployment

The manual **Build & deploy VM** workflow runs core CI, fresh MySQL bootstrap,
real-service smoke, migration-only and Worker checks plus the six-image
build/scan/publication workflow, then updates one already provisioned VM over IAP.
It creates no VM, disk, bucket or billing link. Use only `main` and protect the
`cloud-lab` environment. Build-only remains available separately.

The lab has a maintenance window during the quiesced backup and rollout. All five
databases, required GCS object generations, CRDT records, the stable signing-key
version and previous digests are captured by the existing cloud backup helper.
Only an age-encrypted archive is uploaded to the private backups bucket. Keep the
USD 300 total budget and bucket retention; capture cost and duration depend on data
volume. Remote restore must be tested before relying on the archive.

## 1. Finish the existing VM installation

All six application containers must already exist and be healthy, including Web.
MySQL, Kafka and Redis remain on their current volumes. HTTPS must work through
the configured public origin. The existing `/opt/editor/cloud.env` must be owned
by root with mode 600. Keep its secrets, Google Client ID, quota, bucket names and
optional Stripe sandbox configuration. The deployed Google Client ID must equal
the GitHub `cloud-lab` value used to build Web; a mismatch aborts before downtime.

The Compose cloud overlay now explicitly passes the mounted JWT path as a startup
argument, fixing the cloud profile's `/run/secrets` default. Never generate a new
key during deployment. `/opt/editor/infra/gcp/Caddyfile` is the canonical operator
TLS configuration and remains in place across releases.

## 2. Configure the deployment identity in Cloud Shell

Run as the provisioning operator, not the runtime VM service account. Existing
OIDC pool/provider `editor-ci/github` must restrict the intended repository/main.
Update source without resetting your ignored Terraform variables or state:

```bash
cd ~/docnest
git pull --ff-only
bash tooling/scripts/setup_vm_deploy.sh YOUR_PROJECT YOUR_ZONE editor-lab YOUR_OWNER/YOUR_REPO
```

This creates `editor-vm-deploy` if missing and grants Compute Viewer, OS Admin Login
on the specific VM, IAP SSH limited to its inspected internal IP and port 22, and
Service Account User on its attached runtime account. The account can impersonate
the runtime identity after SSH; treat it as privileged VM administration. It has
no Terraform administration or registry write role. It receives OIDC access for
the same repository and needs no downloaded Google service-account key.

If local tracked edits block `git pull`, preserve them; do not reset the checkout
or overwrite your repaired billing configuration merely to run this script.
Download the script from the reviewed commit into a separate directory instead.

Add the script's three printed values to **GitHub Settings → Environments →
cloud-lab → Environment variables**:

| Variable                        | Value                                                   |
| ------------------------------- | ------------------------------------------------------- |
| `GCP_VM_DEPLOY_SERVICE_ACCOUNT` | `editor-vm-deploy@YOUR_PROJECT.iam.gserviceaccount.com` |
| `GCP_ZONE`                      | Existing VM zone, e.g. `asia-southeast1-a`              |
| `GCP_VM_INSTANCE`               | `editor-lab`                                            |

Keep existing `GCP_PROJECT`, `GCP_REGION`, `GCP_WIF_PROVIDER`,
`GCP_CI_SERVICE_ACCOUNT` and `GOOGLE_CLIENT_ID`. Restrict environment branches to
`main`; if required reviewers are enabled, the workflow still waits for that
environment approval. Re-run setup after recreating a VM with another internal IP.

## 3. Generate a backup decryption key outside the VM

In Cloud Shell:

```bash
sudo apt-get update
sudo apt-get install -y age
umask 077
mkdir -p "$HOME/.docnest-secrets"
chmod 700 "$HOME/.docnest-secrets"
if [ ! -s "$HOME/.docnest-secrets/backup-age.key" ]; then
  age-keygen -o "$HOME/.docnest-secrets/backup-age.key"
fi
age-keygen -y "$HOME/.docnest-secrets/backup-age.key"
```

The last line is a public recipient starting `age1`; copy only that recipient to
the VM. Keep the private `backup-age.key` in secure storage outside the runtime
VM and CI. It is required to decrypt backups; do not paste it into logs or GitHub.

## 4. Prepare the VM once

SSH to the existing VM with the operator identity. Fetch the reviewed setup helper
without checking out/resetting the live Compose configuration:

```bash
cd /opt/editor
git fetch origin main
git show origin/main:tooling/scripts/setup_vm_runtime.sh > /tmp/docnest-setup-runtime.sh
read -r -p "Public age recipient (age1...): " AGE_RECIPIENT
sudo bash /tmp/docnest-setup-runtime.sh YOUR_PROJECT YOUR_REGION \
  https://YOUR_DOMAIN YOUR_PRIVATE_BACKUPS_BUCKET "$AGE_RECIPIENT" 1
```

Replace all placeholders before running. `jwt_version` must match the key actually
mounted in Identity; initial setup uses version 1. The VM runtime service account
needs individual access to `editor-jwt` and source object read/backup object write
permissions already described in [the handoff](CLOUD_SETUP_HANDOFF.md).

The helper installs age, writes root-only vm-deploy.json, protects the existing
cloud.env and configures root's Docker credential helper using VM metadata
credentials. It never changes passwords, signing keys or the domain.

Do not log in with personal Google credentials on the VM. Preserve the original
checkout under `/opt/editor`; source bundles of later releases go into private
`/opt/editor/vm-releases/` directories without resetting the live checkout.

## 5. Release subsequent updates

Push the intended source commit to `main`. Open **GitHub Actions → Build & deploy
VM → Run workflow → main → Run workflow**. That is the only recurring action.

The workflow waits for its core/runtime checks and image scans, validates the artifact from the
same run/commit, transfers a bounded source archive and six immutable digests, and
runs the host script as a systemd service. SSH disconnection does not terminate
the supervised rollout. Concurrent releases queue; the VM also holds an exclusive
file lock. No unattended push-triggered VM rollout is added.

The host script checks current container health, project-scoped digests, protected
configuration and the Web/Identity Google Client ID. It pulls images before
downtime, stops all six applications and HTTPS, captures/encrypts/uploads backup,
runs all five migration-only commands, starts backend readers before Web, starts
HTTPS and probes `/healthz`. It records source, digests, backup reference and the
previous release in root-only `/opt/editor/vm-state.json`. Secrets remain in
`cloud.env`; new digest overrides use separate private files.

## Failure and recovery

Before any migration starts, a failed backup resumes the previous app images.
After migration starts, previous apps are automatically resumed only when the
actual five Flyway histories match the captured histories. If schema changed or
cannot be verified, applications remain stopped for operator recovery. No SQL
restore, DDL reversal, Stripe reconciliation or event replay is automatic.
Do not introduce destructive migrations or a native-format downgrade through this
routine workflow; perform a separately reviewed compatibility/restore rollout.

Logs with raw command output are withheld from Actions. On the VM, inspect the
systemd unit named `docnest-release-RUN_ID-ATTEMPT`, the public health endpoint and
private container health. Do not publish SQL, private keys, cloud.env or plaintext
backup captures as CI artifacts. A killed systemd service, VM restart, disk full
or cloud outage may require manual recovery; absence of an Actions success does
not imply the VM returned to its previous state.

For current container status after automatic deployment:

```bash
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}'
sudo cat /opt/editor/vm-state.json
```

Use `source` and `env` in that protected state with the canonical cloud.env and
`vm-runtime.json` when invoking Compose for a deployed release. The old shell `dc`
function targets the initial checkout/images and must not be used to recreate
applications after automatic rollout. Monitoring-only `docker ps` is safe.

To decrypt an archive on an isolated recovery machine:

```bash
age -d -i /protected/backup-age.key -o /protected/backup.tar.gz /protected/backup.tar.gz.age
```

Then follow the isolated five-database/object-generation restore steps in the
handoff, including Stripe reconciliation. Encrypted backups in GCS follow the
existing bucket retention. Private source releases and encrypted local copies are
retained for recovery; review disk usage and clean only inspected obsolete copies
after rollback/backup retention requirements are met.
