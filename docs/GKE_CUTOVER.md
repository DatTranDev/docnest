# Chuyển từ VM sang GKE với dữ liệu mới

Các lệnh chạy trong **Cloud Shell**. Codex chỉ chuẩn bị/push source; chưa tạo
resource, publish image, đổi DNS hay dừng VM. Giữ lựa chọn dữ liệu mới: database
GKE và bucket riêng; dữ liệu VM được giữ để quay lại, không tự import sang GKE.

Giữ **environment = "vm"** trong Terraform hiện tại. Đổi selector sang gke/none
sẽ plan xóa VM/IP. Cluster tạo riêng bằng gcloud; stop VM giữ state/disk. Import
GKE hoặc xóa hẳn VM cần một kế hoạch riêng. Budget USD300 tổng không thay đổi.

## 1. Kéo source và chọn Singapore

```bash
cd ~/docnest
git pull --ff-only
gcloud config set project aitripmaster
export PROJECT=aitripmaster REGION=asia-southeast1 ZONE=asia-southeast1-a
export CLUSTER=docnest-k8s-lab
export TASK_DIR="$HOME/.docnest-k8s-lab"
export SNAPSHOTS=aitripmaster-docnest-k8s-snapshots
export RESULTS=aitripmaster-docnest-k8s-results
export BACKUPS=aitripmaster-docnest-k8s-backups
export MAIN_DOMAIN=docsnest.dattrandev.id.vn
export MAIN_ORIGIN="https://$MAIN_DOMAIN"
set +x
umask 077
mkdir -p "$TASK_DIR"
chmod 700 "$TASK_DIR"
export PYTHON="$TASK_DIR/venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  python3 -m venv "$TASK_DIR/venv"
fi
"$TASK_DIR/venv/bin/pip" install PyYAML==6.0.3
```

Nếu GKE chưa có app khỏe, tạo environment theo bước 2 trước, rồi làm **bước
1–10** của [GKE_SINGAPORE_LAB.md](GKE_SINGAPORE_LAB.md) để bootstrap ở
**https://k8s.docsnest.dattrandev.id.vn**; sau đó quay lại bước 3. VM vẫn online
trong giai đoạn đó. Không đổi DNS/dừng VM khi GKE chưa sẵn sàng. Một node là
learning lab, không HA.

## 2. Tạo GitHub environment cloud-gke trước build

GitHub → Settings → Environments → New environment → **cloud-gke**.
Giới hạn deployment branch main; giữ environment cloud-lab của VM.

Tạo/copy **Variables**, không đưa password/JWT vào các biến này:

| Variable                                           | Giá trị                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GCP_PROJECT                                        | aitripmaster                                                                            |
| GCP_REGION                                         | asia-southeast1                                                                         |
| GCP_ZONE                                           | asia-southeast1-a                                                                       |
| GKE_CLUSTER                                        | docnest-k8s-lab                                                                         |
| GCP_WIF_PROVIDER                                   | projects/170229775963/locations/global/workloadIdentityPools/editor-ci/providers/github |
| GCP_CI_SERVICE_ACCOUNT                             | editor-ci@aitripmaster.iam.gserviceaccount.com                                          |
| GCP_DEPLOY_SERVICE_ACCOUNT                         | editor-deploy@aitripmaster.iam.gserviceaccount.com                                      |
| GOOGLE_CLIENT_ID                                   | Cùng Client ID đã dùng để build Web                                                     |
| WEB_ORIGIN                                         | https://k8s.docsnest.dattrandev.id.vn khi bootstrap; domain chính ở bước 5              |
| GCS_SNAPSHOTS_BUCKET                               | aitripmaster-docnest-k8s-snapshots                                                      |
| GCS_RESULTS_BUCKET                                 | aitripmaster-docnest-k8s-results                                                        |
| GCS_BACKUPS_BUCKET                                 | aitripmaster-docnest-k8s-backups                                                        |
| MAX_USERS                                          | 100                                                                                     |
| STRIPE_PRO_MONTHLY_PRICE / STRIPE_PRO_YEARLY_PRICE | Để rỗng cho lab                                                                         |

