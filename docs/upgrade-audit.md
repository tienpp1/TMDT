# Báo cáo Audit & Khác biệt hiện trạng (M0)

> Hồ sơ lịch sử M0. Những khoảng trống dưới đây đã được xử lý/đánh giá lại trong đợt 23/10/2026; xem `requirement-traceability.md` và `test-results.md`. Đặc biệt, PostgreSQL không phải yêu cầu bắt buộc của hai tài liệu giảng viên; bản bàn giao dùng SQLite và kiểm thử tương ứng.

Bản báo cáo này đối chiếu các tài liệu cũ, prompt yêu cầu nâng cấp và hiện trạng mã nguồn thực tế để định hướng công việc.

| Hạng mục | Tài liệu mô tả | Bằng chứng code hiện tại | Khoảng trống / Kết luận | Mức ưu tiên | Trạng thái |
|---|---|---|---|---|---|
| **Cơ sở dữ liệu** | Báo cáo gốc ghi dùng PostgreSQL. | Hiện dùng SQLite (`sqlite3`, `sessions.sqlite`). | Cần chuyển sang PostgreSQL, giữ nguyên dữ liệu bằng tool migration. | P0 | Đã kiểm chứng (Cần chuyển đổi) |
| **Bảo mật khóa thiết bị (Device Key)** | Báo cáo kiến trúc: Simulator đọc khóa bí mật từ DB. | Schema bảng `devices` chỉ lưu `key_hash`. Simulator `index.js` hardcode key `key1`, `key2`, `key3` chứ KHÔNG hề đọc từ DB. | Lỗi sai nằm ở Báo cáo kiến trúc, code hiện tại hoàn toàn đúng nguyên tắc bảo mật (không lộ plaintext từ DB). Cần chuyển cấu hình cứng này vào file `.env.simulator` theo yêu cầu M1. | P0 | Đã kiểm chứng (Code đúng, tài liệu sai) |
| **Định dạng khóa chính (ID)** | Sinh UUID v4 chuẩn. | `DEFAULT (lower(hex(randomblob(16))))` tạo ra chuỗi hex 32 ký tự không gạch nối. | Chuyển sang PostgreSQL cần ánh xạ sang kiểu `UUID` hoặc giữ nguyên `VARCHAR(32)` để không vỡ liên kết khóa ngoại. Quyết định: Giữ kiểu TEXT (VARCHAR) cho ID cũ để an toàn. | P1 | Đã kiểm chứng |
| **Xử lý đồng thời (Concurrency)** | ACID đảm bảo nhất quán dữ liệu telemetry. | Dùng Custom Mutex Lock (Tuần tự hóa) để chặn lỗi SQLite. | Khi chuyển sang PostgreSQL, Mutex Lock không còn cần thiết, có thể sử dụng Row-level lock (`SELECT ... FOR UPDATE`) để tối ưu hiệu năng. | P1 | Đã kiểm chứng |
| **Thuật ngữ Trạm/Điểm đo** | "Mực nước triều cường" tại các "Trạm". | Bảng `sites` (Cơ sở/Bãi xe), bảng `devices` (Điểm đo). | Sửa nhãn UI cho chính xác là "Mực nước tại điểm đo", không tự khẳng định do triều cường. | P2 | Chỉ có trong tài liệu |
| **Logic Cảnh báo (Alerts)** | Ngưỡng Hysteresis và 3 mẫu liên tiếp. | Đã có một phần logic đếm. Chưa có trạng thái Hủy (Clear) chuẩn. | Cần hoàn thiện State Machine: Normal -> Warning -> Critical -> Normal (Clear). | P0 | Có code chưa kiểm thử toàn vẹn |
| **Giao tiếp Real-time** | SSE / WebSocket | Frontend đang dùng `setInterval` (Polling 5s). | Đạt baseline Polling. Có thể cân nhắc lên SSE ở M4. | P2 | Đã kiểm chứng |

## Kế hoạch hành động tiếp theo
1. **M1 (Core):** Thiết lập môi trường PostgreSQL, tạo bản export dữ liệu SQLite sang PostgreSQL an toàn. Củng cố Auth (Session với PG), Role (Manager/Staff). Hoàn thiện State Machine telemetry.
2. **M2 (Vận hành):** Làm các trang báo cáo, tổng quan, chi tiết điểm đo, hồ sơ xử lý sự cố.
3. **M3 (Quản trị):** Cấu hình thiết bị, Rule, Staff, Audit log.
4. **M4 (Mở rộng):** Tính năng xuất CSV, Sơ đồ mặt bằng tĩnh, Demo controller.
5. **M5-M6:** Test, Traceability, Documentations.
