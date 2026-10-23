# Theo Dõi Tiến Độ (Progress)

## Bản bàn giao ngày 23 tháng 10 năm 2026

Đã hoàn thiện theo hai tài liệu Word của giảng viên cho Hướng 2 và TH4. Giữ SQLite theo yêu cầu chính thức, bỏ worker tự tạo số đo, hợp nhất ingest, sửa xác thực/khóa/rules/độ mới và quyền dữ liệu; hoàn thiện UI desktop/mobile và hồ sơ sự cố. Có 68/68 test, 10/10 nhóm kiểm tra Chrome và 0 lỗ hổng do npm audit báo cáo. Báo cáo Word 5 trang, phiếu TH4 điền sẵn và 8 slide đã kiểm tra bố cục. Xem `requirement-traceability.md`, `test-results.md` và `coursework/README.md` để dùng trạng thái hiện tại. Các dòng bên dưới là lịch sử trước đợt rà soát, không xác định trạng thái bản bàn giao này.

| Lần cập nhật | Milestone | Công việc đã hoàn thành | File thay đổi chính | Test / Lệnh đã chạy | Blocker / Vấn đề | Quyết định | Bước tiếp theo |
|---|---|---|---|---|---|---|---|
| 2026-10-06 | M0 | Đọc prompt, đánh giá hiện trạng code so với mô tả, thiết lập Workspace C: | `docs/upgrade-audit.md`, `docs/progress.md`, `docs/requirement-traceability.md` | `npm install` | Phải chạy mã nguồn ở ổ C do hạn chế IDE. | Tạo audit list và kế hoạch chi tiết M1. Giữ kiểu TEXT cho ID thay vì UUID v4 thuần. | Đã hoàn thành |
| 2026-10-06 | M1 | Auth (Session SQLite), Roles, Simulator đọc keys từ .env, Logic State Machine Telemetry, Sửa seed. | `telemetry.js`, `auth.js`, `seed.js`, `simulator/index.js` | `npm run db:migrate`, `npm run db:seed` | Môi trường không có PostgreSQL (đã note Blocked ở M1 db migration). Đã dùng SQLite. | Chuyển sang M2 bằng SQLite, thêm incidents. | Hoàn thành M1, chuyển sang M2. |
| 2026-10-06 | M2 | Bổ sung Incidents APIs và schema | `schema.sql`, `incidents.js`, `app.js` | | | Tiếp tục phát triển UI Frontend cho M2 (Sidebar, Tổng quan, Hồ sơ sự cố, Cảnh báo). | Xây dựng UI M2. |
