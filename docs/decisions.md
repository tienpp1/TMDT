# Quyết định triển khai được kiểm chứng

Ngày rà soát23/10/2026. Căn cứ hai tài liệu Word do người dùng cung cấp và mã nguồn hiện tại.

1. Giữ SQLite: Hướng2 yêu cầu mô hình dữ liệu phù hợp, không chỉ định PostgreSQL. SQLite đủ cho prototype một bãi xe/một máy chủ; không tiếp tục tuyên bố đã triển khai PostgreSQL.
2. Khóa tuần tự theo tiến trình và transaction SQLite bảo vệ cảnh báo, chống trùng và cập nhật cấu hình. Không triển khai nhiều tiến trình cùng ghi DB trong bản này.
3. Một hàm ingest chung xử lý simulator HTTP và mẫu demo được quản lý chủ động gửi. Không có worker tự sửa số đo hoặc trạng thái khi import router.
4. Mặc định ba mẫu hợp lệ liên tiếp, hysteresis10/20/7cm và episode_id giúp tránh chập chờn; ACK là tiếp nhận của con người, clear là kết quả số đo, hai trạng thái độc lập. Số mẫu có thể được quản lý cấu hình.
5. Tách thời điểm đo, nhận và thời điểm dữ liệu mới hợp lệ. Bản tin cũ/trùng/lỗi không được làm tăng nhầm bộ đếm hoặc tạo số đo0.
6. Khóa thiết bị mới là ID +32ký tựhex ngẫu nhiên, tổng69byte, nằm trong giới hạn72byte bcrypt. Chỉ trả plaintext khi tạo/cấp lại, DB và audit không lưu plaintext. Khóa demo cũ tiếp tục tương thích; fallback chỉ giới hạn ba ID demo.
7. Phiên dùng SQLite store khi chạy ứng dụng; test dùng MemoryStore và DB tạm riêng. Middleware kiểm tra tài khoản còn hoạt động ở mỗi yêu cầu.
8. CSRF ở mức prototype: SameSite=Lax, JSON, kiểm tra Origin của API web ghi dữ liệu. CLI không có Origin dùng credential tương ứng. Không có token CSRF riêng trong hợp đồng API.
9. Vô hiệu hóa thiết bị giữ lịch sử; migration và seed chạy lặp không xóa dữ liệu hoặc thay mật khẩu đã có.
10. TH4 chọn một phần bổ sung: logic cảnh báo và vận hành dữ liệu gián đoạn. Cảm biến vật lý, chi phí, độ chính xác và khảo sát khách hàng được ghi đúng là thiết kế/giả định chưa xác thực.
11. Theo yêu cầu khôi phục giao diện cũ: mỗi bãi có mục tiêu T, áp dụng ngưỡng 50%/100%/30% và 1 mẫu trong chế độ mục tiêu; đặt lại dùng 10/20/7 và 3 mẫu. Bản sao nguồn trước rà soát xác nhận hành vi này. Lưu mục tiêu có phiên bản và không thay số đo telemetry thực nhận.
12. Khôi phục mô hình mưa theo vùng Xanh/Vàng/Đỏ, cường độ, giao nhau của vùng mưa/vùng nguy cơ và cộng hưởng khoảng cách. Chỉ chạy khi người quản lý chủ động tạo mưa; từng mẫu đi qua ingest chung. Tạnh mưa cho rút nước; dừng mô phỏng/ngắt phiên dừng nguồn web. Giữ giới hạn cảm biến 90cm và phân quyền theo cơ sở. Xem docs/rain-simulation.md.