Lần đầu: **Build cloud images (manual, no deploy) → main →
environment_name=cloud-gke**. Đợi scan/publish PASS, dùng đúng commit/digests
của run đó cho bootstrap. **Build & deploy GKE** cập nhật cluster đã bootstrap:
nó không tự tạo cluster, Secrets hay Ingress.

## 3. Bucket backup và quyền deploy — một lần

Nếu chưa có bucket, chạy:

```bash
gcloud storage buckets create "gs://$BACKUPS" --project="$PROJECT" \
  --location="$REGION" --uniform-bucket-level-access --public-access-prevention
"$PYTHON" - <<'PY'
import json, os, pathlib
pathlib.Path(os.environ['TASK_DIR'], 'backup-lifecycle.json').write_text(json.dumps({
    'rule': [{'action': {'type': 'Delete'}, 'condition': {'age': 14}}]
}))
PY
gcloud storage buckets update "gs://$BACKUPS" \
  --lifecycle-file="$TASK_DIR/backup-lifecycle.json"
```

Nếu bucket đã có, kiểm tra/reuse, không xóa nó để vượt lỗi. Lifecycle này chỉ
áp dụng backup; snapshot không được xóa bằng lifecycle theo tuổi. Soft-delete
có thể giữ thêm byte có tính phí.

Sau khi namespace/app đã bootstrap:

```bash
bash tooling/scripts/setup_gke_deploy.sh \
  "$PROJECT" "$ZONE" "$CLUSTER" DatTranDev/docnest "$BACKUPS"
```

Script tạo/reuse SA editor-deploy, WIF repository hiện có, Cluster Viewer,
RBAC ConfigMap/app Deployments/migration Jobs trong namespace editor-lab và
Object Viewer chỉ trên backup bucket này. Không thêm quyền get/list Secrets,
quản trị Terraform hay ghi registry cho deploy identity. Job create là quyền
mạnh trong namespace: giữ main/environment được bảo vệ, chỉ chạy image đã review.
Workflow không đọc SQL/JWT bằng deploy identity.

## 4. Chọn đúng cluster và thêm certificate domain chính

```bash
gcloud container clusters get-credentials "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
kubectl config current-context
kubectl -n editor-lab get deployments,pods,pvc
export GKE_IP=$(gcloud compute addresses describe docnest-k8s-lab-web \
  --project="$PROJECT" --global --format='value(address)')
printf '%s\n' "$GKE_IP"
export TRUSTED_PROXY_CIDRS="35.191.0.0/16,130.211.0.0/22,$GKE_IP/32"
```

