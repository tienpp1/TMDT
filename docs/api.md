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
| POST `/api/devices/:id/archive` | Manager đúng cơ sở | Xóa bãi khỏi vận hành, giữ lịch sử, ghi audit |
| PATCH `/api/devices/:id/rule` | Manager | Đổi luật có version |
| POST `/api/devices/:id/rotate-key` | Manager | Đổi khóa; trả khóa mới một lần, khóa cũ hết hiệu lực |
| POST `/api/devices/site/:siteId/demo-sample` | Manager | Một mẫu giả lập qua cùng ingestReading; theo sample_count của từng điểm |
| POST `/api/devices/:id/override` | Manager đúng cơ sở | Lưu/đặt lại mục tiêu mô phỏng và ngưỡng, có expected_version |
| POST `/api/devices/site/:siteId/demo-rain-step` | Manager | Một bước mưa/rút nước, theo vùng và cùng ingestReading |
| GET `/api/audit/site/:siteId` | Manager | Nhật ký |
| GET `/api/events` | Có phiên | SSE báo thay đổi; tải dữ liệu lại qua API có quyền |
| GET `/api/reports/site/:siteId/device/:id/csv` | Thành viên đúng cơ sở | CSV; phải kiểm tra cả site và device |

Các endpoint công việc/ghi chú/báo cáo hỗ trợ quản lý, không thay luồng telemetry. Điều khiển demo gắn nhãn mô phỏng và đi qua cùng bộ xử lý nhận dữ liệu và chính sách cảnh báo theo chế độ.

Chính sách cảnh báo phụ thuộc `DEVICE_MODE`: mặc định `simulation` giữ bãi được bật luôn online, vàng chỉ theo dõi, báo ngay khi đạt đỏ và kết thúc dưới đỏ. `telemetry` dùng số mẫu/ngưỡng kết thúc đã cấu hình. Overview bổ sung trạng thái hiển thị/nguồn số đo; danh sách cảnh báo có `is_current`. Xem [device-modes.md](device-modes.md). Các trường đọc dữ liệu gốc không bị thay bằng heartbeat hoặc reading giả.

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

Luật cần `clear_cm < warning_cm < critical_cm`, sample_count nguyên dương trong giới hạn. Version cũ trả 409; cập nhật tăng version, reset đếm và ghi audit. Ack lặp lại idempotent, không ghi đè người/thời điểm ban đầu. Ack không đặt resolved_at. Chế độ mô phỏng đóng đợt ngay khi có mẫu hợp lệ dưới ngưỡng đỏ; chế độ telemetry cần đủ số mẫu phục hồi theo cấu hình.

DELETE thiết bị là vô hiệu hóa (`is_active=0`), giữ lịch sử/cảnh báo/audit; PUT có thể cập nhật metadata hoặc kích hoạt lại, không dùng để bỏ kiểm tra version của luật. Readings hỗ trợ `since`, `until`, `limit` (1–2000). History-stats nhận `hours` trong 1/24/48/168 và giới hạn chuỗi hiển thị, thông báo khi bị giới hạn; CSV phải đối chiếu cùng khoảng thời gian.

`POST /api/devices/:id/archive` đặt `deleted_at`, `is_active=0`, đóng cảnh báo đang mở và xóa trạng thái mô phỏng tạm, trong transaction xếp tuần tự với mưa. Lặp lại trả cùng kết quả, không ghi audit trùng. Bãi đã xóa không xuất hiện trong danh sách vận hành/overview/history-stats và không thể bật lại, đổi khóa/luật hoặc nhận số đo. Readings và CSV theo ID vẫn có thể tra cứu bởi thành viên đúng cơ sở; các bản ghi lịch sử/cảnh báo/hồ sơ được giữ nguyên. Thao tác giao diện cần xác nhận riêng, khác với vô hiệu hóa có thể bật lại.

## Báo cáo mực nước và CSV

`GET /api/reports/site/:siteId/device/:id/csv?from=<ISO>&to=<ISO>` xuất toàn bộ số đo trong khoảng theo thời điểm đo, tăng dần, không cắt ngầm 1.000 dòng. Không có `from` lấy từ đầu; không có `to` chốt tại lúc tải. Thời điểm nhận cũng phải không vượt mốc xuất. Cùng transaction đọc tên bãi/luật/số đo để tránh cấu hình thay đổi giữa báo cáo. Các header `X-Exported-At`, `X-Reading-Count`, `X-Report-Timezone` cho biết mốc chốt, số dòng dữ liệu và UTC+07:00. Lỗi khoảng thời gian trả 400, không có quyền cơ sở 403, ID không thuộc cơ sở 404.

