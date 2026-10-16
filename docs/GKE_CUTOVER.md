# Chuyển hoàn toàn sang GKE Singapore và xóa VM cũ

Các lệnh chạy trong **Cloud Shell**. Codex chỉ chuẩn bị/push source; chưa tạo
resource, publish image, đổi DNS hay xóa VM. Giữ lựa chọn dữ liệu mới: database
GKE và bucket riêng, không import dữ liệu VM. Sau acceptance, xóa VM, boot disk
và IP cũ; dữ liệu database trên boot disk VM sẽ mất, không còn rollback VM.

Trong bootstrap giữ **environment = "vm"**; ở bước 7 xóa VM bằng gcloud rồi
đặt **environment = "none"** và refresh-only state. `none` chỉ áp dụng cho
Terraform hạ tầng dùng chung; app vẫn chạy hoàn toàn trên GKE. Cluster
`docnest-k8s-lab` được quản lý bằng gcloud/Kubernetes, chưa nằm trong state này.
Đổi thẳng selector sang `gke` sẽ tạo cluster Terraform `editor-lab` thứ hai:
không làm vậy. Không chạy terraform destroy. Budget tổng tương đương USD300 và
cấu hình VND/start-date đã sửa trong Cloud Shell được giữ nguyên.

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
Giới hạn deployment branch main. Tất cả workflow cloud trên main chỉ nhận
**cloud-gke**; workflow VM đã được bỏ. Copy Client ID/biến dùng chung trước khi
xóa environment cloud-lab ở bước 10.

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

Nếu build báo `Missing cloud-gke environment variable: GCP_PROJECT`, tạo các
**Environment Variables** bằng GitHub CLI trong Cloud Shell. Kiểm tra environment
cloud-gke tồn tại và chỉ cho deploy branch main ở Settings trước khi rerun.

```bash
gh --version
gh auth status --hostname github.com || gh auth login --hostname github.com --git-protocol https --web
export DOCNEST_REPO=DatTranDev/docnest
gh variable set GCP_PROJECT --repo "$DOCNEST_REPO" --env cloud-gke --body aitripmaster
gh variable set GCP_REGION --repo "$DOCNEST_REPO" --env cloud-gke --body asia-southeast1
gh variable set GCP_WIF_PROVIDER --repo "$DOCNEST_REPO" --env cloud-gke \
  --body projects/170229775963/locations/global/workloadIdentityPools/editor-ci/providers/github
gh variable set GCP_CI_SERVICE_ACCOUNT --repo "$DOCNEST_REPO" --env cloud-gke \
  --body editor-ci@aitripmaster.iam.gserviceaccount.com
gh variable set GOOGLE_CLIENT_ID --repo "$DOCNEST_REPO" --env cloud-gke \
  < "$HOME/.docnest-secrets/google-client-id.txt"
gh variable list --repo "$DOCNEST_REPO" --env cloud-gke
```

Nếu `gh` chưa có, cài GitHub CLI trước. Nếu file Client ID không còn, copy đúng
GOOGLE_CLIENT_ID từ environment cloud-lab vào Variables cloud-gke; không build
Web với ID khác runtime. Năm biến trên chỉ đủ cho publish images; cấu hình đầy
đủ Variables trong bảng trước **Build & deploy GKE**.

Sau khi Variables đã đúng, dùng **Re-run failed jobs** trên run build bị lỗi
config. CI validate đã PASS được giữ lại; chỉ job images chạy lại. Không rerun
run CI cũ có lỗi timeout nếu commit mới đã sửa. Đặt đúng environment cloud-gke,
không nạp password/JWT vào các biến public này.

Lần đầu: **Build cloud images (manual, no deploy) → main →
environment_name=cloud-gke**. Đợi scan/publish PASS, dùng đúng commit/digests
của run đó cho bootstrap. **Build & deploy GKE** cập nhật cluster đã bootstrap:
nó không tự tạo cluster, Secrets hay Ingress. Nếu GitHub vẫn hiện workflow VM,
đó là lịch sử run cũ; không chạy lại run VM.

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

## 7. Xóa VM, boot disk và IP cũ — chỉ sau bước 6 thành công

Đã chọn bỏ VM hoàn toàn: lệnh xóa boot disk cũng xóa năm database/volume Docker
trên VM. Kiểm tra login/create/save/reopen/share/export trên GKE trước bước này.
Không xóa VM tên `gke-*`: đó là node đang chạy Kubernetes.

Kiểm tra lại DNS/TLS/readiness và đúng VM/IP/disk trước khi xóa:

