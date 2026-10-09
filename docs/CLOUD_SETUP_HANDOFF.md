# Cloud setup handoff

Status: **DEPLOY_PENDING**. Configuration has been prepared and locally checked; no Google Cloud resources, billing links or credentials were created. Real GCS, VM/GKE smoke, remote backup restore, billing and cleanup gates remain unexecuted. Keep one paid environment active at a time. The USD300 budget is for the entire learning period.

Prerequisites: a dedicated project you own, permission to link its billing account, Google Cloud CLI, Terraform1.14+, kubectl/Kustomize, Docker Compose2, a domain/DNS for HTTPS, and completed local validation. Use `docs/PROJECT_STATUS.md` for current local gates. The one-node lab is not highly available.

## Values you must configure

| Value                                        | Where it belongs                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project ID, billing account, region and zone | Copy `infra/gcp/terraform.tfvars.example` to ignored `terraform.tfvars`; set `project_id`, `billing_account`, `region`, `zone`. Default cost baseline us-central1/us-central1-a.                                                                                                                                                                                                                                                                                               |
| Three unique private bucket names            | Terraform `snapshots_bucket`, `results_bucket`, `backups_bucket`. **VM cloud.env: `GCS_SNAPSHOTS_BUCKET`, `GCS_RESULTS_BUCKET`**; Compose maps these to Document/Processing `SNAPSHOTS_BUCKET` and Processing `GCS_BUCKET`. K8s editor-config uses those container aliases directly. Do not put only the aliases in VM cloud.env.                                                                                                                                              |
| HTTPS origin/domain                          | Terraform `web_origin`; `infra/gcp/Caddyfile`; cloud env `WEB_ORIGIN`, `ALLOWED_ORIGINS`, `PUBLIC_BASE_URL`, `JWT_ISSUER`; K8s editor-config. Exact origin required by CSRF and bucket CORS.                                                                                                                                                                                                                                                                                   |
| Database passwords and caller keys           | Secret Manager versions for MYSQL_ROOT_PASSWORD, IDENTITY_DB_PASSWORD, DOCUMENT_DB_PASSWORD, PROCESSING_DB_PASSWORD, COLLABORATION_DB_PASSWORD, DOCUMENT_INTERNAL_KEY, PROCESSING_INTERNAL_KEY. Hexadecimal secrets32bytes satisfy bootstrap validation. Never put them in tfvars, images or Git.                                                                                                                                                                              |
| Kafka credentials                            | Five distinct Secret Manager values: KAFKA_BROKER_PASSWORD, KAFKA_ADMIN_PASSWORD, KAFKA_DOCUMENT_PASSWORD, KAFKA_PROCESSING_PASSWORD, KAFKA_OPERATOR_PASSWORD. Put them in the protected VM env or K8s editor-secrets. Identity receives no Kafka password; Document/Processing receive their respective principal. Broker startup generates restricted ephemeral JAAS files.                                                                                                  |
| RSA signing key                              | PKCS8 PEM RSA3072; Secret Manager `editor-jwt`; mount as `identity-key.pem` at `/keys` in K8s (`JWT_KEY_PATH=/keys/identity-key.pem`) or `/data/keys` on VM. Cloud `JWT_ALLOW_KEY_GENERATION=false`. Keep key stable across restart and back it up securely.                                                                                                                                                                                                                   |
| Service database URLs/users                  | Identity IDENTITY_DB_URL/USER; Document DATABASE_URL/DOCUMENT_DB_USER; Processing PROCESSING_DB_URL/USER. Select only the respective database; retain `connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true`.                                                                                                                                                                                                                                                          |
| Internal URLs                                | IDENTITY_BASE_URL=http://identity-service:8080; DOCUMENT_URL=http://document-service:8080; JWT_JWK_URI=http://identity-service:8080/.well-known/jwks.json; PORT=8080; KAFKA_BOOTSTRAP_SERVERS=kafka:9092; REDIS_HOST=redis.                                                                                                                                                                                                                                                    |
| Web gateway                                  | Compose/K8s web only: `IDENTITY_INTERNAL_ORIGIN=http://identity-service:8080`, `DOCUMENT_INTERNAL_ORIGIN=http://document-service:8080`, `PROCESSING_INTERNAL_ORIGIN=http://processing-service:8080`; `PORT=8080`, `NEXT_INTERNAL_PORT=3000`, `NODE_OPTIONS=--max-old-space-size=256`. Never expose port3000.                                                                                                                                                                   |
| Optional trusted TLS proxy                   | `TRUSTED_PROXY_CIDRS` on web only. Empty by default: forwarding headers are discarded and the socket peer supplies client IP. For VM trust the inspected Caddy subnet/IP; for GKE trust verified GFE source ranges and the specific ingress frontend IP/32. See the exact configuration below; never use a wildcard or /0.                                                                                                                                                     |
| Tested image digests                         | VM ignored env IDENTITY_IMAGE/DOCUMENT_IMAGE/PROCESSING_IMAGE/COLLABORATION_IMAGE/PAYMENT_IMAGE/WEB_IMAGE; Kustomize `images` replacements for all six application images and migration jobs. Deploy `@sha256:` references.                                                                                                                                                                                                                                                    |
| GitHub OIDC                                  | Protected GitHub environment `cloud-lab`: `GCP_PROJECT`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_CI_SERVICE_ACCOUNT` for cloud-images. For manual GKE deployment also set `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_ZONE`, `GKE_CLUSTER`, `WEB_ORIGIN`, `GCS_SNAPSHOTS_BUCKET`, `GCS_RESULTS_BUCKET`. Optional `TRUSTED_PROXY_CIDRS` preserves the reviewed TLS proxy trust on every rollout; omit it to discard forwarding headers. Restrict provider to your repository/main branch. |
| Lab environment                              | Terraform `environment=none` for buckets/IAM only, then exactly `vm` or `gke`. Remove the first paid environment before switching.                                                                                                                                                                                                                                                                                                                                             |

## IAM and private storage

Terraform creates `editor-identity`, `editor-document`, `editor-processing`, `editor-vm`, `editor-node`, `editor-ci`. Document has Storage Object User on snapshots; Processing has Object Viewer on snapshots and Object User on results. VM shares bucket permissions between containers as the documented lab compromise. Node has Artifact Registry Reader, Logs Writer and Metrics Writer; application Google permissions use GKE Workload Identity. CI has Artifact Registry Writer only. Grant Secret Manager Secret Accessor **on individual secrets** to the runtime identities that need them; avoid project-wide secret access.

Your provisioning identity needs relevant Compute/Container/Storage/Artifact Registry/Service Usage/IAM administration and Billing Budget permissions. Do not grant these administrator roles to runtime identities. Link each KSA to its GSA using the Terraform workload bindings plus the manifest annotation. Storage uses ADC, not downloaded service-account JSON keys. Authenticated download proxies avoid signBlob IAM; signed URLs can be added only with at most60seconds lifetime and generation pinning.

Buckets use uniform access, public access prevention and explicit soft-delete policy. No age lifecycle deletes snapshots. Application reference-aware GC retires old versions and applies the one-hour read/job grace. GCS resumable URIs are bearer capabilities: commit expires after15minutes, whereas the GCS URI can remain active; expired sessions require cancellation/orphan cleanup. [GCS resumable protocol](https://docs.cloud.google.com/storage/docs/performing-resumable-uploads), [generation preconditions](https://cloud.google.com/storage/docs/request-preconditions), [Workload Identity](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity).

## Ordered preparation and deployment commands

The following commands are a future operator handoff, **not executed by this implementation task**. Replace every placeholder before running. Commands shown in Bash; Cloud Shell provides Bash and gcloud. Run Terraform plan before every apply and read the resource/cost inventory.

```bash
export PROJECT=YOUR_LAB_PROJECT REGION=us-central1 ZONE=us-central1-a
gcloud auth login
gcloud config set project "$PROJECT"
# Manually link billing only after reviewing estimate and budget; no command here silently links it.
cp infra/gcp/terraform.tfvars.example infra/gcp/terraform.tfvars
# Edit all values; start with environment="none".
terraform -chdir=infra/gcp init
terraform -chdir=infra/gcp fmt -check
terraform -chdir=infra/gcp validate
terraform -chdir=infra/gcp plan -out=reviewed.plan
terraform -chdir=infra/gcp apply reviewed.plan
```

Create each secret from a protected file, for example `gcloud secrets create editor-document-db-password --replication-policy=automatic --data-file=/protected/document-password` and grant its runtime account `roles/secretmanager.secretAccessor` with `gcloud secrets add-iam-policy-binding`. Generate the JWT with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /protected/identity-key.pem`. Keep local secret files mode600. Do not echo secrets or print resumable/public-link URLs to deployment logs.