- Các cột đầu: thời gian đo UTC+7, tên bãi, mực nước, trạng thái, ngưỡng vàng/đỏ; tiếp theo là chất lượng, vị trí, thời gian nhận, cờ chỉ lịch sử, nguồn/phiên bản ngưỡng, UTC gốc và ghi chú.
- `level_cm >= critical_cm`: **Nguy hiểm**; `>= warning_cm`: **Cảnh báo**; thấp hơn: **OK**. Tính riêng từng mẫu khi dâng lẫn rút, không lấy trạng thái ACK/hysteresis hoặc màu vùng nguy cơ. Lỗi/thiếu số đo: **Không xác định**, không giả thành 0/OK.
- Ingestion lưu `warning_cm_snapshot`, `critical_cm_snapshot`, `rule_version_snapshot` cùng reading trong transaction. Ngưỡng này có hiệu lực tại lúc nhận; bản tin gửi lại giữ snapshot gốc. Mẫu đến trễ ghi rõ không khẳng định ngưỡng tại thời điểm đo cũ.
- Bản ghi trước khi bổ sung snapshot có các trường null: đối chiếu luật hiện tại và ghi rõ **Ngưỡng hiện tại (chưa có ngưỡng lịch sử)**. Migration không tự điền ngưỡng lịch sử không có bằng chứng.
- UTF-8 BOM, CRLF, escape dấu nháy và vô hiệu hóa tiền tố công thức trong ô văn bản để mở bằng Excel/WPS. CSV là ảnh chụp dữ liệu lúc tải, không tự cập nhật sau tải.

Readings/history-stats bổ sung `water_status`, `water_status_label`, `warning_cm`, `critical_cm`, `threshold_source`, `threshold_source_label`, `rule_version`, `quality_label`, `report_note`. `threshold_source` là `snapshot` hoặc `current_rule`; các trường số đo gốc không bị thay. Trang Báo cáo làm mới theo polling của ứng dụng, có chặn phản hồi cũ ghi đè dữ liệu mới.

Hồ sơ sự cố có báo cáo, phân công, ghi chú và hoàn tất. Ghi chú ban đầu (`report`) hoặc phân công (`assignment`) không thay ghi chú kết quả (`outcome`). Chỉ người phụ trách hoặc manager được hoàn tất hồ sơ đã tiếp nhận; phải có ghi chú kết quả và không còn cảnh báo đang mở trong đợt. Hoàn tất hồ sơ không thay điều kiện mực nước của cảnh báo.

## Điều khiển mục tiêu và mưa mô phỏng

`POST /api/devices/:id/override` nhận `{"override_level":25,"expected_version":1}`. Mục tiêu là số từ 5 đến 90 cm; `null` đặt lại. Với mục tiêu T, lưu `demo_override_level=T`, ngưỡng vàng `0.5T`, đỏ `T`, kết thúc `0.3T`, `sample_count=1`. Đặt lại dùng 10/20/7 cm và 3 mẫu. Cập nhật nguyên tử, tăng phiên bản, reset bộ đếm, xóa đỉnh mô phỏng và ghi audit; version cũ trả 409. Thiết bị vô hiệu hóa bị từ chối. Trả HTTP 200 với `data:{id,override_level,warning_cm,critical_cm,clear_cm,sample_count,rule_version}`. Endpoint không tạo reading hoặc sửa giá trị telemetry nhận từ thiết bị.

`POST /api/devices/site/:siteId/demo-rain-step` nhận `{"events":[{"lat":10.776,"lng":106.701,"radius_m":3000,"intensity":15}]}`. Tối đa 20 vùng; tọa độ hữu hạn trong miền địa lý, bán kính đúng 3000 m, cường độ chỉ 5/15/30. `events:[]` chạy một bước rút nước. Một request tương ứng một giây mô hình; không có worker chạy khi import. Các bước mưa và lưu mục tiêu cùng cơ sở được xếp tuần tự để tránh dùng mục tiêu cũ với ngưỡng mới.

Trả HTTP 201 với `data:{readings:[{device_id,level_cm,...}],has_water,needs_samples}`. Điểm chưa có mực nước ngoài vùng mưa không sinh giá trị 0. Khi chủ động tạo mưa tại điểm chưa có số đo, mô hình khởi đầu từ nền giả lập 0 cm. Mỗi mẫu đi qua ingestion và logic cảnh báo hiện hành. Ở chế độ telemetry, khi đã về 0 nhưng chưa đủ mẫu kết thúc cảnh báo, `needs_samples=true` yêu cầu gửi thêm bước rút; giao diện dừng khi cả `has_water` và `needs_samples` đều false. Thuật toán chi tiết ở [rain-simulation.md](rain-simulation.md).
