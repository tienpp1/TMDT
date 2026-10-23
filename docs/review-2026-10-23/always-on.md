# Kiểm tra bãi mô phỏng luôn trực tuyến và cảnh báo đỏ hiện tại

Yêu cầu ngày 23/10/2026: ba bãi đang bật luôn hoạt động; chỉ Quản trị mới tắt bãi; bãi đã tắt không đổi mực nước khi có mưa. Cảnh báo chỉ xuất hiện khi bãi đang bật đạt hoặc vượt ngưỡng đỏ.

## Kết quả

- `DEVICE_MODE=simulation` là mặc định. Khả dụng của bãi được tách khỏi thời gian/chất lượng số đo. GET không tạo heartbeat, reading hoặc timestamp giả; nền 0 cm của bãi chưa đo có nhãn mô phỏng.
- Tắt bãi được xếp tuần tự với mưa, đóng cảnh báo hiện tại và giữ nguyên số đo/lịch sử. Bật lại đưa bãi về trực tuyến; số đo mới tiếp tục được xử lý.
- Vàng chỉ đổi màu theo dõi. Mẫu đỏ đầu tiên mở một đợt, các mẫu đỏ tiếp theo không tạo trùng; xuống dưới đỏ đóng đợt. Chuông và KPI chỉ tính cảnh báo thuộc đợt đỏ hiện tại, mỗi bãi một lần. Xác nhận tiếp nhận tắt nhắc chưa xác nhận, không đổi mực nước.
- Chế độ `DEVICE_MODE=telemetry` giữ quy tắc nhiều mẫu, hysteresis và mất kết nối theo timeout để kiểm tra luồng thiết bị của TH4. Mô hình mưa, mục tiêu riêng từng bãi và bản sửa bản đồ vẫn hoạt động.

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả | Tệp |
|---|---|---|
| Jest: API, dữ liệu, giao diện, phân quyền, mô phỏng | 163/163 bài, 11/11 bộ | [always-on-test-results.json](always-on-test-results.json) |
| Kiểm tra cú pháp JavaScript | 39 tệp đạt | `npm run check` |
| Chrome headless, mô phỏng mặc định | 15/15 nhóm đạt | [always-on-simulation-browser-results.json](always-on-simulation-browser-results.json) |
| Chrome headless, telemetry | 13/13 nhóm đạt | [always-on-telemetry-browser-results.json](always-on-telemetry-browser-results.json) |

Đã xem ảnh giao diện lúc để yên, tắt bãi trong Quản trị và bật lại: trạng thái, màu điểm đo, số bãi đỏ và chuông khớp dữ liệu. Kiểm tra trình duyệt dùng SQLite riêng và ảnh tile fixture; không xác nhận khả dụng của máy chủ bản đồ bên ngoài. Backend localhost:3000 của người dùng đang dừng khi kiểm tra cuối; cần khởi động lại để nạp mã mới.

Đánh giá độc lập đã kiểm tra và đóng ba lỗi biên: chuyển chế độ khi trạng thái vàng chưa có episode, cập nhật ngưỡng làm kết thúc đợt đỏ và cảnh báo hiện tại bị lịch sử mới hơn đẩy khỏi giới hạn 100 bản ghi.

## Đối soát dữ liệu cục bộ

Ba bãi thực tế đều bật, số đo cuối hợp lệ 0 cm, trạng thái normal và không có episode hiện tại. Hai cảnh báo còn mở từ 13/10 không còn thuộc đợt hiện tại được đóng sau khi dry-run và thử trên bản sao SQLite nhất quán. Đã sao lưu bằng SQLite backup trước khi cập nhật:

`artifacts/backups/before-always-on-20261023-020653-653450.sqlite`

SHA-256: `ffb5376b26d083779d739352e1432d0b502ecedbe15207d6a24b7cf45a4f719f`.

Sau đối soát: 0 cảnh báo đang mở; giữ nguyên 15.358 số đo, 71 bản ghi cảnh báo và 46 hồ sơ sự cố; thêm 2 audit đối soát. Không sửa mực nước hoặc timestamp số đo. Database, bản sao lưu và biên nhận vận hành nằm ngoài Git. Hồ sơ Word, PowerPoint và bằng chứng kiểm tra trước đó giữ nguyên.
