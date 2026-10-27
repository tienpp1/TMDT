# Xóa bãi và báo cáo mực nước

## Hành vi

- Quản trị có nút **Xóa bãi** riêng với Vô hiệu hóa/Kích hoạt lại. Xác nhận sẽ đặt `deleted_at`, dừng hoạt động/đóng cảnh báo, loại khỏi bản đồ, danh sách quản trị, mô phỏng và báo cáo đang vận hành. Không xóa readings/incidents/audit. API không cho bật lại bãi đã xóa; tra cứu lịch sử theo ID vẫn kiểm tra quyền cơ sở.
- Báo cáo hiện trực tiếp số đo, ngưỡng, trạng thái và thời gian UTC+7; có khoảng xuất CSV. Chặn phản hồi cũ của yêu cầu mạng ghi đè báo cáo mới, gồm phản hồi lỗi.
- CSV phân loại từng số đo: dưới vàng **OK**, từ vàng đến dưới đỏ **Cảnh báo**, từ đỏ **Nguy hiểm**. Khi nước rút, trạng thái giảm tương ứng. Không dùng `quality=ok` như trạng thái an toàn; lỗi cảm biến là **Không xác định**.
- Mỗi reading mới lưu ngưỡng/phiên bản tại lúc nhận. Bản ghi cũ thiếu snapshot được đối chiếu ngưỡng hiện tại với nhãn nguồn rõ ràng; không tự tạo lịch sử cấu hình. Mẫu đến trễ cũng nêu rõ ngưỡng tại lúc nhận.
- CSV có BOM, CRLF, tiếng Việt, UTC+7/UTC gốc, tên/vị trí/ngưỡng/chất lượng/cờ lịch sử và nguồn ngưỡng; xử lý ô có ký tự công thức. Báo cáo tải đầy đủ khoảng đã chọn, không còn giới hạn ngầm 1.000 dòng. File đã tải là bản chốt, không tự cập nhật.

## Kiểm tra

Jest: **177/177** bài, **13/13** bộ đạt tại [bay-report-test-results.json](bay-report-test-results.json). Kiểm tra cú pháp **42** tệp JavaScript đạt. Bài kiểm thử mới đã được chạy thất bại trước khi triển khai và chạy lại đạt sau sửa.

Chrome headless: **17/17** nhóm đạt, không có lỗi JavaScript/API ngoài các tình huống lỗi chủ động đã lọc; xem [bay-report-browser-results.json](bay-report-browser-results.json). Đã tải CSV thực qua nút Báo cáo, đối chiếu đủ năm mức OK → Cảnh báo → Nguy hiểm → Cảnh báo → OK sau đổi luật; đã hủy rồi xác nhận xóa qua UI và kiểm tra lịch sử vẫn tải được. Đã xem ảnh trang Báo cáo và hộp xác nhận. Trình duyệt dùng tile fixture nên không xác nhận máy chủ bản đồ bên ngoài.

Đánh giá độc lập đã tái hiện và xác nhận sửa lỗi phản hồi báo cáo cũ ghi đè mức Nguy hiểm mới. Các kiểm tra backend bao gồm phân quyền, xóa lặp, cập nhật đồng thời với mưa/kích hoạt, rollback khi audit lỗi, giữ lịch sử và không cho khôi phục bãi đã xóa. Các kiểm tra CSV bao gồm chu kỳ dâng/rút, đúng biên ngưỡng, thay cấu hình, lỗi cảm biến, dữ liệu cũ, hơn 1.000 dòng, khoảng thời gian và escape công thức.

## Dữ liệu cục bộ

Đã sao lưu SQLite nhất quán trước migration bổ sung cột: `artifacts/backups/before-bay-reports-20261027-143108-108398.sqlite`.

SHA-256: `380c5fb01a488c5f4a7a5982c214a092a6059809a171d949070c939a125540e6`.

Đối chiếu sau migration giữ nguyên 4 bãi, 15.810 số đo, 78 cảnh báo, 53 hồ sơ và 568 audit; không có bãi thực tế nào bị xóa trong quá trình triển khai. Database, bản sao lưu và dữ liệu vận hành không đưa vào Git. Mã thử nghiệm dùng DB tạm riêng.

Máy khác cần chạy `npm run db:migrate` trước khi khởi động lại backend. Với máy cục bộ này migration đã được áp dụng, không sửa `.env` hoặc cấp lại khóa.
