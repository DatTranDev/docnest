# Rà soát UI DocsNest — 18/10/2026

## Phạm vi và cách đọc kết quả

Rà soát các route dành cho người dùng và các màn hình nằm trong route `/` của source hiện tại. Kiểm tra trực tiếp bản đang chạy tại <https://k8s.docsnest.dattrandev.id.vn/>; kiểm tra bản static độc lập từ `frontend/web/dist/local-site` qua HTTP cục bộ. Đối chiếu với `docs/design/UI_SYSTEM.md`, [bản audit ngày 10/10](UX_UI_AUDIT_2026-10-10.md), source và ảnh component tạo trong đợt UI refresh ở `testing/reports/raw/ui-refresh/`.

Các mức bằng chứng:

- **Live:** đã nhìn thấy hoặc đo trên bản đang chạy; không suy ra rằng mọi tài khoản và dữ liệu đều có cùng trạng thái.
- **Static live:** đã mở artifact static cục bộ hiện có; không xác nhận một host static bên ngoài.
- **Source:** xác nhận cấu trúc/điều kiện trong code; tác động trong phiên thật chưa được tái hiện.
- **Ảnh component:** ảnh dùng dữ liệu giả của đợt refresh, chỉ hỗ trợ xem bố cục; không chứng nhận luồng API hay bản deploy trùng từng byte với checkout.

Không tạo tài khoản, đăng nhập, sửa dữ liệu người dùng, tạo link chia sẻ, thực hiện thanh toán hoặc chạy acceptance test. Vì vậy các màn chỉ xuất hiện sau đăng nhập và public viewer với token hợp lệ **chưa được kiểm chứng trực tiếp**. Đây là audit UI, không phải kết quả kiểm thử chức năng, accessibility toàn diện hay hiệu năng.

## Độ phủ từng trang và màn hình

| Trang / trạng thái                                                               | Đã kiểm tra                                          | Kết luận trong phạm vi kiểm tra                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/intro` — hero, bốn kiểu tệp, nội dung giới thiệu, điều hướng                   | Live desktop và mobile 360/390/440px; source         | Bố cục, CTA và điều hướng cơ bản rõ. F01 và F08 bên dưới.                                                                       |
| `/intro?mode=document#editor`, `/intro#editor`, `/local?mode=json`               | Live; source route redirect                          | Mode được chọn đúng; liên kết tới editor bị lệch vị trí lúc mở trang (F01). `/local` chuyển tới `/intro?mode=json#editor` đúng. |
| Local Document                                                                   | Live desktop/mobile; source                          | Paper và nút chính rõ; trạng thái bản nháp chưa tải xuống chưa thay đổi theo thao tác (F05).                                    |
| Local Markdown, Code, JSON                                                       | Live mobile 390px; source                            | Có tab, filename, toolbar và vùng soạn thảo tương ứng. Nút toolbar cao 34px (F06). Không chạy thử nhập/xuất roundtrip.          |
| Static `index.html`, `editor.html`                                               | Static live desktop/mobile; source                   | Hai entry point mở và điều hướng vào editor được. Không xác nhận artifact này đã được đưa lên một static host bên ngoài.        |
| `/` khi chưa đăng nhập — đăng nhập/đăng ký                                       | Live mobile 360/440px; ảnh component desktop; source | Nhãn trường, thông báo mật khẩu và đường dùng thử có mặt. Không gửi form hay kiểm tra Google OAuth.                             |
| `/` sau đăng nhập — Tệp của tôi, thư mục, tìm kiếm, grid/list, rỗng/lỗi/tải thêm | Source; ảnh component 1440/390/360px                 | F02, F06 và F09. Chưa có walkthrough với thư viện thật và nhiều trang dữ liệu.                                                  |
| `/` — Được chia sẻ, Thùng rác, khôi phục                                         | Source; thiết kế cùng `WorkspaceLibrary`             | F02. Chưa xác nhận trực tiếp quyền và khôi phục trên bản chạy.                                                                  |
| `/` — editor cloud: rich/source, toolbar, lưu, cộng tác, recovery/conflict       | Source; ảnh component rich editor desktop/mobile     | Bố cục rich editor đã được cải thiện trong refresh. Chưa xác nhận lưu, conflict, quyền hoặc cộng tác trong phiên thật.          |
| `/` — New/Import/Rename/Move, Share, Version history, Settings                   | Source; `ModalDialog` và ảnh editor/menu hiện có     | Các dialog chính đã dùng primitive modal và thông báo lỗi tại chỗ. Chưa thực hiện mutation.                                     |
| `/` — export jobs và Billing                                                     | Source                                               | F07 và F10; Billing phụ thuộc trạng thái cấu hình và chưa mở trực tiếp. Không thực hiện job/checkout.                           |
| `/s/[token]` — token không hợp lệ                                                | Live desktop; source                                 | Thông báo lỗi, hướng dẫn và link quay về có mặt.                                                                                |
| `/s/[token]` — tài liệu hợp lệ và mobile                                         | Source                                               | F03. Chưa có token hợp lệ để xem bố cục/dữ liệu thật.                                                                           |
| 404, loading, error boundary                                                     | 404 live; loading/error qua source                   | F04. Không cố ý gây lỗi runtime để mở error boundary.                                                                           |