```bash
gcloud container clusters get-credentials "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
test "$(kubectl config current-context)" = "gke_${PROJECT}_${ZONE}_${CLUSTER}"
export GKE_IP=$(gcloud compute addresses describe docnest-k8s-lab-web \
  --project="$PROJECT" --global --format='value(address)')
test "$(dig +short "$MAIN_DOMAIN" A)" = "$GKE_IP"
test "$(kubectl -n editor-lab get managedcertificate editor-tls-main \
  -o jsonpath='{.status.certificateStatus}')" = Active
curl --fail --silent --show-error \
  --resolve "$MAIN_DOMAIN:443:$GKE_IP" "$MAIN_ORIGIN/healthz"
for service in identity-service document-service processing-service collaboration-service payment-service web; do
  kubectl -n editor-lab rollout status deployment/"$service" --timeout=300s
done
gcloud compute instances describe editor-lab --project="$PROJECT" --zone="$ZONE" \
  --format=json > "$TASK_DIR/retiring-vm.json"
gcloud compute addresses describe editor-lab-web --project="$PROJECT" --region="$REGION" \
  --format=json > "$TASK_DIR/retiring-ip.json"
"$PYTHON" - <<'PY'
import json, os, pathlib
root = pathlib.Path(os.environ['TASK_DIR'])
vm = json.loads((root / 'retiring-vm.json').read_text())
ip = json.loads((root / 'retiring-ip.json').read_text())
assert vm['name'] == 'editor-lab' and vm['zone'].endswith('/zones/asia-southeast1-a')
assert len(vm['disks']) == 1 and vm['disks'][0]['boot'] is True
assert vm['disks'][0]['source'].endswith('/disks/editor-lab')
assert ip['name'] == 'editor-lab-web' and ip['address'] == '34.87.46.187'
assert os.environ['GKE_IP'] != ip['address']
print('Verified old editor-lab VM/boot disk/regional IP; GKE IP is different.')
PY
```

Mọi kiểm tra phải thành công; nếu fail thì dừng ở đây. Với VM còn RUNNING,
dừng đúng project Compose để SQL/Kafka đóng trước khi delete. Nếu VM đã stopped,
bỏ đoạn SSH, chạy lệnh delete bên dưới.

```bash
gcloud compute ssh editor-lab --project="$PROJECT" --zone="$ZONE" \
  --tunnel-through-iap --command='
set -e
for service in https web identity-service document-service processing-service collaboration-service payment-service mysql kafka redis; do
  sudo docker ps -q --filter label=com.docker.compose.project=text-editor \
    --filter "label=com.docker.compose.service=$service" | xargs -r sudo docker stop -t 60
done
'
```

Chỉ xóa VM cũ đã kiểm tra, không dùng wildcard:

```bash
(
set -euo pipefail
test "$(kubectl config current-context)" = "gke_${PROJECT}_${ZONE}_${CLUSTER}"
test "$(dig +short "$MAIN_DOMAIN" A)" = "$GKE_IP"
test "$(kubectl -n editor-lab get managedcertificate editor-tls-main \
  -o jsonpath='{.status.certificateStatus}')" = Active
curl --fail --silent --show-error \
  --resolve "$MAIN_DOMAIN:443:$GKE_IP" "$MAIN_ORIGIN/healthz"
for service in identity-service document-service processing-service collaboration-service payment-service web; do
  kubectl -n editor-lab rollout status deployment/"$service" --timeout=300s
done
gcloud compute instances update editor-lab --project="$PROJECT" --zone="$ZONE" \
  --no-deletion-protection
gcloud compute instances delete editor-lab --project="$PROJECT" --zone="$ZONE" \
  --delete-disks=boot
gcloud compute addresses delete editor-lab-web --project="$PROJECT" --region="$REGION"
)
```

