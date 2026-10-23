# Sửa lỗi nền bản đồ ngày 23/10/2026

Ảnh người dùng cung cấp cho thấy các tile nền là ảnh `403 Access blocked` của OpenStreetMap, trong khi điểm đo và vùng minh họa vẫn được vẽ. Header toàn ứng dụng trước đó là `Referrer-Policy: same-origin`, làm trình duyệt bỏ Referer khi gọi máy chủ tile khác origin. [Chính sách tile OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) yêu cầu trình duyệt gửi Referer để nhận diện ứng dụng.

## Thay đổi

- Đổi header HTML và chính sách tải tile thành `strict-origin-when-cross-origin`: gửi origin ứng dụng, không gửi đường dẫn hoặc query sang dịch vụ bản đồ.
- Dùng chung cách tải cho bản đồ tổng quan và bản đồ chọn tọa độ. Giữ URL chuẩn `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution, cache trình duyệt mặc định và không gửi cookie cho dịch vụ ngoài.
- Kiểm tra HTTP bằng fetch trước khi gán ảnh. HTTP 403 có thể chứa PNG hợp lệ và vẫn phát sự kiện ảnh `load`, nên chỉ bắt `tileerror` là chưa đủ. Tile lỗi được ẩn và giao diện có thông báo riêng; các điểm đo và số liệu vẫn giữ nguyên.
- Hủy request và thu hồi URL blob khi ảnh tải xong, lỗi, ra khỏi viewport hoặc bị Leaflet hủy khi zoom (`tileunload`, `tileabort`). Bỏ qua callback hoàn thành muộn. Không thêm proxy, đổi máy chủ để né chặn, cache busting hay vòng lặp retry.
- Kết quả và ảnh E2E mới lưu dưới `artifacts/e2e` hoặc `E2E_ARTIFACT_DIR`. Bộ minh chứng Word/slide và ảnh đồ án trước đó được giữ nguyên.

## Kiểm chứng sau khi chốt mã

- `npm test -- --json --outputFile=docs/review-2026-10-23/map-fix-test-results.json`: **8/8 suites, 79/79 tests đạt**, gồm 22 kiểm thử frontend và regression header S17.
- `npm run check`: **34 file JavaScript hợp lệ**.
- `npm run test:e2e`: **11/11 nhóm đạt**, không có lỗi JavaScript/API ngoài dự kiến. Bản sao kết quả: [map-fix-browser-results.json](map-fix-browser-results.json).
- E2E chặn request tile và trả ảnh PNG fixture hợp lệ với HTTP 200/403. Kiểm tra Referer chỉ chứa origin, thông báo lỗi, ẩn ảnh lỗi, giữ điểm đo, khôi phục và cả bản đồ chọn tọa độ. **Đây không phải xác nhận dịch vụ OSM thật đang truy cập được.**
- Review riêng phát hiện cleanup cần cả `tileabort`; đã sửa và thêm regression khi Leaflet thay callback ảnh trong lúc giải mã.

## Kết nối thực tế trên máy

[map-network-diagnostic.json](map-network-diagnostic.json) ghi nhận trang đang chạy ở cổng 3000 trả HTTP 200 với header mới. Một request tile thật từ Chrome gửi đúng Referer `http://localhost:3000/`, nhưng thất bại với `net::ERR_NAME_NOT_RESOLVED`. DNS mặc định không trả địa chỉ; truy vấn chẩn đoán riêng qua `1.1.1.1` trả CNAME/địa chỉ hợp lệ. PowerShell cũng báo không tồn tại tên miền khi dùng DNS mặc định; xóa cache DNS không giải quyết được.

Không thay cấu hình DNS/hosts của máy và không gắn cứng IP trong ứng dụng. Sau khi cập nhật, dùng `Ctrl+Shift+R` để tải lại. Nếu nền vẫn không tải, cần khắc phục DNS/kết nối của máy để phân giải được `tile.openstreetmap.org`; ví dụ kiểm tra lại trên mạng khác hoặc cấu hình DNS của kết nối đang dùng. Các chức năng số đo/cảnh báo không phụ thuộc việc tile nền tải thành công.