Use this explicit secret-name mapping. Run without shell tracing. `KEY` becomes Secret Manager `editor-key-with-hyphens`; the JWT remains `editor-jwt`. Initial creation only; use `gcloud secrets versions add` for a reviewed rotation rather than changing persisted database passwords on restart.

```bash
umask 077
mkdir -p /protected/editor
KEYS='MYSQL_ROOT_PASSWORD IDENTITY_DB_PASSWORD DOCUMENT_DB_PASSWORD PROCESSING_DB_PASSWORD COLLABORATION_DB_PASSWORD DOCUMENT_INTERNAL_KEY PROCESSING_INTERNAL_KEY KAFKA_BROKER_PASSWORD KAFKA_ADMIN_PASSWORD KAFKA_DOCUMENT_PASSWORD KAFKA_PROCESSING_PASSWORD KAFKA_OPERATOR_PASSWORD'
for key in $KEYS; do
  secret="editor-$(printf '%s' "$key" | tr '[:upper:]_' '[:lower:]-')"
  openssl rand -hex 32 > "/protected/editor/$key"
  gcloud secrets create "$secret" --project="$PROJECT" --replication-policy=automatic --data-file="/protected/editor/$key"
done
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /protected/editor/identity-key.pem
gcloud secrets create editor-jwt --project="$PROJECT" --replication-policy=automatic --data-file=/protected/editor/identity-key.pem
# Record the numeric JWT secret version in the backup manifest; never use 'latest' as that identifier.
gcloud secrets versions list editor-jwt --project="$PROJECT" --format='table(name,state,createTime)'
# A provisioning operator fetches these protected files for both VM and Kubernetes.
# The optional VM backup operator uses metadata ADC to read the stable JWT version.
gcloud secrets add-iam-policy-binding editor-jwt --project="$PROJECT" \
  --member="serviceAccount:editor-vm@$PROJECT.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
python - <<'PY'
from pathlib import Path
keys='MYSQL_ROOT_PASSWORD IDENTITY_DB_PASSWORD DOCUMENT_DB_PASSWORD PROCESSING_DB_PASSWORD COLLABORATION_DB_PASSWORD DOCUMENT_INTERNAL_KEY PROCESSING_INTERNAL_KEY KAFKA_BROKER_PASSWORD KAFKA_ADMIN_PASSWORD KAFKA_DOCUMENT_PASSWORD KAFKA_PROCESSING_PASSWORD KAFKA_OPERATOR_PASSWORD'.split()
target=Path('/protected/editor/editor-secrets.env')
target.write_text(''.join(key+'='+Path('/protected/editor/'+key).read_text().strip()+'\n' for key in keys))
target.chmod(0o600)
PY
```

Application pods consume operator-created Kubernetes Secrets; they do not fetch Secret Manager themselves and need no Secret Manager project-wide role. A GKE backup operator needs individual `editor-jwt` version access plus source bucket Object Viewer and destination backup Object Creator. Database dump/restore is an explicit maintenance operator action, independent of each application's own database-only credentials.

Configure OIDC without service-account keys:

```bash
gcloud iam workload-identity-pools create editor-ci --location=global --display-name=editor-ci
gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=editor-ci \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition="assertion.repository=='YOUR_OWNER/YOUR_REPOSITORY' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "editor-ci@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/editor-ci/attribute.repository/YOUR_OWNER/YOUR_REPOSITORY"
```

Run CI application validation first, then manually run cloud-images for that tested commit and retain `cloud-image-digests` and `cloud-image-scan-evidence`. That workflow rebuilds all six images, checks their actual configurations/first-party payloads for secrets and scans OS packages before publishing the exact scanned image IDs. High/critical advisories or incomplete scans block publication. The new Node/Next runtime is included. Registry pushes incur storage charges; delete unused images during cleanup.

Before preparing cloud images, run `python -X utf8 tooling/scripts/run.py test` and `npm run build` locally. The test command enforces Spotless, explicit Java imports, POM formatting, Prettier, frontend dependency boundaries, strict TypeScript, Next/TypeScript ESLint, ArchUnit, gateway/Next lint resolver contracts, JUnit/Testcontainers and Vitest. `python -X utf8 tooling/scripts/run.py quality` checks quality without the complete integration suite; `python -X utf8 tooling/scripts/run.py format` applies handwritten Java/frontend/config/document formatting. GitHub CI uses the same commands on Linux. Remote GitHub execution remains NOT_RUN until this repository is pushed and its workflows run.

For the optional manual GKE rollout workflow, create a separate deployment account after the cluster/bootstrap/secrets exist. Its [GKE Cluster Viewer role](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/iam) permits cluster discovery/connection; Kubernetes RBAC provides the scoped application and migration-job permissions. This account receives no Terraform administration, registry write or Google secret access.

