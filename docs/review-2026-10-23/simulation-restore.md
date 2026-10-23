# Khôi phục mục tiêu mực nước và mưa theo vùng

## Căn cứ và phạm vi

Người dùng yêu cầu trả lại thanh trượt riêng từng bãi xe trong trang Mô phỏng thiết bị, bộ chọn mưa ở chú thích bản đồ và thuật toán dâng/rút theo cường độ, khoảng cách, vùng ngập. Đối chiếu bản sao `project-before.zip` được tạo trước khi rà soát, SHA256 `7ffc6a2956a5c10b8b53c99449b2d1db7a4f509269b0e97453cd466a14ed122f`.

Đã phục hồi từ nguồn cũ:

- Mỗi bãi có mục tiêu, ngưỡng vàng50%/đỏ100%, nút Cài Đặt Mức Nước và Đặt Lại. Trang tổng hợp tất cả cơ sở quản lý, vẫn giữ phạm vi bản đồ theo cơ sở đang chọn.
- Tạnh Mưa/Mưa Nhỏ/Mưa Vừa/Bão Lớn, nút nhanh Bãi Xanh/Vàng/Đỏ, nhấp bản đồ/marker/vùng nguy cơ để tạo vùng mưa3km.
- Haversine, giao nhau của hai vùng, cộng hưởng theo khoảng cách, các hệ số dâng/rút của vùng1/3/5, ghi nhớ đỉnh để chọn nhịp rút. Công thức và cách dùng: [rain-simulation.md](../rain-simulation.md).

Giữ giới hạn90cm, phiên bản luật và phân quyền hiện tại. Lưu mục tiêu chỉ sửa cấu hình; từng reading mô phỏng mưa qua ingestion chung. Tạnh Mưa tiếp tục rút; Dừng mô phỏng dừng gửi; đăng xuất/đổi cơ sở hủy nguồn cũ. Bộ gửi kịch bản cũ vẫn có trong Kiểm thử nâng cao.

## Kiểm chứng cuối

| Kiểm tra | Kết quả |
|---|---|
| `npm test -- --json --outputFile=docs/review-2026-10-23/simulation-restore-test-results.json` | 10/10 suites, **139/139 tests đạt**, không thất bại |
| `npm run check` | **37 file JavaScript hợp lệ** |
| `npm run test:e2e` | **13/13 nhóm đạt**, không có lỗi JavaScript/API ngoài dự kiến |
| Review độc lập backend/frontend | Các lỗi được nêu đã sửa và re-review đạt |
| Xem ảnh desktop và viewport390px | Đã xem trang mục tiêu và chú thích thời tiết; điều khiển hoạt động, không tràn ngang |

Kết quả máy đọc: [Jest](simulation-restore-test-results.json), [Chrome](simulation-restore-browser-results.json). Browser dùng DB tạm, cơ sở thứ hai và vùng1/3/5 giả lập để kiểm tra lưu riêng từng bãi, reload, bản nháp, thay mục tiêu từ nơi khác, mưa làm đỏ dâng nhanh hơn vàng/xanh, rút sau khi tạnh, dừng nguồn, tách cơ sở và quyền nhân viên.

Tile nền bị chặn và thay bằng PNG fixture trong kiểm thử; báo cáo ghi rõ `live_provider_verified:false`. Các ảnh mới dưới `artifacts/e2e/screenshots` là ảnh kiểm thử, không thay bộ minh chứng Word/slide cũ.

## Các regression đáng chú ý

- Cập nhật mục tiêu và PATCH luật cùng hàng đợi với rain step: không tính theo ngưỡng cũ rồi tạo cảnh báo theo ngưỡng mới, không khôi phục nhầm đỉnh vừa reset.
- Khi nước về0, tiếp tục gửi đủ số mẫu kết thúc theo luật; không kẹt cảnh báo do dừng nguồn sớm.
- Ngưỡng Quản trị dưới5cm giữ phần lẻ nội bộ có kiểm tra timestamp/version để tránh kẹt do làm tròn; mục tiêu từ5cm giữ cách tính từng bước cũ.
- Dừng hoặc chuyển nguồn hủy cả generic sample đang chờ rain response, cùng callback timer cũ và phản hồi trạng thái muộn.
- Xóa bản nháp đã lưu thành công để mục tiêu mới từ nơi khác cập nhật thanh trượt; giữ các chỉnh sửa nhập trong lúc request đang chờ.
- Thiết bị vô hiệu hóa không có điều khiển ghi; nhân viên không điều khiển mưa hoặc mục tiêu.

Các kiểm thử không ghi DB đang dùng, không chạy simulator sản xuất hoặc máy chủ thứ hai ở cổng3000. Không có migration hoặc thay đổi dependency. File Word, slide và ảnh đồ án cũ được giữ nguyên.
