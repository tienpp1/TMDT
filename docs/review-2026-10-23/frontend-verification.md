# Kiểm tra giao diện — 23/10/2026

Giao diện HTML/CSS/JavaScript hiện có được giữ lại. Không có bước build frontend; Express phục vụ `frontend/`. Chart.js và Leaflet tải từ CDN, bản đồ nền dùng OpenStreetMap. Nếu không tải được bản đồ, danh sách số đo vẫn hoạt động; form điểm đo hỗ trợ nhập tọa độ.

## Kiểm thử đã thực hiện

- `node --check frontend/js/api.js`: đạt.
- `node --check frontend/js/app.js`: đạt.
- `node node_modules/jest/bin/jest.js tests/frontend/workflows.test.js --runInBand`: 12/12 đạt.
- `npm run test:e2e`: 10/10 nhóm kiểm tra trên Chrome headless đạt, dùng SQLite tạm và server cổng riêng; không có lỗi JavaScript/API. Chi tiết: `browser-results.json` cùng thư mục. Có 5 ảnh thật trong `docs/coursework/evidence/`.
- 5 regression tests đầu tiên đã chạy và thất bại trên mã trước sửa: XSS, request chồng nhau, dữ liệu sau đăng xuất, lọc lịch sử/số đo lỗi, báo cáo staff.

VM chạy hàm frontend thực tế với DOM và mạng được thay ở ranh giới; kiểm thử này không thay thế việc xác minh layout bằng trình duyệt.

Các kiểm thử còn lại xác minh khóa chỉ hiển thị một lần/sao chép đúng khóa, PATCH ngưỡng kèm version, phản hồi tạo điểm đo đến sau đăng xuất, quyền mô phỏng/mỗi lần một mẫu, báo lỗi kết nối mà không thay số cũ, và cảm biến lỗi không thành 0 cm. Regression mới kiểm tra timestamp khác nhau giữa thiết bị: mỗi chuỗi dùng tọa độ thời gian riêng, chỉ mẫu cảm biến lỗi thật tạo khoảng trống.

## Checklist nghiệm thu trên trình duyệt

- [x] Đăng nhập quản lý; tải đúng 3 điểm đo chưa có số đo, có nhãn mô phỏng.
- [x] Chạy Bình thường → Vàng → Đỏ → Bình thường, mỗi kịch bản đủ 3 mẫu; xác nhận ACK không làm nước rút.
- [x] Kịch bản lỗi cảm biến hiển thị `--` trên trình duyệt; biểu đồ lịch sử nhận các điểm `{x,y}` theo từng thiết bị.
- [x] Đăng nhập staff: không thấy Quản trị/Mô phỏng; báo cáo và tải CSV hoạt động.
- [x] Lịch sử đổi sang 1 giờ gọi đúng API; biểu đồ thật Chart.js và tải CSV hoạt động. VM kiểm tra loại số đo ngoài khoảng và null lỗi.
- [x] Tạo điểm đo: tên chứa dấu nháy/HTML hiển thị nguyên văn, khóa xuất hiện một lần; sửa ngưỡng gửi version; vô hiệu hóa qua giao diện.
- [x] Đổi khóa có xác nhận; khóa mới được hiển thị một lần để cập nhật cấu hình thiết bị.
- [ ] Kiểm tra bằng trình duyệt: dữ liệu cũ, dừng gửi hơn 30 giây, mọi khung 24/48/168 giờ, trang trước/sau và kích hoạt lại. Các trường hợp API được kiểm tra riêng trong integration tests.
- [ ] Báo cáo sự cố → phân công → ghi chú → hoàn tất theo quyền và trạng thái cảnh báo.
- [x] Đăng xuất rồi đăng nhập tài khoản khác không giữ trang/biểu đồ/dữ liệu quản trị hoặc khóa.
- [x] Ở chiều rộng 390px, mở/đóng menu và đăng xuất được. Có ảnh thật; CSS cho bảng cuộn ngang.
- [x] Chặn kết nối API overview trong trình duyệt: thông báo mất cập nhật hiện rõ, trạng thái xanh tắt, số cũ được giữ.
- [x] Không có lỗi JavaScript/API trong lượt kiểm tra. VM xác minh refresh không chồng request; timer cấu hình 5 giây.

Checklist chưa đánh dấu là chưa có bằng chứng kiểm tra bằng trình duyệt tại thời điểm ghi tài liệu, không phải xác nhận đã đạt.