[Tắt deletion protection](https://docs.cloud.google.com/sdk/gcloud/reference/compute/instances/update),
[xóa instance kèm boot disk](https://docs.cloud.google.com/sdk/gcloud/reference/compute/instances/delete),
[release đúng regional IP](https://docs.cloud.google.com/sdk/gcloud/reference/compute/addresses/delete).
Không xóa global IP `docnest-k8s-lab-web`, VPC/subnet, registry, JWT/password
Secrets hoặc runtime/node accounts: GKE đang dùng chúng. Bucket cũ được giữ
riêng, chưa xóa object; storage cũ vẫn có thể phát sinh phí.

Sau khi ba resource VM/disk/IP đã bị xóa, đồng bộ Terraform mà không provision:

```bash
cd ~/docnest
cp infra/gcp/terraform.tfvars "$TASK_DIR/terraform-before-vm-retirement.tfvars"
"$PYTHON" - <<'PY'
import pathlib, re
path = pathlib.Path('infra/gcp/terraform.tfvars')
text, count = re.subn(r'(?m)^[ \t]*environment[ \t]*=[ \t]*"(?:vm|none)"[ \t]*$',
                      'environment = "none"', path.read_text())
assert count == 1, 'Expected exactly one vm/none environment; review tfvars manually.'
path.write_text(text)
PY
"$HOME/.local/bin/terraform" -chdir=infra/gcp init
# Also works with older checkouts that do not configure provider quota overrides.
export GOOGLE_BILLING_PROJECT="$PROJECT"
export USER_PROJECT_OVERRIDE=true
"$HOME/.local/bin/terraform" -chdir=infra/gcp plan -refresh-only \
  -out=retired-vm-refresh.plan
"$HOME/.local/bin/terraform" -chdir=infra/gcp apply retired-vm-refresh.plan
"$HOME/.local/bin/terraform" -chdir=infra/gcp state list
```

Đọc plan trước apply: đây phải là refresh-only sau khi cloud resource đã xóa,
không phải plan destroy/create. State list không còn `google_compute_instance.vm[0]`
và `google_compute_address.vm[0]`. Nếu Terraform lỗi kết nối API thì retry plan;
không dùng state rm để bỏ resource chưa kiểm tra đã xóa. Giữ file budget VND
và budget_start_date cũ, không apply lại plan VM cũ. Import GKE vào Terraform
cần review riêng; không chạy full apply với selector `gke` hiện tại.

[Refresh-only](https://developer.hashicorp.com/terraform/cli/commands/apply)
cập nhật state theo thay đổi ngoài Terraform mà không tạo/xóa cloud resource.

Nếu Budget refresh báo ADC thiếu quota project và consumer project không phải
project lab, đặt hai biến môi trường trên rồi **tạo lại** refresh-only plan.
Provider hiện cấu hình `billing_project = var.project_id` và
`user_project_override = true` để gửi quota project rõ ràng. Chỉ đặt project trong
gcloud hoặc thêm quota project vào ADC không thay thế provider override này.
Không bật API trong consumer project của bộ SDK và không bỏ budget khỏi state.
[Google provider quota configuration](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/provider_reference#quota-management-configuration).

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
Không đổi DNS, tạo cluster/Secrets hay đọc SQL/JWT bằng deploy account.

Nếu fail trước mutations, kiểm tra lỗi rồi operator có thể resume app cũ,
backend trước Web. Nếu migrations/config/images đã đổi, review Flyway/history/
backup trước recovery; không tự rollback DDL/scale app cũ một cách mù quáng.
Real GKE/backup restore vẫn DEPLOY_PENDING cho đến khi operator thực thi.

## 10. Xác nhận runtime chỉ còn GKE và bỏ environment VM

```bash
gcloud compute instances list --project="$PROJECT" --filter='name=editor-lab' \
  --format='table(name,zone,status)'
gcloud compute disks list --project="$PROJECT" --filter='name=editor-lab' \
  --format='table(name,zone,status)'
gcloud compute addresses list --project="$PROJECT" --filter='name=editor-lab-web' \
  --format='table(name,address,region,status)'
gcloud container clusters list --project="$PROJECT" \
  --format='table(name,location,status,currentNodeCount)'
kubectl -n editor-lab get deployments,statefulsets,pods,pvc,ingress
curl --fail --silent --show-error "$MAIN_ORIGIN/healthz"
```

Ba bảng VM/disk/IP cũ phải rỗng; cluster `docnest-k8s-lab` RUNNING, tám backend/
infra workload và Web Ready. Node GKE vẫn là Compute Engine VM bên dưới và có
phí node: không xóa node bằng compute instances delete.

GitHub → Settings → Environments → **cloud-lab** → Delete environment, sau khi
đã copy Google Client ID và biến dùng chung sang cloud-gke. Giữ cloud-gke và
WIF/editor-ci/editor-deploy. Run mới chỉ dùng **Build & deploy GKE** trên main;
run VM cũ trong Actions là lịch sử, không rerun. Recovery về sau dùng backup GKE
và digest trước đó sau review schema; VM đã xóa không còn đường start/rollback.

GKE cluster/certificate/functional acceptance, backup restore và việc xóa VM
vẫn **DEPLOY_PENDING/NOT_RUN** cho tới khi operator thực thi trên Google Cloud.
