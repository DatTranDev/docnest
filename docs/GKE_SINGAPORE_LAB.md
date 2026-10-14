# Thử docsnest trên GKE Singapore với dữ liệu mới

Các lệnh dưới đây chạy trong **Cloud Shell**, theo thứ tự. Đây là hướng dẫn cho
operator; Codex chưa tạo cluster, bucket, load balancer hay deploy cloud.

Lab mới dùng cluster `docnest-k8s-lab`, namespace `editor-lab`, domain
`k8s.docsnest.dattrandev.id.vn` và hai bucket riêng. Database bắt đầu trống.
VM `editor-lab`, domain hiện tại và các bucket cũ được giữ nguyên.

Để chuyển domain chính và dừng VM sau khi lab hoạt động, dùng
[GKE_CUTOVER.md](GKE_CUTOVER.md). GitHub dùng environment riêng **cloud-gke**:
tạo/copy Variables ở bước 2 của tài liệu cutover trước khi chạy build cloud.

**Giữ `environment = "vm"` trong Terraform hiện tại.** Đổi sang `gke` sẽ lên kế
hoạch xóa VM và IP của VM. Cluster thử nghiệm này được tạo riêng bằng gcloud,
không do Terraform hiện tại quản lý; muốn đưa nó vào Terraform sau này phải
thiết kế/import state riêng trước. Không chạy terraform destroy cho lab này.

## Chi phí cần biết trước khi tạo

Giá tham khảo kiểm tra ngày 13/10/2026; giả định 730 giờ/tháng:

- GKE quản lý cluster: $0.10/giờ, khoảng **$73/tháng**. Free tier có **$74.40/tháng
  mỗi billing account** cho zonal Standard/Autopilot. Nếu phần credit này còn
  đủ thì phí quản lý một zonal cluster được bù; credit không trả tiền node.
  [Giá GKE](https://cloud.google.com/kubernetes-engine/pricing).
- Một node `e2-standard-2` vẫn được tính tiền Compute Engine như một VM cùng
  cỡ máy ở Singapore. Chọn Singapore, E2, 2 vCPU/8 GiB, 1 node, 730 giờ và
  không commitment trong [Pricing Calculator](https://cloud.google.com/products/calculator)
  để lấy tiền node hiện tại. GKE không miễn phí máy chạy container.
- Public Ingress: forwarding-rule fee $0.025/giờ, khoảng **$18.25/tháng**, cộng
  xử lý traffic và internet egress. [Giá load balancer](https://cloud.google.com/load-balancing/pricing).
- Ngoài boot disk 50 GiB, manifest tạo PVC MySQL 20 GiB và Kafka 10 GiB. Tính
  thêm 30 GiB disk provisioned dù dữ liệu còn ít. Dành dự toán khoảng $3–5/tháng
  cho hai PVC, rồi xác nhận SKU Singapore trong calculator; đây là dự toán,
  không phải báo giá cố định. [Giá disk](https://cloud.google.com/compute/disks-image-pricing?hl=en).
- Node có external IPv4 cũng có phí IP; GCS, registry, logs, backup và traffic
  tính riêng. IP gắn forwarding rule có cách tính khác IP trên VM.
  [Giá network/IP](https://cloud.google.com/vpc/network-pricing).

Nếu GKE **thay thế** VM cùng cỡ máy và management credit còn đủ, dự trù phần
chênh lệch nền khoảng **$20–35/tháng**, cộng traffic/logs và dung lượng phát sinh.
Nếu giữ VM chạy cùng lab này, phải cộng **toàn bộ tiền node, boot disk và IP GKE**
vào hóa đơn hiện tại; không chỉ cộng $20–35. Không có đủ management credit thì
cộng thêm phí quản lý tương ứng, tối đa khoảng $73 cho 730 giờ một cluster.

Budget USD300 là tổng ngân sách học hiện có, không phải USD300 mới mỗi tháng.
Budget alert đang dùng là cảnh báo, không tự tắt node hay chặn hóa đơn khi chạm
ngưỡng. [Cách hoạt động của alerts-only budget](https://docs.cloud.google.com/billing/docs/how-to/budgets).
Nên thử trong một buổi rồi xóa lab hoặc thu node về 0 như phần cuối. Một node
không cung cấp HA; autoscaling không bật. Không tự tăng node khi Pod Pending:
kiểm tra nguyên nhân/capacity và tính lại tiền trước.
Auto-upgrade có thể dùng surge node tạm thời; chừa phần dự phòng trong dự toán.

## 1. Chuẩn bị Cloud Shell

```bash
cd ~/docnest
git pull --ff-only

gcloud config set project aitripmaster
export PROJECT=aitripmaster
export REGION=asia-southeast1
export ZONE=asia-southeast1-a
export CLUSTER=docnest-k8s-lab
export DOMAIN=k8s.docsnest.dattrandev.id.vn
export ORIGIN="https://$DOMAIN"
export SNAPSHOTS=aitripmaster-docnest-k8s-snapshots
export RESULTS=aitripmaster-docnest-k8s-results
export TASK_DIR="$HOME/.docnest-k8s-lab"
set +x
umask 077
mkdir -p "$TASK_DIR"
chmod 700 "$TASK_DIR"
python3 -m venv "$TASK_DIR/venv"
"$TASK_DIR/venv/bin/pip" install PyYAML==6.0.3
export PYTHON="$TASK_DIR/venv/bin/python"
```

Chỉ đi tiếp khi mỗi bước thành công. Nếu bucket/cluster đã tồn tại do thử trước,
kiểm tra nó thuộc đúng lab trước khi dùng lại; không xóa dữ liệu để vượt lỗi.

## 2. Chuẩn bị sáu image đã được scan

Trên GitHub: **Actions → Build cloud images (manual, no deploy) → Run workflow →
main → environment_name=cloud-gke**. Đợi workflow xanh, xem commit SHA trong artifact `cloud-image-digests`.
Dùng SHA của run đó, không tự lấy latest hay SHA của một run chưa publish.

```bash
read -r -p 'SHA đầy đủ của run Build cloud images đã PASS: ' IMAGE_COMMIT
export IMAGE_COMMIT
"$PYTHON" - <<'PY'
import json, os, pathlib, re, subprocess, sys
sys.path.insert(0, 'tooling/scripts')
from digest_manifest import NAMES, validate_manifest
sha = os.environ['IMAGE_COMMIT']
if not re.fullmatch(r'[a-f0-9]{40}', sha):
    raise SystemExit('Cần SHA 40 ký tự từ run publish đã PASS')
project, region = os.environ['PROJECT'], os.environ['REGION']
images = {}
for name in NAMES:
    ref = f'{region}-docker.pkg.dev/{project}/editor/{name}:{sha}'
    result = subprocess.run(
        ['gcloud', 'artifacts', 'docker', 'images', 'describe', ref,
         '--project=' + project,
         '--format=value(image_summary.fully_qualified_digest)'],
        check=True, capture_output=True, text=True)
    images[name] = result.stdout.strip()
validate_manifest(images, project, region)
pathlib.Path(os.environ['TASK_DIR'], 'digests.json').write_text(json.dumps(images))
print('Đã xác thực đủ 6 immutable image digests')
PY
```

Dùng cùng Google Client ID với image Web đã build. File sau đã được tạo trong
lượt setup trước; nếu thiếu thì nhập Client ID bằng `read`, không dùng ID khác.

```bash
if [ -s "$HOME/.docnest-secrets/google-client-id.txt" ]; then
  export GOOGLE_CLIENT_ID="$(cat "$HOME/.docnest-secrets/google-client-id.txt")"
else
  read -r -p 'Google Web Client ID giống cấu hình build: ' GOOGLE_CLIENT_ID
  export GOOGLE_CLIENT_ID
fi
```

## 3. Tạo cluster lab — bắt đầu phát sinh tiền node

Đây là **zonal Standard, 1 node**, không phải regional 3-zone hay Autopilot.
Dùng VPC/subnet và service account đã có từ lần setup VM. Tạo từ gcloud riêng
để Terraform hiện tại không xóa VM. [Tham số chính thức](https://docs.cloud.google.com/sdk/gcloud/reference/container/clusters/create).

```bash
gcloud container clusters create "$CLUSTER" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --num-nodes=1 \
  --machine-type=e2-standard-2 \
  --disk-type=pd-balanced \
  --disk-size=50 \
  --network=editor-lab \
  --subnetwork=editor-lab \
  --enable-ip-alias \
  --cluster-secondary-range-name=pods \
  --services-secondary-range-name=services \
  --workload-pool="$PROJECT.svc.id.goog" \
  --workload-metadata=GKE_METADATA \
  --service-account="editor-node@$PROJECT.iam.gserviceaccount.com" \
  --scopes=cloud-platform \
  --enable-network-policy \
  --release-channel=regular

gcloud container clusters get-credentials "$CLUSTER" \
  --project="$PROJECT" --zone="$ZONE"
kubectl config current-context
kubectl get nodes
```

Context phải thuộc `aitripmaster`, zone Singapore và `docnest-k8s-lab`.
Dừng nếu chọn nhầm cluster. Cluster create chưa deploy app hay chuyển data VM.

## 4. Gắn Workload Identity và bucket riêng

```bash
for service in identity document processing; do
  gcloud iam service-accounts add-iam-policy-binding \
    "editor-$service@$PROJECT.iam.gserviceaccount.com" \
    --project="$PROJECT" \
    --role=roles/iam.workloadIdentityUser \
    --member="serviceAccount:$PROJECT.svc.id.goog[editor-lab/$service-service]" || break
done

gcloud storage buckets create "gs://$SNAPSHOTS" "gs://$RESULTS" \
  --project="$PROJECT" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention

gcloud storage buckets add-iam-policy-binding "gs://$SNAPSHOTS" \
  --member="serviceAccount:editor-document@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/storage.objectUser
gcloud storage buckets add-iam-policy-binding "gs://$SNAPSHOTS" \
  --member="serviceAccount:editor-processing@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding "gs://$RESULTS" \
  --member="serviceAccount:editor-processing@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/storage.objectUser
```

CORS cho upload/browser download chỉ cho phép origin lab:

```bash
"$PYTHON" - <<'PY'
import json, os, pathlib
pathlib.Path(os.environ['TASK_DIR'], 'cors.json').write_text(json.dumps([{
    'origin': [os.environ['ORIGIN']],
    'method': ['PUT', 'GET', 'HEAD'],
    'responseHeader': ['Content-Type', 'Content-Length', 'Content-Range', 'Range', 'ETag'],
    'maxAgeSeconds': 3600
}]))
PY
gcloud storage buckets update "gs://$SNAPSHOTS" --cors-file="$TASK_DIR/cors.json"
gcloud storage buckets update "gs://$RESULTS" --cors-file="$TASK_DIR/cors.json"
```

## 5. Nạp secret version 1 hiện có vào Kubernetes

Dùng credential đã tạo trước, không tạo lại JWT hoặc đổi password. Lab có SQL
volume mới; Stripe bị tắt bằng hai giá trị rỗng. Secret không in ra terminal.

```bash
"$PYTHON" - <<'PY'
import os, pathlib, subprocess
keys = '''MYSQL_ROOT_PASSWORD IDENTITY_DB_PASSWORD DOCUMENT_DB_PASSWORD
PROCESSING_DB_PASSWORD COLLABORATION_DB_PASSWORD PAYMENT_DB_PASSWORD
DOCUMENT_INTERNAL_KEY PROCESSING_INTERNAL_KEY KAFKA_BROKER_PASSWORD
KAFKA_ADMIN_PASSWORD KAFKA_DOCUMENT_PASSWORD KAFKA_PROCESSING_PASSWORD
KAFKA_OPERATOR_PASSWORD KAFKA_IDENTITY_PASSWORD KAFKA_COLLABORATION_PASSWORD
KAFKA_PAYMENT_PASSWORD'''.split()
target = pathlib.Path(os.environ['TASK_DIR'])
lines = []
for key in keys:
    secret = 'editor-' + key.lower().replace('_', '-')
    value = subprocess.run(['gcloud', 'secrets', 'versions', 'access', '1',
        '--secret=' + secret, '--project=' + os.environ['PROJECT']],
        check=True, capture_output=True, text=True).stdout.strip()
    if not value or '\n' in value or '\r' in value:
        raise SystemExit('Secret không hợp lệ: ' + key)
    lines.append(key + '=' + value)
path = target / 'editor-secrets.env'
path.write_text('\n'.join(lines) + '\nSTRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\n')
path.chmod(0o600)
subprocess.run(['gcloud', 'secrets', 'versions', 'access', '1',
    '--secret=editor-jwt', '--project=' + os.environ['PROJECT'],
    '--out-file=' + str(target / 'identity-key.pem')], check=True)
(target / 'identity-key.pem').chmod(0o600)
print('Đã lưu secret vào thư mục riêng, không hiển thị giá trị')
PY

kubectl create namespace editor-lab --dry-run=client -o yaml | kubectl apply -f -
kubectl -n editor-lab create secret generic editor-secrets \
  --from-env-file="$TASK_DIR/editor-secrets.env"
kubectl -n editor-lab create secret generic editor-jwt \
  --from-file="identity-key.pem=$TASK_DIR/identity-key.pem"
```

## 6. Render config/images và tạo SQL, Kafka, Redis

```bash
"$PYTHON" tooling/scripts/render_cloud.py \
  --project "$PROJECT" --region "$REGION" --origin "$ORIGIN" \
  --snapshots-bucket "$SNAPSHOTS" --results-bucket "$RESULTS" \
  --digests "$TASK_DIR/digests.json" \
  --google-client-id "$GOOGLE_CLIENT_ID" --max-users 100 \
  --output "$TASK_DIR/render"

kubectl apply --dry-run=server -f "$TASK_DIR/render/bootstrap.yaml"
kubectl apply -f "$TASK_DIR/render/bootstrap.yaml"
kubectl apply --dry-run=server -f "$TASK_DIR/render/infrastructure.yaml"
kubectl apply -f "$TASK_DIR/render/infrastructure.yaml"
kubectl -n editor-lab rollout status statefulset/mysql --timeout=600s
kubectl -n editor-lab rollout status statefulset/kafka --timeout=600s
kubectl -n editor-lab rollout status deployment/redis --timeout=300s
kubectl -n editor-lab exec kafka-0 -- bash -s < infra/k8s/create-topics.sh
kubectl -n editor-lab get pods,pvc
```

Nếu rollout fail, dùng `kubectl -n editor-lab get events --sort-by=.lastTimestamp`
và `kubectl -n editor-lab describe pod POD_NAME`. Không chia sẻ log chứa dữ liệu
private/credentials. Không tiếp tục migrations khi infrastructure chưa Ready.

## 7. Chạy năm migration jobs trước app

```bash
kubectl apply --dry-run=server -f "$TASK_DIR/render/migrations.yaml"
kubectl apply -f "$TASK_DIR/render/migrations.yaml"
kubectl -n editor-lab wait --for=condition=complete --timeout=600s \
  job/migrate-identity-service job/migrate-document-service \
  job/migrate-processing-service job/migrate-collaboration-service \
  job/migrate-payment-service
```

Các job phải Complete. Nếu job fail, kiểm tra job đó; không chạy app hoặc tự xóa
PVC để vượt lỗi. Job đã tồn tại thì kiểm tra đang active/completed trước khi retry.

## 8. Chạy backend rồi Web

```bash
"$PYTHON" - <<'PY'
import os, pathlib, yaml
root = pathlib.Path(os.environ['TASK_DIR'], 'render')
objects = list(yaml.safe_load_all((root / 'applications.yaml').read_text()))
(root / 'backends.yaml').write_text(yaml.safe_dump_all([
    obj for obj in objects if obj['metadata']['name'] != 'web']))
(root / 'web.yaml').write_text(yaml.safe_dump_all([
    obj for obj in objects if obj['metadata']['name'] == 'web']))
PY
kubectl apply --dry-run=server -f "$TASK_DIR/render/backends.yaml"
kubectl apply -f "$TASK_DIR/render/backends.yaml"
for service in identity-service document-service processing-service collaboration-service payment-service; do
  kubectl -n editor-lab rollout status deployment/"$service" --timeout=600s || break
done
```

Chỉ khi cả năm backend Ready mới chạy tiếp:

```bash
kubectl apply --dry-run=server -f "$TASK_DIR/render/web.yaml"
kubectl apply -f "$TASK_DIR/render/web.yaml"
kubectl -n editor-lab rollout status deployment/web --timeout=300s
kubectl -n editor-lab get pods,pvc,svc
```

Identity có startup argument chỉ rõ JWT trong `/keys`, khớp Secret volume và
vượt default cloud profile. Normal startup không tự chạy Flyway.

## 9. Tạo IP và HTTPS Ingress — bắt đầu phát sinh tiền load balancer

```bash
gcloud compute addresses create docnest-k8s-lab-web --project="$PROJECT" --global
"$PYTHON" - <<'PY'
import os, pathlib, yaml
objects = list(yaml.safe_load_all(pathlib.Path('infra/k8s/ingress.example.yaml').read_text()))
for obj in objects:
    if obj['kind'] == 'ManagedCertificate':
        obj['spec']['domains'] = [os.environ['DOMAIN']]
    if obj['kind'] == 'Ingress':
        obj['metadata']['annotations']['kubernetes.io/ingress.global-static-ip-name'] = 'docnest-k8s-lab-web'
pathlib.Path(os.environ['TASK_DIR'], 'ingress.yaml').write_text(yaml.safe_dump_all(objects))
PY
kubectl apply --dry-run=server -f "$TASK_DIR/ingress.yaml"
kubectl apply -f "$TASK_DIR/ingress.yaml"
gcloud compute addresses describe docnest-k8s-lab-web \
  --project="$PROJECT" --global --format='value(address)'
```

Ở DNS của `dattrandev.id.vn`, thêm **A record** cho
`k8s.docsnest` trỏ tới IP vừa in. Dùng DNS-only nếu đang dùng Cloudflare.
Giữ record `docsnest` hiện tại trỏ VM; không thay nó và không giữ AAAA/CNAME xung
đột cho host lab. Trong Google OAuth Web Client đã dùng để build Web, thêm
`https://k8s.docsnest.dattrandev.id.vn` vào **Authorized JavaScript origins**.

Đợi certificate Active, có thể mất khoảng một giờ hoặc lâu hơn:

```bash
kubectl -n editor-lab get ingress editor-public
kubectl -n editor-lab describe managedcertificate editor-tls
curl --fail --silent --show-error "$ORIGIN/healthz"
```

Google yêu cầu HTTP frontend lúc ban đầu để lập trình load balancer/certificate.
Sau khi certificate Active và HTTPS health thành công mới tắt HTTP:

```bash
kubectl -n editor-lab annotate ingress editor-public \
  kubernetes.io/ingress.allow-http=false --overwrite
```

[Trình tự TLS chính thức](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/secure-traffic-management).

## 10. Kiểm tra sử dụng thật

Mở `https://k8s.docsnest.dattrandev.id.vn`, đăng nhập Google, tạo folder/document,
nhập Unicode/format, save, reload/reopen, share/revoke và export. Dữ liệu VM cũ
không xuất hiện vì đây là lab mới. Chỉ gọi đây là deploy thành công sau khi HTTPS,
Google login, lưu/reopen qua GCS và export thực sự chạy.

```bash
kubectl -n editor-lab get pods,pvc
kubectl -n editor-lab get jobs
kubectl -n editor-lab get deployments
kubectl -n editor-lab top pods
```

Public `/internal` và `/actuator` phải trả 404; database/Kafka/Redis vẫn ClusterIP.
`top` cần metrics sẵn sàng. Pending/OOM không tự động chứng minh cần thêm node:
kiểm tra events, requests, limits và allocatable trước.

## 11. Cập nhật về sau bằng GitHub

Dùng [GKE_CUTOVER.md](GKE_CUTOVER.md) bước 2–3 để tạo environment riêng
**cloud-gke**, backup bucket riêng và chạy setup_gke_deploy.sh cho scoped IAM/RBAC.
**Build & deploy VM** vẫn dùng cloud-lab; không dùng nó để cập nhật GKE.

Sau bootstrap lần đầu, [bước 8–9 của tài liệu cutover](GKE_CUTOVER.md) chỉ rõ
backup quiesced/encrypted và nút **Build & deploy GKE → main**. Nút này nối build,
scan, publication và same-run digest deployment; vẫn yêu cầu backup reference
thật. Nó không tạo cluster/secrets/Ingress, đổi DNS hay đọc SQL/JWT bằng CI.

Nếu chỉ muốn publish images, chọn **Build cloud images** với
**environment_name=cloud-gke**. Raw reviewed-digest deployment còn có trong
**Deploy reviewed GKE digests**, cũng chọn cloud-gke và backup reference đã review.
Giữ app paused sau backup đến khi rollout hoàn tất trong learning maintenance.
Không dùng reference giả và không gọi static checks là cloud restore proof.

## 12. Sau buổi học: dừng tiền node hoặc xóa lab

Để nghỉ và giữ PVC, thu node về 0; app lab offline, PVC/bucket/load balancer và
cluster management còn tồn tại/tính tiền tương ứng. Không tự delete PVC.

```bash
gcloud container clusters resize "$CLUSTER" --project="$PROJECT" \
  --zone="$ZONE" --node-pool=default-pool --num-nodes=0
```

Để học tiếp, resize lại 1 rồi đợi Pod Ready; login TLS/SQL/GCS cần kiểm tra lại.
Muốn kết thúc lab và đã chấp nhận bỏ dữ liệu mới, kiểm tra context và PVC/disk
inventory trước. Xóa Ingress khi cluster còn hoạt động để controller dọn LB,
đợi tài nguyên LB được dọn rồi mới xóa cluster:

```bash
kubectl config current-context
kubectl -n editor-lab get pvc
kubectl -n editor-lab delete ingress editor-public
gcloud compute forwarding-rules list --project="$PROJECT"
# Kiểm tra rule/IP của lab đã được dọn; không xóa rule của VM/app khác.
gcloud container clusters delete "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
gcloud compute addresses delete docnest-k8s-lab-web --project="$PROJECT" --global
```

Các lệnh xóa có prompt để operator kiểm tra. Không thêm `--quiet`. Kiểm tra disk
còn sót: `gcloud compute disks list --project="$PROJECT"`, vì PVC/disk có thể
còn tiền sau khi xóa cluster. Không xóa boot disk VM `editor-lab`. Hai bucket lab
và object/soft-delete retention vẫn tồn tại; chỉ xóa sau khi chấp nhận bỏ dữ liệu.
Không dùng lệnh wildcard xóa bucket/secret/IAM/project. Giữ JWT và Secret Manager
cũ vì VM còn dùng. Kiểm tra Billing theo SKU sau cleanup.