`/healthz` là endpoint kỹ thuật. `/benchmark` và `/worker-contract` là route nội bộ do gateway chặn; không tính là trang sản phẩm cần thiết kế cho người dùng.

## Phát hiện ưu tiên

### F01 · P1 · CTA tới editor đặt vùng soạn thảo quá thấp trên mobile

**Live.** Ở viewport 390 × 844, mở `/intro?mode=document#editor` bằng nút **Bắt đầu viết**: sau khi editor tải xong, đỉnh `#editor` nằm ở y≈674px. Người dùng vẫn nhìn phần minh họa/tệp giả phía trên; vùng giấy ở dưới màn hình. Trong một lần kích hoạt lại liên kết tới cùng anchor, đỉnh editor chuyển lên y≈96px. Hiện tượng cũng thấy khi mở trực tiếp `/intro#editor`.

`#editor` bọc [LocalClient](../../frontend/web/src/features/local-tools/components/SiteIntro.tsx), còn [LocalClient](../../frontend/web/src/features/local-tools/components/LocalClient.tsx) được tải động với fallback. Nguyên nhân dịch chuyển bố cục cần xác nhận khi sửa; phép đo trên chỉ chứng minh vị trí sai sau khi tải. Nên giữ chỗ ổn định cho vùng editor hoặc cuộn tới anchor sau khi client editor mount, rồi kiểm tra cả CTA, link từ đăng nhập, `/local` redirect và nút chọn bốn mode ở 360/390px.

### F02 · P2 · Bộ lọc loại tệp có thể cho kết quả trống sai ngữ cảnh

**Source.** [WorkspaceLibrary](../../frontend/web/src/features/workspace/components/WorkspaceLibrary.tsx) lọc loại tệp trên `documents` đã tải, trong khi [useWorkspaceContents](../../frontend/web/src/features/workspace/hooks/useWorkspaceContents.ts) còn `nextCursor`. Nếu trang đầu không có loại đã chọn, màn hình báo không có kết quả dù trang sau còn tệp cùng loại. Nút **Tải thêm** vẫn hiện, nhưng thông báo trống không giải thích phạm vi. Ngoài ra tùy chọn **Thư mục** hiện ở Được chia sẻ và Thùng rác, trong khi [contents API](../../frontend/web/src/features/workspace/api/contents.ts) chỉ tải thư mục cho Tệp của tôi.

