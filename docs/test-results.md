# Kết quả kiểm chứng ngày 23 tháng 10 năm 2026

Kết quả dưới đây được ghi từ lệnh đã chạy, không suy từ thiết kế. Các test dùng DB tạm và Chrome headless riêng; số liệu trên ảnh là dữ liệu mô phỏng.

| Kiểm tra | Lệnh hoặc bằng chứng | Kết quả |
|---|---|---|
| Tự động API, dữ liệu, simulator, frontend, phiên bền vững | `npm test -- --json --outputFile=docs/review-2026-10-23/test-results.json` | 8 suites, 68 test đạt, 0 fail, 42.477 giây |
| Cú pháp JavaScript | `npm run check` | 34 file đạt |
| Trình duyệt thực tế | `npm run test:e2e`, `browser-results.json` | 10/10 nhóm kiểm tra đạt, 0 lỗi JavaScript/API |
| Phụ thuộc | `npm audit --json`, `dependency-audit.json` | 0 info/low/moderate/high/critical tại thời điểm chạy |
| Phiên ứng dụng thật | Test persistent-session, SQLite store và sqlite3 6.0.1 | Cookie còn hiệu lực sau restart; logout thu hồi phiên đã lưu |
| Word và slide | `coursework/artifact-verification.json` | Báo cáo 5 trang, TH4 4 trang, slide 8 trang; kiểm tra hash/bố cục đạt |

Các kiểm thử quan trọng gồm xác thực thiết bị, binding khóa/ID, dữ liệu sai, trùng và xung đột, dữ liệu cũ, giới hạn tốc độ, cạnh tranh ghi, ngưỡng ba mẫu, clear/ack, version cấu hình, quản lý cuối, tài khoản bị khóa, chống truy cập chéo cơ sở, race phân công/hoàn tất và phân loại ghi chú legacy. Có test HTTP cho hàng đợi simulator qua lỗi mạng và khởi động lại.

Browser kiểm tra dashboard không tự bịa số đo; normal/warning/critical/clear; xác nhận; chất lượng cảm biến và biểu đồ; khoảng thời gian và CSV; tên chứa HTML hiển thị như chữ; cấp/đổi khóa; mobile menu và logout; quyền nhân viên; cảnh báo khi backend ngừng. Trạng thái offline quá 30 giây được kiểm tra ở API; browser smoke không được mô tả thành thử nghiệm mạng/phần cứng ngoài hiện trường.

Nâng cấp cơ sở dữ liệu đang có đã giữ nguyên **2 users, 2 sites, 3 devices, 14.936 readings, 57 alerts, 38 incidents, 3 incident_notes**. Bản sao SQLite nhất quán đã được lưu trong thư mục TEMP trước migration; các tổng trước/sau ở `review-2026-10-23/database-before.json` và `database-after.json`. Không đưa dữ liệu hoặc khóa thực lên Git.

Rà soát độc lập đã phát hiện và sửa race thao tác sự cố, bảo vệ người quản lý cuối ở mọi cơ sở liên quan, phân loại ghi chú cũ và biểu đồ có timestamp lệch. Các ca hồi quy tương ứng đã được quan sát thất bại trước sửa và đạt sau sửa; rà soát lại không còn lỗi quan trọng trong các vùng này.

Đây là bằng chứng prototype tại máy phát triển, không phải chứng nhận an toàn, đo chính xác cảm biến, tải lớn hoặc triển khai Internet. Bản đồ và thư viện CDN cần mạng; số tiền kinh doanh là giả định và chưa có khảo sát/báo giá.
