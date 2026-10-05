# Google Cloud deployment within the lab budget

USD 300 covers the entire learning period, not a monthly spending target. Estimate USD 65–95 per month for a continuously running VM, then USD 40–60 for approximately two weeks of GKE. These are light-load estimates, not application invoices. Confirm the regional calculator estimate and check billing daily.

## Allocation

| Item                                                       | Reserved amount |
| ---------------------------------------------------------- | --------------- |
| VM, disk, IPv4, storage and logs for approximately 6 weeks | USD 170         |
| GKE lab for 1–2 weeks                                      | USD 60          |
| Reserve                                                    | USD 70          |

Keep only one paid environment active at a time. Local Docker incurs no cloud charges. If USD 300 is free-trial credit, check expiry and quotas in the billing account; do not assume that credits last indefinitely or renew automatically.

## Local development

Use Docker Desktop with WSL2 on Windows, Docker Compose v2, JDK 21, Node 24, Maven Wrapper and Git. Add gcloud and kubectl for the cloud steps. Base Compose includes mysql, redis, kafka and proxy; the app profile adds three services and web. MySQL has three databases/users. Kafka uses one KRaft broker/controller and a persistent volume. Local Redis persistence is optional because the cache can be rebuilt. Expose proxy port 8080; bind SQL/Redis/Kafka ports only to localhost when needed for debugging. Use health checks and depends_on condition service_healthy. Applications still need reconnect logic because startup ordering does not guarantee ongoing dependency availability.

Each service has application-local and application-cloud profiles. StorageProvider switches local/GCS through createUpload,inspect,read,createDownload,deleteGeneration. Local paths live in volumes and use server-generated names; reject user-supplied traversal paths. Run fixtures and migrations before smoke tests.

## Google Cloud VM

1. Create a dedicated lab project, enable billing and budget alerts at USD 100/180/230, and add a forecast alert. Enable Compute, Storage, Artifact Registry, IAM Credentials, Logging and Secret Manager as needed.
2. Select one region, such as us-central1 as the cost baseline. Recalculate before choosing Singapore. Keep buckets and the VM in the same region. Start with e2-standard-2, 2 vCPU and 8 GiB RAM. Increase only when measurements justify it. Use a 50–100 GiB balanced disk.
3. Create private snapshots and results buckets with uniform access and public access prevention. CORS permits only the web origin and required PUT/GET operations. Configure soft delete and retention explicitly to avoid unexpectedly retaining cleaned objects. Do not apply an age-only lifecycle to all snapshots; application GC decides which references are live.
4. Use a dedicated deployment service account and minimal bucket/secret permissions for the runtime VM. Shared workload identity among containers on one VM is a lab trade-off. Never put private JSON keys in a repository or image. Use IAM signBlob for GCS signed GET URLs without a local key; until configured, stream through an authenticated proxy.
5. Create a regional Artifact Registry repository. CI pushes tested image digests. Copy Compose and environment references and pull images. Keep secrets in Secret Manager or root-only files outside Git, never baked into images.
6. Expose only HTTPS 443 and HTTP 80 for redirects; restrict SSH or use IAP. Never expose 3306/6379/9092 or /internal publicly. Use Caddy/NGINX and your own domain if available. HTTPS is required for Secure cookies. Domain costs are excluded from this estimate.
7. Configure volumes and mysqldump backups to a private bucket. Perform a restore drill before relying on important data. Immutable native objects mean DB backups still need the corresponding object-reference manifests.
8. Smoke-test two users, a folder, Unicode styling and saving, VIEWER/EDITOR sharing, revocation, conflicts, public links, export, container restart and reload. Record billing, CPU, RAM, latency and image digests in the deployment report.