Ưu tiên lọc tài liệu từ API nếu hợp đồng hỗ trợ; nếu vẫn lọc client, hiển thị rõ “trong các mục đã tải” và gợi ý tải thêm. Chỉ hiện lựa chọn Thư mục ở phạm vi có thư mục. Kiểm tra bằng thư viện >50 tệp, với kết quả chỉ có ở trang sau.

### F03 · P2 · Public viewer trên mobile mất tùy chọn ngôn ngữ và định dạng tải xuống

**Source.** [PublicViewer](../../frontend/web/src/features/sharing/components/PublicViewer.tsx) có menu định dạng và LanguageSelector ở desktop, nhưng [CSS mobile](../../frontend/web/src/app/globals.css) ẩn cả hai dưới 650px. Nút tải thay thế chỉ cho tệp native với tài liệu rich hoặc định dạng gốc với source. Người mở link bằng điện thoại không đổi được ngôn ngữ ngay trên trang và không chọn TXT cho tài liệu rich như desktop.

Giữ selector ngôn ngữ và menu định dạng trong một menu gọn trên mobile, hoặc cho nút tải mở cùng danh sách định dạng. Cần kiểm chứng trực tiếp với token hợp lệ trước khi coi đây là lỗi trải nghiệm đã tái hiện.

### F04 · P2 · Trang 404 không theo hệ thống giao diện

**Live + source.** Một URL không tồn tại hiện tiêu đề và link sát góc trái trên nền trống, không có header, khoảng đệm, panel hay điều hướng giống các trang công khai. [not-found.tsx](../../frontend/web/src/app/not-found.tsx) chỉ trả về `<main>` tối giản; [error.tsx](../../frontend/web/src/app/error.tsx) cũng chưa có shell tương tự.

Đưa 404 và error boundary vào cùng kiểu bố cục công khai, có hành động về `/intro` và `/`. Giữ câu chữ lỗi ngắn, không tiết lộ thông tin nội bộ. Error boundary hiện chỉ được kiểm tra qua source.

### F05 · P2 · Chưa có trạng thái trực quan “bản nháp local chưa tải xuống”

**Live + source.** Dưới filename của Local Document luôn hiện cùng dòng “Chỉ trong thẻ này · Tải xuống để giữ bản thảo”, ở cỡ 12px. [LocalDocument](../../frontend/web/src/features/local-tools/components/LocalDocument.tsx) theo dõi dirty token và [LocalWorkbench](../../frontend/web/src/features/local-tools/components/LocalWorkbench.tsx) đã cảnh báo `beforeunload` khi có thay đổi, nhưng [EditorPane](../../frontend/web/src/features/editor/components/EditorPane.tsx) luôn nhận một status tĩnh trong local mode. Người dùng không thấy sự khác biệt giữa vừa tải bản mới và đã sửa tiếp sau đó.

Hiển thị trạng thái theo dirty token gần nút Tải xuống, ví dụ “Chưa tải thay đổi” / “Đã tải bản này”. Không gọi là “Đã lưu” vì local mode không tự lưu lâu dài.

### F06 · P2 · Toolbar source trên mobile có vùng bấm dày đặc

**Live + source.** Ở 390px, nút Markdown **Đậm**, **Nghiêng**, **Căn lề**, **Nguồn**, **Xem trước** cao 34px; Code/JSON dùng cùng `.source-toolbar button` trong [local-tools.css](../../frontend/web/src/app/local-tools.css). Đây không phải kết luận vi phạm WCAG 2.2: kích thước web tối thiểu có ngoại lệ và cần đánh giá spacing cụ thể. Tuy nhiên chúng nhỏ hơn mục tiêu 44px cho thao tác chạm chính của [UI_SYSTEM](UI_SYSTEM.md), và các nút cạnh nhau khiến việc dùng bằng ngón tay khó hơn. Nút đổi chiều sắp xếp của library cố định 34 × 34px trong [workspace.css](../../frontend/web/src/app/workspace.css).