```bash
gcloud iam service-accounts create editor-deploy --project="$PROJECT" --display-name='Editor protected GKE deployer'
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:editor-deploy@$PROJECT.iam.gserviceaccount.com" --role=roles/container.clusterViewer
gcloud iam service-accounts add-iam-policy-binding "editor-deploy@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/editor-ci/attribute.repository/YOUR_OWNER/YOUR_REPOSITORY"
# Run as the cluster operator, once editor-lab exists; inspect before applying.
sed "s/YOUR_PROJECT/$PROJECT/g" infra/k8s/deploy-rbac.example.yaml > /protected/editor/deploy-rbac.yaml
kubectl apply --dry-run=server -f /protected/editor/deploy-rbac.yaml
kubectl apply -f /protected/editor/deploy-rbac.yaml
```

Set `GCP_DEPLOY_SERVICE_ACCOUNT=editor-deploy@PROJECT.iam.gserviceaccount.com`, `GCP_ZONE=us-central1-a`, `GKE_CLUSTER=editor-lab` and the remaining environment variables in the values table. Protect `cloud-lab` and main. Kubernetes RBAC cannot constrain Job `create` by resource name; this account can create Jobs within editor-lab, so restrict who may approve this workflow. Manually dispatch `.github/workflows/cloud-deploy.yml` with the reviewed six-image JSON artifact from cloud-images and a reviewed pre-rollout encrypted backup reference. It server-validates manifests, runs separate Flyway Jobs, rolls out the existing applications by digest, and records previous digests/public health. It never provisions the cluster or supplies secrets. Its real cloud execution is DEPLOY_PENDING.

Before public deployment, rescan the reviewed cloud image digests. The scan writes `testing/reports/image-os-scan.json` and CI uploads it as an artifact; see `testing/checks/IMAGE_OS_SCAN.md` for reproduction. The initial Next Node/Bookworm image retained52 High and4 Critical OS findings after APT upgrades; the measured failure is summarized here; its JSON was a generated local artifact. ADR020 replaces it with the digest-pinned official Node24.11.1 Alpine3.23 base for both build and runtime, APK security updates and gcompat. This requires an actual compatible musl/SWC production build and fresh scan of the resulting image; previous nginx/Alpine and Debian scans do not validate it. The existing High/Critical and incomplete-scan rejection stays enforced. Dependency and image findings are tied to the exact tested commit/digest and exclude infrastructure unless explicitly listed. No scanner account or paid scan service was created.

The local replacement's Linux/amd64 production build, nine container gateway contracts, matching built-source hash and live child readiness passed; its final exact image had zero OS findings across21 packages. Those historical runs wrote generated reports under `testing/reports/`; current routine CI does not upload reports or run the browser E2E suite. Alpine uses musl; the official Node project classifies musl/amd64 as an experimental build tier. These checks cover the local and planned e2-standard-2 CPU architecture; ARM64/other architectures remain NOT_RUN and require their own compatible build/runtime validation. Cloud image rebuilds must repeat their exact-image scans before publication.

For VM, change Terraform `environment=vm`, review/apply the new plan. Connect using `gcloud compute ssh editor-lab --zone="$ZONE" --tunnel-through-iap`. Install Docker Engine/Compose from their official Ubuntu instructions. Copy the repository's Compose/proxy files, root-only cloud env and reviewed digests under `/opt/editor`. Mount the JWT key into the Identity volume before app startup. Base Compose plus `infra/gcp/compose.cloud.yaml` uses ADC from the VM metadata identity; no credential file is needed.

```bash
cd /opt/editor
# Create cloud.env from protected secret values and add reviewed configuration.
install -m 600 /protected/editor/editor-secrets.env /opt/editor/cloud.env
cat >> /opt/editor/cloud.env <<'ENV'
WEB_ORIGIN=https://YOUR_DOMAIN
JWT_ISSUER=https://YOUR_DOMAIN
GCS_SNAPSHOTS_BUCKET=YOUR_PRIVATE_SNAPSHOTS_BUCKET
GCS_RESULTS_BUCKET=YOUR_PRIVATE_RESULTS_BUCKET
ENV
# Replace placeholders. digests.json is the validated six-image cloud-images artifact.
python - <<'PY'
import json
from pathlib import Path
images=json.loads(Path('/protected/digests.json').read_text())
with Path('/opt/editor/cloud.env').open('a') as target:
    for name,key in [('identity-service','IDENTITY_IMAGE'),('document-service','DOCUMENT_IMAGE'),('processing-service','PROCESSING_IMAGE'),('web','WEB_IMAGE')]:
        target.write(key+'='+images[name]+'\n')
PY
# Configure infra/gcp/Caddyfile with the same DNS domain as WEB_ORIGIN.
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app pull
# Provision the named identity-keys volume using the actual nonroot image's UID/GID.
# The temporary root process executes install only; Java and key generation never run.
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app \
  run --rm --no-deps --user 0:0 --entrypoint /bin/sh \
  -v /protected/editor/identity-key.pem:/incoming/identity-key.pem:ro identity-service \
  -c 'install -d -o 10001 -g 10001 -m 700 /data/keys && install -o 10001 -g 10001 -m 600 /incoming/identity-key.pem /data/keys/identity-key.pem'
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml up -d mysql kafka redis
# Create topics AND exact service/group ACLs using the authenticated admin configuration.
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml exec -T kafka bash /opt/editor-kafka/kafka-init-acls.sh
for svc in identity-service document-service processing-service; do
  docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app run --rm "$svc" --editor.migrate-only=true
done
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app up -d --no-build --wait
```

The web gateway publishes8080 on loopback only; Caddy publishes80/443 with automatic TLS. Public firewall permits80/443 and IAP SSH, never3306/6379/9092/3000. Configure DNS A record before expecting certificate issuance. Set HTTPS `WEB_ORIGIN`, cookies Secure=true, origin allowlist and JWT issuer before the first login. Verify `/internal` and `/actuator` return404 publicly.

Reproduce the local standalone migration gate after `python tooling/scripts/run.py up` with `python -X utf8 testing/checks/migration_only.py`. It runs all four current Java images with the cloud profile against their own local databases, while signing-key/GCS credentials and runtime broker/cache/service endpoints are deliberately unusable. Each process must exit0, validate every installed migration (including Processing V3), leave Flyway history unchanged and emit no runtime startup markers. It writes redacted per-service logs and `testing/reports/migration-only.json` with image IDs, source hashes and the actual migration inventory. This verifies local migration entry points; it does not execute GCS or cloud migration jobs.

The web image runs UID1000 on pinned Node24.11.1 with a512MiB container limit. `node frontend/web/server/gateway.mjs` launches the traced [Next standalone server](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) on127.0.0.1:3000; public and static assets are included in the image. Public8080 routes auth/JWKS to Identity, jobs to Processing, the remaining API to Document, and pages/assets to Next. Uploads and downloads stream with backpressure; uploads are capped at32MiB, each proxy request has a130second deadline, and dynamic/API responses use `private, no-store`. Cookies, CSRF, Origin and idempotency headers retain their values. `/healthz` probes the live Next child over HTTP; termination drains requests for at most30seconds and terminates the child within the45second container/pod grace. Child stdout/stderr and request URLs are not logged.

