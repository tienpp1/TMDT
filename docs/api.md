# Hợp đồng API prototype IoT

URL mặc định `http://localhost:3000`. Thành công `{ "data": ... }`; lỗi `{ "error": { "code": "...", "message": "..." } }`. Phạm vi demo một bãi xe; siteId dùng kiểm tra quyền.

## Danh tính và quyền

Web dùng phiên/cookie HttpOnly, SameSite=Lax; HTTPS phải bật Secure. Manager quản lý thiết bị, người dùng, ngưỡng, audit; staff xem dữ liệu và xác nhận/xử lý theo quyền. Truy cập ID thiết bị/cảnh báo phải suy cơ sở từ DB rồi kiểm tra thành viên. Thiết bị gửi `X-Device-Key`; server lưu hash, khóa gốc chỉ trả một lần khi cấp/đổi và không xuất trong API danh sách.

App kiểm tra Origin đối với thao tác thay đổi trạng thái; dùng JSON và SameSite hỗ trợ chống CSRF. CLI không có Origin được phép theo thiết kế; đây không phải bảo vệ tuyệt đối trước client tùy ý hay khóa bị lộ. Không có endpoint/token CSRF riêng.

| Phương thức và đường dẫn | Quyền | Ý nghĩa |
|---|---|---|
| POST `/api/auth/login` | Công khai | `{email,password}`, tạo phiên |
| GET `/api/auth/me` | Có phiên | Danh tính, cơ sở, quyền |
| POST `/api/auth/logout` | Có phiên | Hủy phiên |
| POST `/api/telemetry` | Khóa thiết bị | Nhận số đo |
| GET `/api/sites` | Có phiên | Cơ sở được tham gia |
| GET `/api/sites/:id/overview` | Thành viên | Trạng thái và độ mới điểm đo |
| GET `/api/devices/:id/readings` | Thành viên đúng cơ sở | Lịch sử |
| GET `/api/alerts/site/:siteId` | Thành viên | Cảnh báo, ack, resolve |
| POST `/api/alerts/:id/ack` | Thành viên | Xác nhận tiếp nhận, không resolve |
| GET/POST `/api/devices/site/:siteId` | GET thành viên; POST manager | Danh sách / tạo thiết bị |
| PUT/DELETE `/api/devices/:id` | Manager | Sửa/ngừng quản lý thiết bị |
| PATCH `/api/devices/:id/rule` | Manager | Đổi luật có version |
| POST `/api/devices/:id/rotate-key` | Manager | Đổi khóa; trả khóa mới một lần, khóa cũ hết hiệu lực |
| POST `/api/devices/site/:siteId/demo-sample` | Manager | Một mẫu giả lập qua cùng ingestReading; giữ quy tắc ba mẫu |
| GET `/api/audit/site/:siteId` | Manager | Nhật ký |
| GET `/api/events` | Có phiên | SSE báo thay đổi; tải dữ liệu lại qua API có quyền |
| GET `/api/reports/site/:siteId/device/:id/csv` | Thành viên đúng cơ sở | CSV; phải kiểm tra cả site và device |

Các endpoint công việc/ghi chú/báo cáo hỗ trợ quản lý, không thay luồng telemetry. Điều khiển demo phải gắn nhãn mô phỏng, đi qua cùng logic cảnh báo, không bỏ quy tắc ba mẫu.

## Payload telemetry

```json
{
  "device_id": "11111111-1111-4111-8111-111111111111",
  "message_id": "87e71662-5662-43d7-8919-6c89b4f831a7",
  "measured_at": "2026-10-23T03:00:00.000Z",
  "level_cm": 12,
  "quality": "ok"
}
```

Ví dụ định dạng, không phải số đo thực địa. Timestamp ISO 8601 UTC; mực nước cm; ID bản tin duy nhất. `quality` chỉ nhận `ok` hoặc `sensor_error`. Lỗi cảm biến cần `level_cm=null`; ok cần số hữu hạn trong miền 0–90 cm. Giới hạn JSON 16 KB. Khóa không nằm trong payload ví dụ.

## Quy tắc nhận và mã trả

1. Xác thực thiết bị đang hoạt động và khóa thuộc đúng ID.
2. Validate schema/kiểu/quality/miền/thời gian; tương lai vượt giới hạn bị từ chối.
3. Cùng ID/cùng payload trả 200 duplicate, không tăng reading/counter. Cùng ID/khác payload trả 409 MESSAGE_ID_CONFLICT.
4. Mẫu cũ >15 giây khi nhận hoặc timestamp không mới hơn hiện trạng: lưu history_only, không đổi state.
5. Mẫu tươi được ghi cùng state/alerts trong giao dịch; thông báo sau COMMIT.
6. Lỗi/gap >30 giây reset bộ đếm; retry/history-only không tạo đủ ba mẫu.

Timestamp hơn 60 giây tương lai bị từ chối; timestamp hơn 5 giây tương lai nhưng chưa vượt giới hạn đó được lưu history-only để tránh tác động trạng thái bằng đồng hồ chạy trước. Hạn mức mặc định 60 bản tin/phút/thiết bị và 300 request/phút/IP; có thể cấu hình. Giới hạn in-memory phục vụ prototype một tiến trình, không được gọi là rate limiter phân tán.

201: số đo mới (`id,received_at,history_only`). 400: sai dữ liệu; 401: danh tính/khóa/phiên sai; 403: sai quyền hoặc khóa hợp lệ thuộc thiết bị khác (`DEVICE_MISMATCH`); 404: không có tài nguyên; 409: xung đột ID/version; 429: quá hạn mức; 500: lỗi nội bộ không lộ secret.

## Sửa luật và xác nhận

```json
{ "warning_cm": 10, "critical_cm": 20, "clear_cm": 7, "sample_count": 3, "expected_version": 1 }
```

Luật cần `clear_cm < warning_cm < critical_cm`, sample_count nguyên dương trong giới hạn. Version cũ trả 409; cập nhật tăng version, reset đếm và ghi audit. Ack lặp lại idempotent, không ghi đè người/thời điểm ban đầu. Ack không đặt resolved_at; chỉ ba mẫu phục hồi mới đóng đợt.

DELETE thiết bị là vô hiệu hóa (`is_active=0`), giữ lịch sử/cảnh báo/audit; PUT có thể cập nhật metadata hoặc kích hoạt lại, không dùng để bỏ kiểm tra version của luật. Readings hỗ trợ `since`, `until`, `limit` (1–2000). History-stats nhận `hours` trong 1/24/48/168 và giới hạn chuỗi hiển thị, thông báo khi bị giới hạn; CSV phải đối chiếu cùng khoảng thời gian.

Hồ sơ sự cố có báo cáo, phân công, ghi chú và hoàn tất. Ghi chú ban đầu (`report`) hoặc phân công (`assignment`) không thay ghi chú kết quả (`outcome`). Chỉ người phụ trách hoặc manager được hoàn tất hồ sơ đã tiếp nhận; phải có ghi chú kết quả và không còn cảnh báo đang mở trong đợt. Hoàn tất hồ sơ không thay điều kiện mực nước của cảnh báo.
