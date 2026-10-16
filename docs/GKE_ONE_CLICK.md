# Cập nhật GKE bằng một nút

Sau cấu hình một lần bên dưới: **GitHub → Actions → Build & deploy GKE → Run
workflow → main → Run workflow**. Không nhập backup reference, SHA hoặc digests.
Nếu environment có required reviewers, GitHub vẫn áp dụng các approval đã cấu hình.

Workflow kiểm tra cấu hình, build/test/scan và publish sáu images trước khi làm
app tạm ngừng. Trong cùng deployment lock, nó server dry-run, dừng sáu app, capture
backup mới, mã hóa age, upload vào bucket riêng, kiểm tra object, chạy năm migration
jobs, rollout backend trước Web rồi kiểm tra HTTPS. MySQL/Kafka/Redis, PVC, cluster,
Ingress và DNS hiện tại được giữ lại. Đây là cập nhật app, không tạo lại cluster.

## Cấu hình một lần trong Cloud Shell

Điều kiện: sáu Deployment hiện có Ready với một replica, DNS/HTTPS đã hoạt động,
Google login client đã cấu hình và environment **cloud-gke** đã tồn tại. Trong
GitHub Settings → Environments → cloud-gke, giới hạn deployment branches về
`main`; giữ các bảo vệ khác. Không deploy thủ công đồng thời trong maintenance.

```bash
cd ~/docnest
git pull --ff-only
gh auth status --hostname github.com || \
  gh auth login --hostname github.com --git-protocol https --web

# Phiên bản JWT đã triển khai trong lần bootstrap hiện tại, không dùng latest.
export JWT_SECRET_VERSION=1
bash tooling/scripts/setup_gke_actions.sh \
  aitripmaster asia-southeast1 asia-southeast1-a docnest-k8s-lab \
  DatTranDev/docnest aitripmaster-docnest-k8s-backups
```

Script đọc các cấu hình public đang chạy, không reset origin/quota/client ID.
Nó tạo backup bucket riêng nếu chưa có (private, Singapore, lifecycle 14 ngày
cho bucket mới); cấu hình IAM/RBAC và Variables của cloud-gke. Không tạo VM/GKE
hoặc chạy deploy. Backup objects và soft-delete retention vẫn có phí storage.
Bucket đã có được reuse, lifecycle hiện có không bị thay thế.

Script tạo/reuse `~/.docnest-secrets/backup-age.key`, không in nội dung private key.
**Cất một bản private key ở nơi an toàn ngoài Cloud Shell** trước khi phụ thuộc
vào backup. Chỉ public recipient được đưa vào GitHub Variable
`BACKUP_AGE_RECIPIENT`; nếu recipient đã có khác key local, setup dừng, không tự
rotate. Không upload private key, SQL hay archive plaintext lên Actions/artifacts.

Ba Variables mới: `GCP_BACKUP_SERVICE_ACCOUNT`, `BACKUP_AGE_RECIPIENT`,
`JWT_SECRET_VERSION`. Các Variables project/zone/cluster/buckets/origin/client
được ghi từ giá trị operator chỉ định và ConfigMap đang chạy. Khi đổi domain
chính hoặc rotate JWT, cập nhật các Variables tương ứng trước lần cập nhật sau.

## Phân quyền backup

`editor-backup` có quyền pause các Deployment ứng dụng, list/watch Pods, exec
chỉ vào `mysql-0`, đọc chỉ Kubernetes Secret `editor-jwt` và Secret Manager
`editor-jwt`, đọc objects từ hai bucket nguồn và đọc/tạo encrypted objects trong
backup bucket. Không có quyền xóa objects hay sửa SQL qua helper; quyền exec
MySQL là quyền operator nhạy cảm nên chỉ dùng workflow main/environment đã bảo vệ.
`editor-deploy` giữ quyền rollout/migrations và đọc backup, không được đọc Secrets.

Backup chứa năm SQL databases, signing key đúng numeric version và các GCS
generations được helper tham chiếu, kèm manifest/checksums/digests đang chạy.
Backup tồn tại và mã hóa thành công chưa chứng minh restore được: restore drill
và acceptance dữ liệu thật vẫn cần thực hiện theo runbook.

## Khi bấm nút và khi có lỗi

Không chạy lại Kafka init/ACL, tạo Secrets, tạo node hay apply Terraform cho một
lần cập nhật app. Build lỗi thì app hiện tại tiếp tục chạy. Sau khi backup bắt
đầu, app có maintenance downtime tới khi rollout kết thúc.

Backup read-only lỗi sẽ thử mở lại app cũ chỉ khi UID, template, config và
maintenance owner vẫn đúng. Nếu có thay đổi đồng thời, script dừng để kiểm tra.
Backup thành công giữ app paused cho migrations; plaintext trong runner được
dọn, chỉ archive mã hóa gửi GCS. Credentials WIF không nằm trong build context.

Nếu lỗi/cancel sau backup hoặc sau migrations, không tự rollback SQL hoặc scale
app cũ mù quáng. Kiểm tra job/log giới hạn, Flyway state và annotation
`docsnest.dattrandev.id.vn/backup-run` trên Deployment. Review trạng thái schema/
config/images trước recovery. Workflow advanced **Deploy reviewed GKE digests**
vẫn nhận backup reference thủ công, dùng cùng deployment lock.

Validation offline (unit orchestration, actual age encryption và static IAM/YAML)
không chứng minh GKE backup/restore/deployment đã chạy. Xem bằng chứng hiện tại
trong [PROJECT_STATUS.md](PROJECT_STATUS.md).
