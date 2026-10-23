# Kịch bản demo Hướng 2 IoT

Chứng minh simulator độc lập → HTTP/API → SQLite và cảnh báo → website. Mọi số đo giả lập. Không dùng số liệu/ảnh thực địa không có.

## Chuẩn bị

Theo README để cấu hình, migrate/seed DB demo và chạy backend; không seed vào DB cần giữ. Mở tài khoản manager/staff, không chiếu mật khẩu/khóa lên màn hình. Xác nhận một bãi xe, ba điểm, ngưỡng 10/20/7 cm, sample_count=3. Terminal thứ hai chạy simulator.

## Trình tự

1. Login manager, giới thiệu ba điểm đo cùng bãi xe; nhãn mô phỏng, cm, thời điểm đo, mức cảnh báo và độ mới tách riêng.
2. `npm run simulator -- --scenario normal`; xem lịch sử DB, refresh không mất số đo.
3. Dừng simulator cũ. Chạy `npm run simulator -- --scenario rise-fall`; điểm 1 normal→warning→critical→normal theo ba mẫu/5 giây. Không gọi thời gian dự kiến là phép đo độ trễ thực nghiệm.
4. Khi warning/critical, staff ack; cho thấy đã tiếp nhận nhưng chưa resolve. Chỉ ba mẫu <7 mới đóng đợt.
5. Dừng simulator hoặc chạy scenario ngắt mạng được hỗ trợ; sau >30 giây thấy offline, cảnh báo giữ nguyên. Chạy lại, chuỗi đếm bắt đầu lại.
6. Minh họa `--scenario sensor-error` (null), `--scenario late-data` (history-only), `--scenario duplicate` (retry), `--scenario fluctuate` (dao động) và `--scenario invalid-key`. Dùng `--scenario disconnect` cho ngắt điểm 1. Mỗi lần dừng tiến trình cũ trước khi chạy kịch bản mới; có thể thêm `--ticks N` để chạy hữu hạn. Nếu dùng test thay UI, nói rõ hình thức đó.
7. Staff thử chức năng quản trị bị hạn chế; manager sửa luật có version, xem audit.
8. Giải thích kiến trúc và một vấn đề đã xử lý: chung state machine, mẫu cũ/đứt chuỗi/duplicate. Chỉ trình bày test có log thật.

## Bằng chứng

Giữ lệnh chạy, thời điểm, log test, HTTP status, số readings trước/sau retry và ảnh dashboard thật nếu đã chụp. Tham chiếu `docs/test-results.md`; chưa chạy không ghi PASS. Repo https://github.com/tienpp1/TMDT. Source/README/sơ đồ/TH4 hỗ trợ bảo vệ; báo cáo Word là tệp nộp theo học phần.

Lời giải thích: “Sản phẩm hướng đến chủ bãi và người trực. Cảm biến/ESP32 là thiết kế; simulator gửi API thật. Backend kiểm tra danh tính/chất lượng/thời gian trước khi đếm ba mẫu. Xác nhận của con người tách khỏi nước rút. Mất mạng hiển thị dữ liệu không còn mới, không diễn giải im lặng là an toàn.”
