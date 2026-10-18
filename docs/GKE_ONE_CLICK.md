# Build & deploy bằng một nút

Sau khi merge vào `main`: **GitHub → Actions → Build & deploy → Run workflow → main → Run workflow**.
Không có ô nhập JSON, digest, backup reference hoặc danh sách service. GitHub vẫn áp dụng required reviewers nếu environment đã cấu hình.

Workflow tự tìm lần deploy thành công gần nhất, xác định thay đổi từ commit đã deploy, build/scan/publish các image cần thiết rồi rolling update backend trước Web. Nó không pause app hoặc scale replica về 0. Chỉ Pod liên quan thay đổi; cluster, database, Kafka, Redis, PVC, DNS và Ingress hiện có được giữ nguyên.

## Cấu hình một lần

Environment **cloud-gke** chỉ cho deployment từ `main`. Giữ các Variables public đã dùng:

- `GCP_PROJECT`, `GCP_REGION`, `GCP_ZONE`, `GKE_CLUSTER`.
- `GCP_WIF_PROVIDER`, `GCP_CI_SERVICE_ACCOUNT`, `GCP_DEPLOY_SERVICE_ACCOUNT`.
- `WEB_ORIGIN`, `TRUSTED_PROXY_CIDRS`, `GCS_SNAPSHOTS_BUCKET`, `GCS_RESULTS_BUCKET`.
- `GOOGLE_CLIENT_ID` nếu bật Google login; `MAX_USERS` và hai Stripe Price Variables nếu dùng.

Deploy cần quyền read Pods/EndpointSlices và tạo/quan sát migration Jobs theo RBAC mới. Nếu quyền đã cũ, operator cập nhật **một lần** trong Cloud Shell:

```bash
cd ~/docnest
git pull --ff-only
gh auth status --hostname github.com
bash tooling/scripts/setup_gke_actions.sh \
  aitripmaster asia-southeast1 asia-southeast1-a docnest-k8s-lab \
  DatTranDev/docnest
```

Script đọc cấu hình public đang chạy, cập nhật Variables và quyền deploy trên cluster đã có; không tạo bucket, node hoặc load balancer. Không cần `GCP_BACKUP_SERVICE_ACCOUNT`, `BACKUP_AGE_RECIPIENT`, `JWT_SECRET_VERSION` hay các cờ `ROUTINE_RELEASE_*`. Các giá trị cũ có thể để nguyên; workflow không sử dụng chúng. Private keys/backup cũ phải tiếp tục được bảo quản cho recovery.

## Lần đầu và các lần sau

Không có artifact baseline còn hạn: build đủ sáu image đã scan và thay từng Deployment đang khỏe bằng rolling update, rồi lưu baseline V2. Đây là cập nhật cluster đã bootstrap; nó không tự tạo cluster hoặc Secrets.

Có baseline: tự tải `deployment-evidence/environment-state.json` từ Actions run của repository trên main, kiểm tra provenance/commit và đối chiếu sáu image thực tế. Document-only chỉ publish image Document; thay đổi config tự thêm đúng consumer vào rollout. Không có thay đổi thì không restart app. Artifact được giữ 90 ngày; hết hạn sẽ quay về full build có scan, không tin mutable tags.

Các mutation cùng dùng một concurrency lock. Khi thiếu chỗ cho surge Pod, rollout đợi/fail thay vì chủ động bỏ Pod đang phục vụ. Không tăng permanent replicas hoặc tự tạo tài nguyên trả phí.

## Khi lỗi

Build/scan/preflight lỗi: sửa nguyên nhân rồi chạy lại. Sau mutation bị gián đoạn, artifact `PENDING` chặn lần deploy tiếp; kiểm tra migration history, image/config và reconcile trạng thái. Không tự rollback SQL hoặc restart tất cả app. Xem chi tiết tại [selective release runbook](CICD_SELECTIVE_RELEASES.md).

Backup/restore là hoạt động độc lập. Nút deploy không tạo hoặc xác nhận recovery point. Online backup/PITR, restore drill và traffic/draining trên GKE vẫn cần operator kiểm chứng; YAML rolling update không chứng minh zero downtime. Xem kết quả thực tế tại [PROJECT_STATUS.md](PROJECT_STATUS.md).

The current owner-selected release profile is build-only. It does not require synthetic account Secrets or run browser/service integration tests. Image scans/provenance, migration policy, Kubernetes readiness and drain checks remain active. See [the release runbook](CICD_SELECTIVE_RELEASES.md).
