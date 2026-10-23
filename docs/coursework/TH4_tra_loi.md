# Phiếu hoàn thành TH4 Nhóm 10

## Tên đồ án và hướng đã chọn

**Thiết kế và mô phỏng hệ thống IoT giám sát mực nước và cảnh báo ngập cho bãi giữ xe qua website.** Chọn **Hướng 2 — Sản phẩm IoT**; một bãi xe, ba điểm đo giả lập. Nhóm 10: Hà Minh Tiến (1250080194), Trương Quốc Toàn (1250080203), Huỳnh Nguyễn Duy Tiến (1250080195).

## Thành phần thiết kế bổ sung

**Logic cảnh báo và vận hành khi dữ liệu gián đoạn**: máy trạng thái ba mức, độ mới, chống bản tin trùng, xác nhận độc lập kết thúc, dashboard thể hiện chất lượng dữ liệu.

## Người dùng và bối cảnh

Chủ bãi/quản lý theo dõi điểm vượt ngưỡng và người đã tiếp nhận. Nhân viên trực xem dashboard, kiểm tra tại chỗ, thực hiện quy trình cơ sở. Ba điểm dễ nước tràn; Wi-Fi có thể gián đoạn, cảm biến có thể lỗi. Phần cứng chưa chế tạo; simulator độc lập gửi HTTP thay thiết bị.

## Vấn đề và giá trị bổ sung

Tạo cảnh báo từng mẫu dễ lặp khi dao động; chỉ nhìn số cuối dễ hiểu nhầm mất mạng là bình thường; nút ack đồng thời resolve có thể làm mất dấu điều kiện nguy hiểm. Bổ sung xác định khi nào mở/nâng/đóng đợt, mẫu nào được đếm và trạng thái dữ liệu cần hiển thị. Nhóm có quy tắc nhất quán để triển khai, kiểm thử, giải thích.

## Hiện vật đính kèm

Chọn **Sơ đồ kiến trúc**, **Mô hình dữ liệu**, **Lưu đồ logic**, **Khác: hai Sequence Diagram**. SVG/PNG ở `figures/`; Mermaid ở `../architecture.md`.

![Kiến trúc](figures/architecture.png)

![Máy trạng thái](figures/state-alerts.png)

## Quyết định thiết kế

1. **10/20/7 cm và ba mẫu tươi liên tiếp.** ≥10 mở warning, ≥20 mở/nâng critical, <7 mới kết thúc. Hysteresis hạn chế dao động; ưu tiên critical khi cùng đủ điều kiện. Đây là ngưỡng demo cần hiệu chỉnh theo bãi thật.
2. **Tách cảnh báo, dữ liệu và tiếp nhận.** Ack chỉ ghi người/thời điểm, không đặt resolved_at. Mất mạng, stale, sensor_error không tự trả normal.
3. **Danh tính và thời gian bản tin.** Có device_id/message_id/measured_at/level_cm/quality. Cũ >15 giây hoặc không mới hơn hiện trạng chỉ lịch sử; unique chống retry; cùng ID khác payload là xung đột.
4. **Ngắt chuỗi khi không đủ chất lượng.** Sensor_error có null; gap giữa mẫu >30 giây reset đếm. Không có bản tin hợp lệ >30 giây là offline; còn nhận mẫu cũ nhưng thiếu mẫu tươi là stale. Bản tin muộn không nối thành chuỗi.
5. **Phân chia xử lý.** Thiết bị dự kiến đo/gửi 5 giây; backend giữ luật, SQLite và quyết định chung. Simulator thay cảm biến/ESP32, gọi API thật; web poll 5 giây/SSE, không tự tính luật khác server.
6. **Quyền và nhất quán.** Manager sửa luật theo version/reset đếm/audit; staff xem/ack. Khóa chỉ lưu hash; giao dịch ghi reading và state cùng nhau hoặc rollback.

## Tích hợp hiện có

**Thành phần thêm/sửa:** xử lý telemetry dùng chung, version luật, độ mới dashboard, scenario simulator và test; không thêm phần cứng bắt buộc.

**Dữ liệu/thành phần liên quan:** devices (state/counter), readings (ID/time/quality/history_only), alert_rules (ngưỡng/version), alerts (episode/ack/resolve), audit_logs; API telemetry, tổng quan/lịch sử/cảnh báo.

Luồng: simulator→API xác thực/validate→transaction SQLite→đếm/chuyển mức→web theo quyền. Phần đo/lỗi/ngắt mạng đều mô phỏng nếu chưa có phần cứng; không tuyên bố đo ngoài hiện trường.

## Việc tiếp theo

Đối chiếu log test thật/demo trước nộp; nhóm xác nhận phân công; hiệu chỉnh vị trí/ngưỡng với người trực. Khi có thiết bị: đối chiếu thước đo, kiểm tra Wi-Fi/nguồn/vỏ/sai số. Khảo sát và báo giá là kế hoạch chưa hoàn thành. Nhóm đọc, hiểu và tự chỉnh theo quy định AI của học phần.