Starting container RAM limits: Identity 512 MiB, Document 768 MiB, Processing 768 MiB, Kafka 1536 MiB, MySQL 768 MiB, Redis 256 MiB and proxy/web 128 MiB. Leave room for the OS, page cache and overhead. JVM heap must be below the container limit; for example, MaxRAMPercentage=60. These limits do not imply a passed benchmark. Processing concurrency is 2 and native validation concurrency is 2, with bounded queues.

## CI and CD

GitHub Actions runs lint/typecheck, unit/property tests, MySQL/Kafka integration tests and image builds. Use OIDC Workload Identity Federation to push to Artifact Registry; do not store service-account JSON keys in GitHub. Tag with commit SHA and deploy by digest. Run migrations as a separate job before rollout and keep schemas backward-compatible. Do not have every pod ALTER concurrently. Run health checks and smoke tests, then roll back the app image on failure. Do not automatically roll back DDL in a way that destroys data.

## GKE lab

Create GKE Standard zonal with one e2-standard-2 node in one node pool. Initially disable autoscaling or cap it at 1. Do not accept regional defaults with multiple nodes before costing them. The monthly USD 74.40 GKE credit covers eligible zonal/Autopilot cluster management fees only, not nodes, PVCs or load balancers.

Use namespace editor-lab. Deploy three services and web as Deployments with ClusterIP Services. MySQL and Kafka each use a 1-replica StatefulSet and PVC. Redis can use a 1-replica Deployment when it is only a cache. Use one public ingress/load balancer for a demo if needed; internal learning sessions can use port-forward without a load balancer. Add startup probes for JVM/Kafka and readiness for mandatory dependencies. Liveness must not fail merely because Kafka/Redis is temporarily unavailable. Set explicit CPU/RAM requests and limits and inspect node allocatable capacity before applying. Use persistent-disk-backed PVCs, not emptyDir for SQL/Kafka data.

Workload Identity Federation for GKE grants Document/Processing their respective bucket/secret access. Do not use node-wide application keys. The reverse proxy blocks /internal; the private lab service key does not replace IAM. After reaching steady state, scale Processing to 2 replicas to learn consumer groups, rolling updates and leases. Stateful services remain at 1 replica and are not highly available. GKE scheduler/system memory leaves less headroom on an 8 GiB node than a VM. Reduce concurrency or use 16 GiB during a short lab if measurements require it; do not automatically scale for an entire month.

```text
gcloud config set project YOUR_LAB_PROJECT
gcloud artifacts repositories create editor --repository-format=docker --location=us-central1
gcloud container clusters create editor-lab --zone=us-central1-a --num-nodes=1 --machine-type=e2-standard-2 --disk-size=50 --release-channel=regular
gcloud container clusters get-credentials editor-lab --zone=us-central1-a
kubectl apply -k infra/k8s/overlays/lab
kubectl -n editor-lab rollout status deployment/document-service
kubectl -n editor-lab get pods,pvc,services
```

These commands are for deployment after P15 has created and validated manifests and the billing estimate is agreed. The document itself creates no resources. The cluster command is a skeleton; P15 must add workload identity, node service account/IAM and appropriate network policy. Do not apply manifests without secrets or volumes merely to make smoke tests pass.

## Cleanup

Capture any DB backup or fixture that must be kept, then delete the GKE cluster when the lab ends. Check for orphan PVC disks, forwarding rules, load balancers, IPs, Artifact Registry images, logging retention and soft-deleted bucket objects. Stopping a VM reduces CPU/RAM charges but disks, static IPs and storage still cost money; delete resources at the end. Budget alerts are not a hard cap. Spend caps support some services but do not stop persistent compute/storage. Do not expect an alert at exactly USD 300 to prevent an overspend.

```text
gcloud container clusters delete editor-lab --zone=us-central1-a
gcloud compute disks list
gcloud compute addresses list
gcloud compute forwarding-rules list
```

Do not create a script that deletes every project or resource. Cleanup scripts require the correct project/labels, a dry run listing resources, and confirmation before destroying data. Provision real infrastructure only when the user requests deployment.
