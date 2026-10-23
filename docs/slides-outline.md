# Dàn ý Slide thuyết minh

1. **Slide 1: Tiêu đề & Bài toán**
   - Giới thiệu đề tài: Hệ thống giám sát mực nước bãi giữ xe.
2. **Slide 2: Đối tượng & Giá trị cốt lõi**
   - Khách hàng mục tiêu: Quản lý bãi xe vùng trũng.
3. **Slide 3: Kiến trúc & Công nghệ**
   - Simulator độc lập -> HTTP/Express API -> logic -> SQLite -> Website. Một bãi xe, ba điểm đo. Phần cứng siêu âm/ESP32 chưa chế tạo.
4. **Slide 4: Kịch bản Mô phỏng**
   - Demo luồng chạy (normal, warning 10cm, critical 20cm).
5. **Slide 5: Trình diễn (Demo)**
   - Đăng nhập -> Xác nhận cảnh báo -> Lỗi cảm biến/Mất kết nối.
6. **Slide 6: Bảo mật & Kiểm thử**
   - Threat Model, quyền theo cơ sở, Origin/CSRF, khóa băm, retry/history-only, rate limit; chỉ nêu kết quả test có log thực.
7. **Slide 7: Bài học & Hạn chế**
   - Phần bổ sung TH4: logic cảnh báo/gián đoạn dữ liệu, ít nhất bốn quyết định và sơ đồ. Giới hạn mô phỏng, chi phí giả định, phân công đề xuất và việc kiểm chứng tiếp theo.

Nhóm 10: Hà Minh Tiến (1250080194), Trương Quốc Toàn (1250080203), Huỳnh Nguyễn Duy Tiến (1250080195). Git https://github.com/tienpp1/TMDT. Minh họa SVG/PNG ở `docs/coursework/figures`; ảnh runtime thật ở `docs/coursework/evidence`. Bản PowerPoint tám slide: `docs/coursework/slides/Thuyet_minh_IoT_Nhom10.pptx`.
