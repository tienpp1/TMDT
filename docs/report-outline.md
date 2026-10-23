# Dàn ý Báo cáo 5 trang

1. **Bài toán và Mục tiêu**
   - Đặt vấn đề: Rủi ro ngập bãi xe.
   - Mục tiêu: Giám sát từ xa, cảnh báo 3 mức, phân quyền quản lý và nhân viên.
2. **Cấu tạo, Kiến trúc và API**
   - Cảm biến và Simulator.
   - Sơ đồ kiến trúc (Simulator độc lập -> HTTP/API -> logic -> SQLite -> Website); thiết bị siêu âm/ESP32 là thiết kế giả định H=100cm, h=H-d, miền 0–90cm.
   - Mô hình ERD và 6 API cốt lõi.
3. **Luồng dữ liệu và Cảnh báo**
   - Ít nhất hai Sequence Diagram (nhận số đo; xác nhận và kết thúc cảnh báo).
   - Logic 3 mẫu liên tiếp: 10cm (Cảnh báo), 20cm (Nguy hiểm), 7cm (Kết thúc).
4. **Bảo mật và Kiểm thử**
   - Threat Model.
   - Ít nhất năm ca bảo mật và các ca chức năng; kết quả chỉ ghi từ log thực, không coi kế hoạch là PASS.
5. **Thương mại hóa và Tổng kết**
   - Dự kiến chi phí bán hàng.
   - Git https://github.com/tienpp1/TMDT; Nhóm 10 và phân công đề xuất để nhóm xác nhận, chưa có lớp.

Bản Word ở `docs/coursework/Bao_cao_IoT_Nhom10.docx`; không làm trang bìa riêng. Kiểm tra số trang/bố cục bằng renderer trước giao. Nhóm cần hiểu và tự chỉnh nội dung theo quy định AI của học phần.
