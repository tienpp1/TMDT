# Threat Model và kiểm thử bảo mật

Tài sản: mật khẩu/hash, khóa thiết bị, cookie phiên, số đo, luật, cảnh báo, lịch sử tiếp nhận, quyền theo cơ sở. Ranh giới: simulator→API, web→API, API→SQLite, quản trị→cấu hình. Áp dụng prototype một bãi xe, không tuyên bố an toàn thực địa.

| Đe dọa | Tác động | Biện pháp |
|---|---|---|
| Giả mạo thiết bị | Số đo giả gây cảnh báo sai | Khóa riêng, hash khi lưu, kiểm tra active và đúng ID |
| Sửa dữ liệu/replay | Đổi state bằng mẫu trùng/cũ | Validate kiểu/miền/time; unique ID; history-only |
| Vượt quyền | Staff sửa luật, đọc thiết bị ngoài cơ sở | Kiểm tra role và site từ DB trên server |
| Chiếm/cố định phiên | Dùng phiên cũ hoặc cookie bị lấy | Đổi phiên login, hủy logout, HttpOnly/SameSite, Secure với HTTPS |
| CSRF | Website khác gửi sửa cấu hình | Origin-check, JSON và SameSite; CLI không Origin là ngoại lệ thiết kế |
| SQL injection/XSS | Thực thi câu lệnh/script từ đầu vào | SQL tham số hóa; render văn bản an toàn |
| DoS | Flood login/telemetry, JSON lớn | Rate limit, giới hạn 16 KB và kiểm soát lỗi |
| Chối bỏ | Không biết ai đổi ngưỡng/ack | Audit người, thời điểm, đối tượng, thay đổi; không ghi secret |
| Lộ khóa | Response/Git/log chứa khóa/hash | Chỉ trả khóa gốc một lần; không serialize hash; bỏ env/DB khỏi Git |
| Ghi đồng thời | Trùng cảnh báo/trộn transaction | Giao dịch ghi tuần tự, unique, rollback và test concurrency |

## Các ca bảo mật tối thiểu

Đây là **tiêu chí kiểm thử**, không tự khẳng định PASS. Kết quả chạy thật ghi tại `docs/test-results.md` và log/evidence của đợt kiểm thử.

| Mã | Thao tác | Mong đợi |
|---|---|---|
| S01 | API bảo vệ trước login/sau logout | 401, không lộ dữ liệu |
| S02 | Khóa thiếu/sai; khóa A dùng cho B | Thiếu/sai khóa → 401; khóa A dùng cho B → 403 DEVICE_MISMATCH; không thêm reading |
| S03 | Staff sửa luật/quản trị; ID ngoài cơ sở | 403/404 theo chính sách, DB giữ nguyên |
| S04 | Quality lạ, chuỗi thay số, null sai, time sai | 400, không đổi state |
| S05 | Retry giống; trùng ID khác payload; mẫu cũ | Không tăng dữ liệu; 409; history-only |
| S06 | Request đổi dữ liệu từ Origin khác | Chặn trước DB |
| S07 | Chuỗi SQL/XSS, JSON quá lớn | Không thực thi SQL/script, không bypass; chặn payload lớn |
| S08 | Soi response thiết bị, Git diff, log | Không lộ khóa/hash; chỉ hiển thị khóa mới một lần |
| S09 | Vượt hạn mức; cùng bản tin đồng thời | Rate limit và DB giữ toàn vẹn |
| S10 | Đổi luật bằng expected_version cũ | 409, không ghi đè luật mới |

## Chức năng liên quan tính toàn vẹn

F01: 3 mẫu ≥10 mở warning. F02: 3 mẫu ≥20 mở/nâng critical, không lặp theo từng mẫu. F03: 3 mẫu <7 mới normal; đúng 7 không clear. F04: ack không resolve. F05: sensor_error không thành 0, ngắt chuỗi. F06: offline >30 giây; mẫu cũ không che độ mới. F07: đổi luật/restart/duplicate/concurrency giữ dữ liệu nhất quán.

Chưa có thử phần cứng, sai số, pin, chịu nước, mạng thực địa. Khi triển khai ngoài máy phát triển cần HTTPS, secret riêng, backup/restore, quản lý vòng đời khóa, quan trắc lỗi và thử tải. Cảnh báo hỗ trợ người vận hành, không thay quy trình an toàn và không có số giảm thiệt hại định lượng được chứng minh.