By default the gateway overwrites spoofable forwarding headers with the socket IP and protocol. Behind TLS this safe default groups login-rate limits by proxy IP. To retain the actual client IP, review the proxy network and configure only trusted CIDRs. The gateway validates numeric IPv4/IPv6 CIDRs and walks the supplied chain from the trusted socket peer to the first untrusted IP; it overwrites all forwarded values before Spring receives them. Public ports remain closed on the backends. For VM, after Caddy starts, inspect its actual Docker network and retain that reviewed subnet; include no unrelated/untrusted containers in it:

```bash
cd /opt/editor
CADDY_ID=$(docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app ps -q https)
docker inspect "$CADDY_ID" --format '{{json .NetworkSettings.Networks}}'
# Inspect the network named above; use its exact reviewed subnet or Caddy's address/32.
docker network inspect YOUR_REVIEWED_COMPOSE_NETWORK --format '{{json .IPAM.Config}}'
# A subnet remains stable while that Docker network exists; re-review after replacing it.
printf '\nTRUSTED_PROXY_CIDRS=YOUR_REVIEWED_CADDY_CIDR\n' >> /opt/editor/cloud.env
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app up -d --no-build web
```

The shared VM network is a learning-lab trust boundary: trusting its subnet also trusts other containers on that subnet. Prefer Caddy's address/32 when it is stable, and update it after Caddy recreation. Keep `TRUSTED_PROXY_CIDRS` empty until the explicit value has been reviewed. All four Spring service origins are server-only settings, with no URL credentials, paths, query or fragment allowed.

For GKE, back up and remove VM compute first; set `environment=gke`, review/apply one zonal e2-standard-2 node without autoscaling. Do not increase node count automatically if pending pods show insufficient capacity; inspect allocatable resources and recalculate the short-lab budget. Replace placeholder config/SA annotations and image digests in a private overlay. Supply secrets before applying workloads.

```bash
gcloud container clusters get-credentials editor-lab --zone="$ZONE"
kubectl create namespace editor-lab --dry-run=client -o yaml | kubectl apply -f -
kubectl -n editor-lab create secret generic editor-secrets --from-env-file=/protected/editor/editor-secrets.env
kubectl -n editor-lab create secret generic editor-jwt --from-file=identity-key.pem=/protected/editor/identity-key.pem
# /protected/digests.json maps identity-service/document-service/processing-service/web to registry @sha256 digests.
python tooling/scripts/render_cloud.py --project "$PROJECT" --origin https://YOUR_DOMAIN \
  --snapshots-bucket YOUR_SNAPSHOTS_BUCKET --results-bucket YOUR_RESULTS_BUCKET \
  --digests /protected/digests.json --output /protected/cloud-render
kubectl apply --dry-run=server -f /protected/cloud-render/bootstrap.yaml
kubectl apply -f /protected/cloud-render/bootstrap.yaml
kubectl apply --dry-run=server -f /protected/cloud-render/infrastructure.yaml
kubectl apply -f /protected/cloud-render/infrastructure.yaml
kubectl -n editor-lab rollout status statefulset/mysql --timeout=300s
kubectl -n editor-lab rollout status statefulset/kafka --timeout=300s
kubectl -n editor-lab exec kafka-0 -- bash -s < infra/k8s/create-topics.sh
kubectl apply --dry-run=server -f /protected/cloud-render/migrations.yaml
kubectl apply -f /protected/cloud-render/migrations.yaml
kubectl -n editor-lab wait --for=condition=complete --timeout=300s job/migrate-identity-service job/migrate-document-service job/migrate-processing-service job/migrate-collaboration-service
kubectl apply --dry-run=server -f /protected/cloud-render/applications.yaml
kubectl apply -f /protected/cloud-render/applications.yaml
kubectl -n editor-lab rollout status deployment/identity-service --timeout=300s
kubectl -n editor-lab rollout status deployment/document-service --timeout=300s
kubectl -n editor-lab rollout status deployment/processing-service --timeout=300s
kubectl -n editor-lab rollout status deployment/web --timeout=300s
kubectl -n editor-lab get pods,pvc,services
```

Default manifests expose only ClusterIP. An operator may use port-forward plus a local TLS proxy matching configured HTTPS origin, or apply `infra/k8s/ingress.example.yaml` after configuring its domain/certificate and recalculating load-balancer charges. Never use Secure=false in cloud to bypass TLS. Internal services remain behind NetworkPolicy and caller keys. Apply no publicly reachable NodePort.

The web Service explicitly sets `cloud.google.com/neg: '{"ingress":true}'`: the Terraform cluster enables Network Policy, so [automatic NEG annotation does not apply](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/ingress). The optional ingress file includes a BackendConfig with130second timeout,30second connection drain and `/healthz` on8080, plus its Service annotation and a NetworkPolicy allowing web8080. Validate the GKE BackendConfig API before applying; no load-balancer resources are created by local rendering. Domain/certificate, NEG readiness and real public health still require the deferred cloud validation.