IP phải là global static IP của Ingress editor-public, không phải IP VM.
[GFE ranges](https://docs.cloud.google.com/load-balancing/docs/https) trên dành
classic external Ingress/NEG; không dùng cho regional proxy subnet khác.

Giữ certificate lab. Tạo certificate mới cho domain chính, không cập nhật
domains của Google-managed certificate cũ tại chỗ. Cho HTTP frontend trong
lúc load balancer/certificate lập trình, chỉ tắt sau khi TLS chính Active.

```bash
"$PYTHON" - <<'PY'
import os, pathlib, yaml
obj = {'apiVersion': 'networking.gke.io/v1', 'kind': 'ManagedCertificate',
       'metadata': {'name': 'editor-tls-main', 'namespace': 'editor-lab'},
       'spec': {'domains': [os.environ['MAIN_DOMAIN']]}}
pathlib.Path(os.environ['TASK_DIR'], 'main-certificate.yaml').write_text(yaml.safe_dump(obj))
PY
kubectl apply --dry-run=server -f "$TASK_DIR/main-certificate.yaml"
kubectl apply -f "$TASK_DIR/main-certificate.yaml"
kubectl -n editor-lab annotate ingress editor-public \
  networking.gke.io/managed-certificates=editor-tls,editor-tls-main --overwrite
kubectl -n editor-lab annotate ingress editor-public \
  kubernetes.io/ingress.allow-http=true --overwrite
```

## 5. Đổi cấu hình GKE sang domain chính

Trong **cloud-gke**, đặt WEB_ORIGIN=https://docsnest.dattrandev.id.vn và
TRUSTED_PROXY_CIDRS bằng chuỗi vừa tính. Giữ bucket GKE riêng và Google Client ID
cũ. OAuth giữ Authorized JavaScript origins cho domain chính và lab.

CORS cho cả hai origin trong giai đoạn chuyển:

```bash
"$PYTHON" - <<'PY'
import json, os, pathlib
pathlib.Path(os.environ['TASK_DIR'], 'cors-cutover.json').write_text(json.dumps([{
    'origin': ['https://k8s.docsnest.dattrandev.id.vn', os.environ['MAIN_ORIGIN']],
    'method': ['PUT', 'GET', 'HEAD'],
    'responseHeader': ['Content-Type', 'Content-Length', 'Content-Range', 'Range', 'ETag'],
    'maxAgeSeconds': 3600
}]))
pathlib.Path(os.environ['TASK_DIR'], 'main-origin.json').write_text(json.dumps({
    'data': {key: os.environ['MAIN_ORIGIN'] for key in (
        'WEB_ORIGIN', 'ALLOWED_ORIGINS', 'PUBLIC_BASE_URL', 'JWT_ISSUER')}
}))
PY
gcloud storage buckets update "gs://$SNAPSHOTS" --cors-file="$TASK_DIR/cors-cutover.json"
gcloud storage buckets update "gs://$RESULTS" --cors-file="$TASK_DIR/cors-cutover.json"
kubectl -n editor-lab patch configmap editor-config --type=merge \
  --patch-file="$TASK_DIR/main-origin.json"
kubectl -n editor-lab rollout restart deployment/identity-service deployment/document-service \
  deployment/processing-service deployment/collaboration-service deployment/payment-service
for service in identity-service document-service processing-service collaboration-service payment-service; do
  kubectl -n editor-lab rollout status deployment/"$service" --timeout=600s || break
done
```

Chỉ khi cả năm backend Ready mới chạy:

```bash
kubectl -n editor-lab set env deployment/web "TRUSTED_PROXY_CIDRS=$TRUSTED_PROXY_CIDRS"
kubectl -n editor-lab rollout restart deployment/web
kubectl -n editor-lab rollout status deployment/web --timeout=300s
```

Không chạy migrations mới trong bước đổi origin. Lab origin có thể không login
được sau khi đổi canonical origin. VM vẫn phục vụ các client còn DNS cũ.
Đây là maintenance cutover, không hứa zero downtime.

## 6. Đổi DNS và xác nhận GKE trên domain chính

Ở DNS, đổi **A record docsnest** từ **34.87.46.187** sang GKE_IP bước 4.
Cloudflare dùng DNS-only; bỏ AAAA/CNAME xung đột của đúng hostname. Không cần
đổi k8s.docsnest. DNS/certificate có thể mất thời gian; domain phải trỏ LB
để Google cấp certificate chính.

```bash
dig +short "$MAIN_DOMAIN" A
test "$(dig +short "$MAIN_DOMAIN" A)" = "$GKE_IP"
kubectl -n editor-lab describe managedcertificate editor-tls-main
curl --fail --silent --show-error \
  --resolve "$MAIN_DOMAIN:443:$GKE_IP" "$MAIN_ORIGIN/healthz"
curl --fail --silent --show-error "$MAIN_ORIGIN/healthz"
```

Certificate phải **Active**, cả hai curl thành công. Mở domain chính, logout/
login lại để bỏ cookie/token VM cũ, kiểm tra create/save/reopen qua GCS,
folder/share/revoke và export thật. Database GKE mới không có user/document VM.
Máy/browser dùng để test cũng phải resolve domain sang GKE_IP; chờ TTL/cache
DNS cũ hết trước khi coi browser test là kiểm tra GKE.

```bash
kubectl -n editor-lab annotate ingress editor-public \
  kubernetes.io/ingress.allow-http=false --overwrite
```

[Trình tự HTTP/certificate](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/secure-traffic-management).

## 7. Dừng VM — chỉ sau bước 6 thành công

Dừng đúng Compose project, Web/backend trước rồi MySQL/Kafka/Redis. Giữ volume,
không docker down -v. Các lệnh dưới đây thực sự làm app VM offline.

```bash
gcloud compute ssh editor-lab --project="$PROJECT" --zone="$ZONE" \
  --tunnel-through-iap --command='
set -e
for service in https web identity-service document-service processing-service collaboration-service payment-service mysql kafka redis; do
  sudo docker ps -q --filter label=com.docker.compose.project=text-editor \
    --filter "label=com.docker.compose.service=$service" | xargs -r sudo docker stop -t 60
done
'
gcloud compute instances stop editor-lab --project="$PROJECT" --zone="$ZONE"
gcloud compute instances describe editor-lab --project="$PROJECT" --zone="$ZONE" \
  --format='value(status)'
```

Kết quả **TERMINATED** là stopped của GCE, không phải xóa VM. Từ đây dùng workflow
GKE. VM compute dừng; boot disk và reserved IP giữ rollback vẫn có phí. Không
chạy Build & deploy VM khi VM ngừng. [Stop/start VM](https://docs.cloud.google.com/compute/docs/instances/stop-start-instance).

## 8. Backup GKE trước mỗi Build & deploy GKE

Nếu chưa có age key, tạo một lần. Cất private key ngoài VM/cluster; không paste
private key/SQL/tar plaintext vào Actions. Public recipient dùng để encrypt.

```bash
sudo apt-get update
sudo apt-get install -y age
mkdir -p "$HOME/.docnest-secrets"
chmod 700 "$HOME/.docnest-secrets"
if [ ! -s "$HOME/.docnest-secrets/backup-age.key" ]; then
  age-keygen -o "$HOME/.docnest-secrets/backup-age.key"
fi
export AGE_RECIPIENT=$(age-keygen -y "$HOME/.docnest-secrets/backup-age.key")
chmod 600 "$HOME/.docnest-secrets/backup-age.key"
age -r "$AGE_RECIPIENT" -o "$TASK_DIR/age-probe.age" /dev/null
```

Lấy **digests hiện đang chạy**, không dùng digests của bản sắp deploy. Operator
scale app về 0, đợi Pod biến mất, capture bằng helper đã có. **Giữ app paused
đến khi workflow hoàn tất** để không phát sinh write sau backup. Node/stateful
services vẫn chạy. Build/test/scan có thể lâu; đây là maintenance của learning lab.

```bash
gcloud container clusters get-credentials "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
export LIVE_CONTEXT=$(kubectl config current-context)
export STAMP=$(date -u +%Y%m%dT%H%M%SZ)
export ARCHIVE="$TASK_DIR/gke-backup-$STAMP"
kubectl --context "$LIVE_CONTEXT" -n editor-lab get deployments \
  identity-service document-service processing-service collaboration-service payment-service web \
  -o json > "$TASK_DIR/deployments-before-backup.json"
"$PYTHON" - <<'PY'
import json, os, pathlib, sys
sys.path.insert(0, 'tooling/scripts')
from digest_manifest import validate_manifest
root = pathlib.Path(os.environ['TASK_DIR'])
rows = json.loads((root / 'deployments-before-backup.json').read_text())['items']
images = {r['metadata']['name']: r['spec']['template']['spec']['containers'][0]['image'] for r in rows}
validate_manifest(images, os.environ['PROJECT'], os.environ['REGION'])
if any(r['spec'].get('replicas', 1) != 1 or r.get('status', {}).get('availableReplicas', 0) < 1 for r in rows):
    raise SystemExit('Backup cần sáu Deployment khỏe, mỗi service 1 replica')
(root / 'running-digests.json').write_text(json.dumps(images))
PY
kubectl --context "$LIVE_CONTEXT" -n editor-lab scale deployment \
  identity-service document-service processing-service collaboration-service payment-service web --replicas=0
for service in identity-service document-service processing-service collaboration-service payment-service web; do
  kubectl --context "$LIVE_CONTEXT" -n editor-lab wait --for=delete pod -l "app=$service" --timeout=300s || break
done
"$PYTHON" tooling/scripts/cloud_backup.py backup --environment gke --project "$PROJECT" \
  --kube-context "$LIVE_CONTEXT" --directory "$ARCHIVE" --images "$TASK_DIR/running-digests.json" \
  --jwt-secret-version "projects/$PROJECT/secrets/editor-jwt/versions/1"
```

Không đi tiếp sau lỗi. Chỉ encrypt/upload khi helper thành công, có manifest.
Nếu retry, đổi STAMP vì helper không ghi đè directory.

```bash
test -s "$ARCHIVE/manifest.json"
tar -C "$TASK_DIR" -cf "$ARCHIVE.tar" "$(basename "$ARCHIVE")"
age -r "$AGE_RECIPIENT" -o "$ARCHIVE.tar.age" "$ARCHIVE.tar"
export BACKUP_REFERENCE="gs://$BACKUPS/gke/backup-$STAMP.age"
gcloud storage cp "$ARCHIVE.tar.age" "$BACKUP_REFERENCE" \
  --project="$PROJECT" --if-generation-match=0
printf '%s\n' "$BACKUP_REFERENCE"
```

Dùng reference gs://...age vào workflow. Raw files/tar ở thư mục private cần
bảo mật/dọn sau khi operator xác minh encrypted archive và thực hiện restore
drill. Object existence/size không chứng minh backup restore được.

## 9. Bấm Build & deploy GKE

GitHub → **Actions → Build & deploy GKE → Run workflow → main**, điền
**backup_reference** vừa tạo. Tự chain build/scan/publication và deploy.

Workflow dùng **cloud-gke**, same-run commit/main/V6/Google Client ID/sáu digest
checks, reference phải là encrypted object trong bucket cấu hình và tồn tại/
size >0, server dry-run, năm migrations, backend trước Web và public health.
Không đổi DNS/dừng VM, tạo cluster/Secrets hay đọc SQL/JWT bằng deploy account.

Nếu fail trước mutations, kiểm tra lỗi rồi operator có thể resume app cũ,
backend trước Web. Nếu migrations/config/images đã đổi, review Flyway/history/
backup trước recovery; không tự rollback DDL/scale app cũ một cách mù quáng.
Real GKE/backup restore vẫn DEPLOY_PENDING cho đến khi operator thực thi.

## 10. Quay lại VM trong thời gian rollback

```bash
gcloud compute instances start editor-lab --project="$PROJECT" --zone="$ZONE"
gcloud compute ssh editor-lab --project="$PROJECT" --zone="$ZONE" \
  --tunnel-through-iap --command='
set -e
for service in mysql kafka redis identity-service document-service processing-service collaboration-service payment-service web https; do
  sudo docker ps -aq --filter label=com.docker.compose.project=text-editor \
    --filter "label=com.docker.compose.service=$service" | xargs -r sudo docker start
done
sudo docker ps --format "table {{.Names}}\t{{.Status}}"
'
```

Container bị stop tay không tự start bằng restart policy, nên cần docker start.
Đợi mọi container healthy và HTTPS VM đúng domain rồi đổi A record docsnest
về **34.87.46.187**. Đóng write GKE trước rollback. VM chứa dữ liệu VM cũ,
không chứa write mới trên GKE; đây không phải đồng bộ hai database.
Giữ disk/IP cho rollback; muốn xóa hẳn phải review retention/restore/state riêng.