Tăng hit area mobile lên khoảng 44px hoặc thêm khoảng cách/vùng bấm vô hình; ưu tiên các thao tác được dùng thường xuyên. Giữ toolbar đủ gọn để vùng viết còn nằm trong màn đầu.

### F07 · P3 · Tệp export xong luôn tải với tên `export.<đuôi>`

**Source.** [ExportJobsPanel](../../frontend/web/src/features/export-jobs/components/ExportJobsPanel.tsx) hiển thị tiêu đề tài liệu trong job, nhưng lúc tải dùng tên cố định `export.pdf` / `export.docx`. Nhiều lần export dễ tạo tên trùng và khó tìm tệp đã tải.

Dùng tiêu đề đang hiển thị đã được chuẩn hóa an toàn làm basename, kèm định dạng; fallback khi không có tiêu đề. Chưa thực hiện job thật trong audit này.

### F08 · P3 · Preview ở hero dark mode không giống tờ giấy thật

**Live + source.** Demo trong `/intro` dùng `--ui-surface` cho `.intro-demo-paper` ở [public-pages.css](../../frontend/web/src/app/public-pages.css), nên tờ giấy tối theo dark mode. Editor local thật và preview đăng nhập dùng giấy trắng, cũng là quy ước trong [UI_SYSTEM](UI_SYSTEM.md). Cần giữ mặt giấy sáng ở hero để hình minh họa dự báo đúng trải nghiệm viết, trong khi chrome bao quanh vẫn theo theme.

### F09 · P3 · Chip tìm kiếm thiếu tên hành động cho trình đọc màn hình

**Source.** Nút chip trong [WorkspaceLibrary](../../frontend/web/src/features/workspace/components/WorkspaceLibrary.tsx) chỉ có chuỗi query làm accessible name; icon × là trang trí. Tên được đọc ra không nói rằng bấm sẽ xóa tìm kiếm. Đặt `aria-label` kiểu “Xóa tìm kiếm: {query}”. Nút xóa ngay trong ô tìm kiếm đã có nhãn hành động đúng.

### F10 · P2, phụ thuộc cấu hình · Màn Pro chưa cho thấy giá trị và giá trước khi đi checkout

**Source.** Nếu billing được bật, [BillingPanel](../../frontend/web/src/features/billing/components/BillingPanel.tsx) cho chọn tháng/năm và tiếp tục sang checkout, nhưng chỉ ghi giá sẽ hiện ở checkout. [Billing contract](../contracts/billing.md) cũng xác nhận lợi ích riêng của Pro còn chờ quyết định sản phẩm và các tính năng hiện có vẫn thuộc Free. Người dùng chưa có đủ thông tin để so sánh hai gói trong chính màn chọn gói.

Trước khi quảng bá hoặc mở rộng lối vào checkout, xác định lợi ích và giá/currency/chu kỳ gia hạn từ nguồn có thẩm quyền, rồi trình bày ngay trong màn này. Đây là quyết định sản phẩm phụ thuộc cấu hình, không phải lỗi thanh toán đã tái hiện trên bản chạy.

## Thứ tự xử lý đề xuất

1. F01: sửa đường đi từ CTA tới editor vì tác động ngay ở lần dùng đầu.
2. F02–F04: làm đúng ngữ nghĩa tìm tệp, giữ đủ chức năng public mobile và hoàn thiện trạng thái lỗi.
3. F05–F06: cải thiện phản hồi lưu bản nháp và thao tác chạm trong editor.
4. F10: chốt nội dung gói trước khi sử dụng màn chọn Pro làm lối vào checkout.
5. F07–F09: hoàn thiện tên tệp, tính nhất quán hình ảnh và nhãn accessibility.

Sau khi sửa, xác nhận bằng trình duyệt với dữ liệu giả có phân trang và một public token thử hợp lệ. Build thành công riêng lẻ không chứng minh các luồng trên hoạt động đúng. Không chạy build hay suite tự động trong đợt rà soát chỉ tạo tài liệu này.