For the optional global GKE ingress, review the current [GFE source ranges and forwarding-chain contract](https://docs.cloud.google.com/load-balancing/docs/https). Google appends the client IP and the ingress frontend IP after any supplied prefix. Trusting only GFE ranges would select the frontend IP rather than the client; add only this deployment's specific frontend IPv4 address/32. These future commands require the reviewed domain in the optional manifest and an ingress that has received its address:

```bash
sed 's/YOUR_DOMAIN/YOUR_REVIEWED_DOMAIN/g' infra/k8s/ingress.example.yaml > /protected/editor/ingress.yaml
kubectl apply --dry-run=server -f /protected/editor/ingress.yaml
kubectl apply -f /protected/editor/ingress.yaml
INGRESS_IP=$(kubectl -n editor-lab get ingress editor-public -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
# Review that this is the expected numeric IPv4 address and that the backend peer ranges match this LB mode.
kubectl -n editor-lab set env deployment/web "TRUSTED_PROXY_CIDRS=35.191.0.0/16,130.211.0.0/22,$INGRESS_IP/32"
kubectl -n editor-lab rollout status deployment/web --timeout=300s
curl --fail --silent --show-error https://YOUR_REVIEWED_DOMAIN/healthz
```

Save the reviewed CIDRs in the private deployment overlay/rendered web environment as well; a later rollout of the default manifests resets trust to empty. When using the manual cloud-deploy workflow, set the protected `cloud-lab` variable `TRUSTED_PROXY_CIDRS` to the same reviewed string. The workflow validates it with the runtime gateway parser and writes it into the web Deployment before server dry-run. Re-review when the ingress IP/network/load-balancer mode changes. Do not apply these IPv4 GFE ranges to regional proxy-only subnets or a different proxy without reviewing its documented peers. Cloud forwarding and TLS validation remain DEPLOY_PENDING.

Kafka uses authenticated SASL/PLAIN and default-deny topic/group ACLs on private lab networking. No anonymous controller superuser exists. Keep ports9092/9093 internal. PLAIN does not encrypt traffic; configure SASL_SSL and trusted broker certificates before crossing an untrusted network. See `infra/compose/kafka-security.md`. Replay reviewed original envelopes with `python tooling/scripts/replay_event.py --topic TOPIC --file /protected/original.json --dry-run`; add `--publish` only after inspection. Retain eventId, and never attempt to recover discarded sensitive payloads from redacted DLQ entries.

## Validation, backup and rollback

Manually validate the deployed UI and API against real services; the repository browser E2E suite was removed at the owner's request. The local smoke's Docker restart/fault operations apply only to local Compose; for VM use its Compose commands, and for GKE inject outages with targeted pod restarts/scale operations. Verify refresh/reload, Unicode B/I/U round trips, folder isolation/depth/cycles, viewer/editor permissions, revocation between upload and commit, stale-head409, public expiry/revocation, TXT/HTML, and restart persistence. Upload native files generated with `python testing/benchmark/native_input.py` using the actual GCS adapter and check generation/create-only/hash/invalid native behavior; this is the outstanding P12 cloud gate.

For GKE P15, retain rollout/consumer-group assignments; scale Processing to2, kill one worker during an export and observe lease reclaim without duplicate result publication. Restart mysql/kafka pods and prove PVC persistence. Check liveness remains healthy during broker/cache outage, readiness depends on mandatory SQL, and backlogs clear after recovery. Record measured metadata/validation latency, heap and image digests. Do not describe these as passed before executing them.

Perform an isolated restore drill before relying on backups. Local `python tooling/scripts/run.py backup` captures all four SQL databases, local objects and JWT keys; the prior three-database restore drill passed; rerun a four-database drill in an isolated lab before relying on the expanded backup. Cloud execution below is **NOT_RUN**. `tooling/scripts/cloud_backup.py` provides a GCS-only operator capture and recovery preparation tool. It verifies that application containers/Pods have stopped, then captures a single-transaction dump of all four databases and copies exact `gs://bucket/key#generation` objects before live GC resumes. The private manifest records every physical version reference, active job source, nonnull job result, pending outbox reference, SQL/key SHA256, immutable image digests, Flyway versions/checksums and numeric Secret Manager key version. Deleted historical job sources/cleaned output attempts remain archived metadata rather than fabricated objects. A source hash mismatch or missing required object fails the backup.

Set the protected GPG recipient fingerprint, reviewed image file and **numeric** JWT version first. These commands deliberately pause this single-node learning application during capture; SQL/Kafka/Redis remain running. Run without tracing and keep the archive directory mode700. A VM uses metadata ADC; a GKE operator uses its authorized gcloud session and explicit cluster context.

```bash
export BACKUPS_BUCKET=YOUR_PRIVATE_BACKUPS_BUCKET BACKUP_RECIPIENT=YOUR_GPG_RECIPIENT_FINGERPRINT
export JWT_VERSION=1
export BACKUP_DATE="$(date -u +%Y%m%dT%H%M%SZ)"
export ARCHIVE="/protected/editor/backup-$BACKUP_DATE"
# VM: run on /opt/editor with the protected cloud.env and reviewed six-image JSON.
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app \
  stop https web identity-service document-service processing-service
python tooling/scripts/cloud_backup.py backup --environment vm --project "$PROJECT" \
  --compose-env /opt/editor/cloud.env --directory "$ARCHIVE" --images /protected/digests.json \
  --jwt-secret-version "projects/$PROJECT/secrets/editor-jwt/versions/$JWT_VERSION"
# Run even if capture fails, after inspecting protected artifacts; no failed archive is uploaded.
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app \
  up -d --no-build --wait
```

For GKE, use the following capture block **instead of** the VM block; inspect the explicit context before pausing workloads. Wait until all six applications' Pods are gone, including terminating workers, then capture.

```bash
export LIVE_CONTEXT=YOUR_REVIEWED_GKE_CONTEXT
kubectl --context "$LIVE_CONTEXT" -n editor-lab scale deployment identity-service document-service processing-service collaboration-service payment-service web --replicas=0
for service in identity-service document-service processing-service collaboration-service payment-service web; do
  kubectl --context "$LIVE_CONTEXT" -n editor-lab wait --for=delete pod -l "app=$service" --timeout=180s
done
python tooling/scripts/cloud_backup.py backup --environment gke --project "$PROJECT" \
  --kube-context "$LIVE_CONTEXT" --directory "$ARCHIVE" --images /protected/digests.json \
  --jwt-secret-version "projects/$PROJECT/secrets/editor-jwt/versions/$JWT_VERSION"
kubectl --context "$LIVE_CONTEXT" -n editor-lab scale deployment identity-service document-service processing-service collaboration-service payment-service web --replicas=1
for service in identity-service document-service processing-service collaboration-service payment-service web; do
  kubectl --context "$LIVE_CONTEXT" -n editor-lab rollout status deployment/"$service" --timeout=300s
done
```

Only a successful capture containing manifest.json proceeds to encryption/upload. Keep private-key/SQL/raw object files off CI artifacts and out of the public web directory.

```bash
tar -C /protected/editor -cf "/protected/editor/backup-$BACKUP_DATE.tar" "backup-$BACKUP_DATE"
gpg --batch --recipient "$BACKUP_RECIPIENT" --encrypt \
  --output "/protected/editor/backup-$BACKUP_DATE.tar.gpg" "/protected/editor/backup-$BACKUP_DATE.tar"
(cd /protected/editor && sha256sum "backup-$BACKUP_DATE.tar.gpg" > "backup-$BACKUP_DATE.tar.gpg.sha256")
gcloud storage cp --project "$PROJECT" --if-generation-match=0 \
  "/protected/editor/backup-$BACKUP_DATE.tar.gpg" "gs://$BACKUPS_BUCKET/$BACKUP_DATE/backup.tar.gpg"
gcloud storage cp --project "$PROJECT" --if-generation-match=0 \
  "/protected/editor/backup-$BACKUP_DATE.tar.gpg.sha256" "gs://$BACKUPS_BUCKET/$BACKUP_DATE/backup.tar.gpg.sha256"
```

For nightly operation, put the reviewed VM capture/encrypt/upload block in root-owned `/opt/editor/cloud-backup.sh`, with `set -euo pipefail`, these configured variables and an EXIT trap that resumes the application after capture failure. Schedule that wrapper with a root systemd timer or cron; keep logs to operation/count/status metadata. For GKE schedule the equivalent authorized operator maintenance procedure. Neither scheduling nor remote backup/restore has been executed here. Include backup bytes, fourteen-day lifecycle and seven-day soft-delete retention in the cost estimate.

Recovery is deliberately separate and reviewable. Provision a **separate VM or cluster**, empty database volumes and two new private buckets through a reviewed plan. Keep all application workers stopped. Do not reuse live bucket names. Give the isolated application identities the same least-privilege roles on the new buckets. Download and verify the encrypted archive before extraction; review archive names before tar extraction into a new protected directory.

```bash
umask 077
mkdir -p /protected/editor/restore
gcloud storage cp --project "$PROJECT" "gs://$BACKUPS_BUCKET/$BACKUP_DATE/backup.tar.gpg" "/protected/editor/restore/backup-$BACKUP_DATE.tar.gpg"
gcloud storage cp --project "$PROJECT" "gs://$BACKUPS_BUCKET/$BACKUP_DATE/backup.tar.gpg.sha256" "/protected/editor/restore/backup-$BACKUP_DATE.tar.gpg.sha256"
(cd /protected/editor/restore && sha256sum --check "backup-$BACKUP_DATE.tar.gpg.sha256")
gpg --decrypt --output /protected/editor/restore/backup.tar "/protected/editor/restore/backup-$BACKUP_DATE.tar.gpg"
tar -tf /protected/editor/restore/backup.tar
tar -C /protected/editor/restore -xf /protected/editor/restore/backup.tar
export RESTORE_ARCHIVE="/protected/editor/restore/backup-$BACKUP_DATE"
python tooling/scripts/cloud_backup.py restore-objects --project "$PROJECT" --directory "$RESTORE_ARCHIVE" \
  --target-snapshots-bucket YOUR_ISOLATED_SNAPSHOTS_BUCKET --target-results-bucket YOUR_ISOLATED_RESULTS_BUCKET \
  --confirm-isolated-restore
python tooling/scripts/cloud_backup.py prepare-remap --directory "$RESTORE_ARCHIVE"
```

`restore-objects` uses destination `ifGenerationMatch=0`, downloads each resulting **new generation** and verifies its SHA256, then records generation-remap.json. A partial attempt never overwrites an existing target; inspect it before retrying. `prepare-remap` writes five database-specific SQL files and executes no SQL; the collaboration/payment files change no object references. Review them privately. Exact ObjectRef matches preserve provider/key, eventId/envelope fields and unrelated data while changing only bucket/generation. No cross-database query/foreign key is introduced. Noncommitted upload tickets become abandoned and every archived resumable capability is cleared, preventing restored GC from cancelling a live source session. The original encrypted archive remains unchanged. The capture also compares the archived numeric Secret Manager version against the deployed signing key. [GCS copy preconditions](https://docs.cloud.google.com/sdk/gcloud/reference/storage/cp) and [object generations](https://docs.cloud.google.com/storage/docs/metadata).

The original local helper validation passed eight tests, including 500 seeded nested reference transformations, authoritative event schema checks, guarded SQL generation, catalog/path rejection and actual archive hash-corruption detection. Its isolated MySQL V1/V2 restore drill passed eight checks in 28.25 seconds before this refactor. Each run creates `testing/reports/cloud-backup-local.json` and `testing/reports/cloud-backup-mysql.json`; CI uploads them as generated artifacts. Inspect their timestamp and migration inventory when rerunning `python testing/checks/cloud_backup_check.py` and `python testing/checks/cloud_backup_mysql_check.py`. Processing now also has additive `V3__trace_correlation.sql` with nullable job trace IDs. Every backup records actual Flyway versions/checksums; restore all recorded migrations before starting workers, and preserve trace IDs alongside unchanged event envelopes. The old V1/V2 drill does not verify V3. Real gcloud operations, remote/GCS restore and cloud worker recovery remain PENDING.

On the isolated **VM**, set cloud.env's GCS_SNAPSHOTS_BUCKET/GCS_RESULTS_BUCKET to the new buckets, use the archived image digests, and provision identity-keys using the earlier install command with `$RESTORE_ARCHIVE/identity-key.pem`. Start only infrastructure and import/review the prepared reference patch. These commands run on that isolated host, never the live VM.

```bash
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml up -d --wait mysql kafka redis
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml exec -T mysql \
  bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4' < "$RESTORE_ARCHIVE/databases.sql"
for database in identity_db document_db processing_db; do
  docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml exec -T mysql \
    bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4' < "$RESTORE_ARCHIVE/$database-reference-patch.sql"
done
docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml exec -T kafka bash /opt/editor-kafka/kafka-init-acls.sh
```

For an isolated **GKE cluster**, set its new ConfigMap bucket aliases, create editor-jwt from the archived key, and apply only bootstrap/infrastructure first. Keep applications at zero replicas. Select `RESTORE_CONTEXT` explicitly, then import instead:

```bash
export RESTORE_CONTEXT=YOUR_REVIEWED_ISOLATED_GKE_CONTEXT
kubectl --context "$RESTORE_CONTEXT" -n editor-lab exec -i mysql-0 -- \
  bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4' < "$RESTORE_ARCHIVE/databases.sql"
for database in identity_db document_db processing_db; do
  kubectl --context "$RESTORE_CONTEXT" -n editor-lab exec -i mysql-0 -- \
    bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4' < "$RESTORE_ARCHIVE/$database-reference-patch.sql"
done
kubectl --context "$RESTORE_CONTEXT" -n editor-lab exec kafka-0 -- bash -s < infra/k8s/create-topics.sh
```

Run standalone migration validation using the restored image/schema versions before starting applications. Restore no old Kafka volume into this new environment: it contains old object references. Inspect pending SQL outboxes, QUEUED jobs and missing inbox receipts; replay only the reviewed required original envelopes through the authenticated operator, retaining eventId and using the remapped object references. Already processed events remain deduplicated. The helper intentionally neither invents generations nor automatically clears/replays historical events. Validate two-user login/refresh, current and historical native SHA256/formatting, sharing/revocation/public links, active job recovery, exports and restart persistence before any switch. A production cutover requires its separate reviewed maintenance plan; no automatic restore into live databases is provided.

Before rollout save previous image digests and a backup. Run separate Flyway jobs once. Schemas remain backward-compatible; application rollback does not reverse DDL. Kubernetes rollback: `kubectl -n editor-lab rollout undo deployment/document-service` (and other changed applications) then `rollout status` and smoke. VM rollback: restore the previous reviewed digest env values, then execute `docker compose --env-file /opt/editor/cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml --profile app up -d --no-build --wait`. For destructive schema changes restore the reviewed backup in an isolated environment and switch only after validation.

## Cost estimation and cleanup

Use the [Cloud Pricing Calculator](https://cloud.google.com/products/calculator), [Compute](https://cloud.google.com/compute/all-pricing), [disk](https://cloud.google.com/compute/disks-image-pricing), [network](https://cloud.google.com/vpc/network-pricing), [GKE](https://cloud.google.com/kubernetes-engine/pricing) and Storage/Logging prices for the selected region. Enter planned hours, e2-standard-2, 50GiB boot/balanced disks,20GiB SQL +10GiB Kafka PVCs, IPv4, bucket bytes/requests, registry retention, backup soft-delete retention, logs and egress. Include ingress load-balancer hours if enabled. Sum VM period plus GKE period plus contingency; reserve170/60/70USD as the design allocation. Save the calculator export and date locally to `testing/reports/cloud-cost.json`; this operator output is not checked into Git. These allocations are estimates, not current quotes or a spending guarantee.

Set alerts100/180/230USD and a forecast threshold. The Terraform budget period must start at the actual beginning of the learning project; track cumulative lifetime spend in daily billing exports and include resources retained after shutdown. [Budget alerts do not enforce a hard cap](https://docs.cloud.google.com/billing/docs/how-to/budgets). Stop experiments early enough to leave cleanup/retention reserve.

Inventory first (project flag required); inspect labels/names and protect required backups:

```bash
python tooling/scripts/cloud_inventory.py --project "$PROJECT"
gcloud compute instances list --project="$PROJECT" --filter='labels.application=text-editor'
gcloud container clusters list --project="$PROJECT"
gcloud compute disks list --project="$PROJECT"
gcloud compute addresses list --project="$PROJECT"
gcloud compute forwarding-rules list --project="$PROJECT"
gcloud storage buckets list --project="$PROJECT"
```

After exporting backups, delete application deployments/PVCs only when the data can be discarded; Kubernetes deletion alone can leave disks/load balancers. Turn off Terraform deletion_protection for the specific reviewed VM/cluster, review plan, then destroy resources **from this lab's Terraform state only**, retaining backup buckets as desired. Direct fallback commands: `gcloud container clusters delete editor-lab --zone="$ZONE" --project="$PROJECT"`; `gcloud compute instances delete editor-lab --zone="$ZONE" --project="$PROJECT"`. Confirm exact project/resource on CLI prompt. Delete orphan disks/IPs/forwarding rules by inspected name; never use project-wide deletion loops. Delete reviewed registry image digests and expired backups/soft-deleted objects after retention. Rerun inventory, check Billing next day and record any remaining paid resources. Stopping a VM does not stop disk/IP/storage charges. No cleanup/provision command has been executed in this task.

Concrete Terraform cleanup sequence: first leave `environment` at the current vm/gke value, edit **that resource's** `deletion_protection=false` in main.tf, then plan/apply that protection change. Only then set environment=none to remove compute. Keep the state and retained backup inventory protected.

```bash
terraform -chdir=infra/gcp plan -out=reviewed-unprotect.plan
terraform -chdir=infra/gcp apply reviewed-unprotect.plan
# Edit terraform.tfvars: environment="none". Review that no retained bucket is destroyed.
terraform -chdir=infra/gcp plan -out=reviewed-compute-cleanup.plan
terraform -chdir=infra/gcp apply reviewed-compute-cleanup.plan
python tooling/scripts/cloud_inventory.py --project "$PROJECT"
# Delete a specifically reviewed unused application digest, retaining rollback images as needed.
gcloud artifacts docker images delete "YOUR_REGION-docker.pkg.dev/$PROJECT/editor/YOUR_SERVICE@sha256:YOUR_REVIEWED_DIGEST" \
  --project="$PROJECT" --delete-tags
```

When **all** lab data and backup retention can be discarded, empty only the inspected lab buckets and transfer any deliberately retained backup resources to a separately maintained retention state before attempting full-state destruction. Bucket `force_destroy=false` deliberately refuses silent deletion of nonempty data. Run `terraform -chdir=infra/gcp plan -destroy -out=reviewed-full-cleanup.plan`, inspect that exact state/resource inventory, then `terraform -chdir=infra/gcp apply reviewed-full-cleanup.plan`. Recheck orphan disks, addresses, ingress forwarding rules and backup soft-delete expiry in Billing. The none environment still leaves storage/registry/IAM resources until this final cleanup or explicit retention management.

## Collaboration deployment scope

ADR027 adds the fourth Java service and `collaboration_db`. The templates and image/backup workflows now cover five application images and four database owners. Set `COLLABORATION_DB_PASSWORD` in `editor-secrets` or the protected VM env, and `COLLABORATION_IMAGE` to its reviewed digest on VM. Kubernetes uses a dedicated unannotated `collaboration-service` KSA, its own DB password, and no Document/Processing internal keys or GCP IAM roles. Google receives a Document-issued resumable capability for the configured snapshots bucket, never the user's JWT. Real GCS checkpoint and cloud rollout gates remain **PENDING/DEPLOY_PENDING**.

For an existing lab, create the new password secret without rotating the other passwords. Quiesce all six applications and take the reviewed backup before upgrading. Apply the rendered ConfigMap/Secret and MySQL infrastructure configuration, wait for MySQL readiness, then bootstrap the new database idempotently:

```bash
# GKE, after the operator has applied the reviewed bootstrap/infrastructure configuration:
kubectl -n editor-lab rollout status statefulset/mysql --timeout=300s
kubectl -n editor-lab exec mysql-0 -- bash /docker-entrypoint-initdb.d/mysql-init.sh
# VM, using the protected cloud.env and reviewed base/overlay Compose files:
docker compose --env-file cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml up -d --wait mysql
docker compose --env-file cloud.env -f infra/compose/compose.yaml -f infra/gcp/compose.cloud.yaml exec -T mysql bash /docker-entrypoint-initdb.d/01-editor.sh
```

Run all five migration jobs before application rollout, including `migrate-collaboration-service`. On an existing three-service cluster, the operator must create the new Deployment/Service/KSA after migration; the protected update workflow assumes all six Deployments already exist. Validate two account editors, a revoked editor, checkpoint save/reopen and reconnect against the actual HTTPS/GCS environment before opening access. A crash between Document commit and room completion currently requires explicit recovery: retain the room log and use a native copy; do not silently reset room/head state.

The added pod requests 100m CPU/128 MiB and has a 512 MiB limit. Recalculate aggregate capacity, image storage and runtime hours against the same USD 300 total budget using the estimate procedure above. The local commands do not create cloud resources. Rollback preserves the fourth database/log; reverting to an older web image disables collaboration UI. Remove the extra service only after pending drafts have been preserved, and include its registry digest/secret in the reviewed cleanup inventory.

## Payment and subscription upgrade (ADR028)

The current rollout has **five Java services, five databases, six application
images and five Flyway jobs**. Add `PAYMENT_IMAGE` as a reviewed immutable digest
in the protected VM environment; digest manifests must contain all six images.
The dedicated `payment-service` KSA has no GCP IAM/storage role, Document internal
key, Identity signing key, or other database credential. It needs only its own
MySQL password, own Kafka SASL credential, public JWKS access and HTTPS egress to
Stripe. Identity and Collaboration now also use their own Kafka principals.

Configure these values before billing acceptance:

| Value                                                                               | Protected location / purpose                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `PAYMENT_DB_PASSWORD`                                                               | VM `cloud.env`; Kubernetes `editor-secrets`, own `payment_db`                       |
| `KAFKA_PAYMENT_PASSWORD`, `KAFKA_IDENTITY_PASSWORD`, `KAFKA_COLLABORATION_PASSWORD` | VM env / `editor-secrets`; matching broker user credentials and topic ACLs          |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                        | VM env / `editor-secrets`, **sandbox** API key and deployed endpoint signing secret |
| `STRIPE_PRO_MONTHLY_PRICE`, `STRIPE_PRO_YEARLY_PRICE`                               | VM env / `editor-config` ConfigMap, reviewed sandbox recurring Price IDs            |
| `WEB_ORIGIN`                                                                        | Exact public HTTPS origin in VM env / `editor-config`; Checkout/Portal return URLs  |
| `PAYMENT_IMAGE`                                                                     | VM env, reviewed Artifact Registry digest; generated Kubernetes image replacement   |

Do not reuse the local CLI signing secret for the deployed webhook. In Stripe
sandbox, configure an HTTPS snapshot endpoint at
`https://YOUR_DOMAIN/api/v1/billing/webhooks/stripe`, API version
`2026-09-30.endive`, with the nine event types in [Stripe setup](STRIPE_SETUP.md).
Configure the default Portal for invoice/payment method management and period-end
cancellation; disable plan switching/trials/pause/coupons. Review amounts/currency
before creating the two recurring Prices. This task has created none of them.
Live billing requires separate operational approval and implementation acceptance;
the current adapter rejects live credentials/events.

For an existing cluster, first quiesce all six apps and preserve a five-database
backup, objects, signing key and reviewed image digests. Apply the updated protected
ConfigMap/Secret and MySQL/Kafka manifests, wait for readiness, run the idempotent
MySQL bootstrap and topic/ACL setup from the earlier procedure, then execute **all
five** generated migration jobs, including `migrate-payment-service`. Roll out
only after every job completes; normal cloud startup has Flyway disabled. Create
the new Payment Deployment/Service/KSA on first upgrade before using the protected
update workflow, which assumes existing deployments. No public Payment port,
internal metrics or separate ingress is needed; the web gateway forwards bounded
billing bodies and exact raw webhook bytes.

For VM after configuring the protected values and reviewed images, use the
existing Compose overlays, run all five migrate-only service commands before
`up -d --no-build --wait`. The protected deployment workflow and generated jobs
already include Payment. Templates/static checks are local validation, not proof
that Stripe, HTTPS or cloud rollout works.

Validate `/healthz`, all five private readiness endpoints, anonymous billing
401, signature/version rejection, account-isolated request reads, actual sandbox
Checkout/paid invoice, complete four-participant saga, duplicate webhook/reply
handling, Portal/period-end cancel, expiry/failed renewal, and restart/broker
recovery. Run these against the deployed HTTPS endpoint and sandbox before making
billing available. Keep Stripe sandbox and cloud execution marked PENDING until
these checks actually run.

Backup now quiesces six apps and captures all five databases, including Payment
requests/receipts/saga leases/generations and each participant inbox/outbox. Stripe
is external and **cannot be rolled back by SQL restore**. During rollback/restore,
pause billing writes and Payment workers, retain the original encrypted backup,
compare current Stripe customers/subscriptions/invoices with restored mappings,
then reconcile affected accounts before opening Checkout. Old frontend/backend
images do not reverse purchases or refund charges. Keep additive migrations and
all five databases; never recreate a Stripe customer just because a restored row
is missing. Compensation queues a period-end cancellation and leaves money/refund
review explicit. Disable billing rather than expose inconsistent restored state.

Payment requests 100m CPU/128 MiB and has a 512 MiB memory limit. Recalculate six
image sizes, five-DB disk growth, Kafka retention, aggregate pod/VM CPU/RAM, egress,
backup retention and Stripe's current Billing/payment fees using the earlier cost
estimate procedure. Keep the **USD 300 total** learning budget; static estimates
are not spending evidence. For cleanup, pause billing, review/cancel sandbox test
subscriptions and webhook destinations in Stripe, then include Payment's
Deployment/Service/KSA/migration job, DB, Kafka principal/topic inventory, registry
digest and protected secrets in the existing reviewed cloud cleanup commands.
Removing infrastructure cannot cancel an external subscription. No resources,
live payments, registry pushes or deployment were performed by this task.

Payment KSA isolation above applies to GKE. On the single-VM lab, containers share the VM service account/metadata trust boundary; Docker does not create per-container IAM isolation. Keep that VM identity least-privileged and use GKE Workload Identity separation when independent workload IAM is required.

Latest local six-image Trivy gate has no High/Critical; each Java image retains 40 Medium/4 Low and Web 1 Medium. These findings are not waived. Rescan the exact reviewed digests before cloud publication/deployment; local image IDs and old scans do not certify a remote rollout.

## Native V4 reader/writer rollout (ADR030)

This format extension needs no SQL migration or new IAM grant. Build all service images with the new common codec. Roll out V4-capable Document, Processing and Collaboration readers before publishing the Web writer; then run a native V4 save/reopen and HTML export check through the public gateway. Identity and Payment share the rebuilt common artifact but their APIs and subscription state are unchanged. Keep a rollback image set that can read V4. Once V4 documents exist, an older V1–V3-only reader is not a safe rollback target; retain a compatible reader or perform a separately reviewed conversion without silently discarding new formatting. Cloud rollout remains DEPLOY_PENDING; local containers do not certify cloud deployment.

### Structured native V5 / office export rollout

Before enabling the new Web image, back up all five databases/storage/CRDT state and deploy readers that understand V1–V5 to all services. Apply Processing `V5__office_exports.sql` using the existing `migrate-processing-service` job (VM: migration-only profile). Verify Flyway V5 success and the jobs type check, then Processing readiness and TXT/HTML/DOCX/PDF job/download ACLs. Only then roll out Web V5 writers. API/event envelopes are unchanged; new job type enum values require matching schema readers. No additional IAM/resource/billing permission is needed; font resources are in the Processing image.

Validate an English/Vietnamese file with table/list/link/break/header/footer, save/reopen, concurrent cell edits, each export and revoked download denial. Do not claim cloud validation from local checks. Older images cannot read stored V5 files or new export job types. Roll back only to a compatible V5/office-reader image; an older binary rollback requires an explicitly reviewed database/object/CRDT backup restoration and handling of newer writes/jobs. Do not drop V5 metadata, mutate applied migrations or automatically downgrade files. Cloud deployment stays DEPLOY_PENDING and the USD 300 constraint is unchanged.
