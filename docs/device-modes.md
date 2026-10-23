# Chế độ hoạt động và cảnh báo

## Mô phỏng bãi xe: mặc định

`DEVICE_MODE=simulation` hoặc không khai báo biến này:

- Bãi được bật trong Quản trị luôn trực tuyến. Không mưa, tạnh mưa, dừng bộ gửi hoặc để trang yên không tự làm bãi mất kết nối.
- Tắt bãi trong Quản trị đưa bãi về ngoại tuyến, đóng cảnh báo hiện tại và ngăn mưa/telemetry tác động. Số đo, timestamp và lịch sử giữ nguyên khi bãi tắt. Bật lại khôi phục trạng thái trực tuyến; số đo mới tiếp tục được xử lý.
- Bãi ảo chưa có số đo hiển thị nền mô phỏng 0 cm. Đây là giá trị hiển thị có nhãn nguồn, không INSERT reading hoặc sửa timestamp. Với bãi đã có dữ liệu, hiển thị số đo hợp lệ cuối cùng. Lỗi cảm biến vẫn hiển thị thiếu số đo/lỗi chất lượng, không giả thành số đo 0.
- Ngưỡng vàng chỉ đổi màu theo dõi. Mẫu hợp lệ đầu tiên đạt hoặc vượt ngưỡng đỏ tạo một đợt cảnh báo và hồ sơ; các mẫu đỏ tiếp theo không tạo trùng. Xuống dưới ngưỡng đỏ thì kết thúc đợt; vượt đỏ lần sau là đợt mới.
- Chuông, thông báo ưu tiên và số bãi vượt đỏ chỉ tính cảnh báo hiện tại của bãi đang bật. Một bãi được tính một lần. Xác nhận tiếp nhận tắt nhắc chưa xác nhận; bãi vẫn được tính đang đỏ đến khi nước hạ.
- Trung tâm Cảnh báo mặc định hiện cảnh báo đỏ hiện tại; bộ lọc Lịch sử giữ các đợt đã qua. Cảnh báo cũ không thuộc đợt hiện tại không làm tăng chuông/KPI.

Các quy tắc mưa, bán kính, tốc độ dâng/rút và mục tiêu riêng từng bãi giữ nguyên như [mô hình mưa](rain-simulation.md). Không cần chạy một worker tạo số đo liên tục để giữ trực tuyến.

## Telemetry và kiểm tra mất kết nối

Đặt `DEVICE_MODE=telemetry` trong `.env`, khởi động lại backend. Chế độ này giữ cách xử lý thiết bị theo dữ liệu nhận được: không có số đo/mất kết nối/quá hạn/lỗi cảm biến; mặc định mất kết nối sau 30 giây (`DEVICE_OFFLINE_AFTER_MS`). Quy tắc cảnh báo dùng `sample_count`, warning/critical/clear đã cấu hình, mặc định 3 mẫu và 10/20/7 cm. Có thể dùng CLI để kiểm tra các trường hợp dữ liệu gián đoạn và chống chập chờn của TH4.

Thay đổi chế độ không xóa reading hoặc lịch sử. Hai chế độ dùng cùng xác thực, kiểm tra chất lượng/thời gian, chống trùng và transaction ingestion.

## Trường dữ liệu API

Overview có `device_mode` và mỗi điểm có:

| Trường | Ý nghĩa |
|---|---|
| `data_status` | Trạng thái khả dụng theo chế độ; bãi ảo đang bật luôn online |
| `measurement_status` | Trạng thái dữ liệu theo timestamp/chất lượng, tách khỏi khả dụng của bãi ảo |
| `display_level_cm` | Mức hiển thị; 0 ở nền bãi ảo chưa có dữ liệu, null khi không có mức hợp lệ |
| `level_source` | `simulation_baseline`, `reading` hoặc `unavailable` |
| `current_level_status` | Màu hiện tại theo mức nước/ngưỡng trong mô phỏng; không lấy màu từ cảnh báo lịch sử |

Các trường `latest_level_cm`, `latest_quality`, `latest_measured_at`, `last_seen` vẫn là dữ liệu gốc. Danh sách cảnh báo bổ sung `is_current` để phân biệt đợt hiện tại với lịch sử. GET không tạo reading hoặc heartbeat.
