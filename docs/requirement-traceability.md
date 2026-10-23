# Đối chiếu yêu cầu Hướng 2 và TH4

Đối chiếu ngày 23/10/2026 với hai tài liệu Word người dùng cung cấp. Các chủ đề gợi ý trong TH4 được phân biệt với yêu cầu tối thiểu; không áp chức năng thương mại điện tử của Hướng 1 cho đề tài IoT. PostgreSQL không phải yêu cầu bắt buộc của hai tài liệu.

| Yêu cầu chính thức | Kết quả và bằng chứng hiện tại | Kết luận |
|---|---|---|
| Bài toán thực tế, người dùng, phạm vi và tên đề tài | README, báo cáo trang 1, `business-model.md` | Có thiết kế cho chủ bãi/quản lý/nhân viên, ba điểm đo giả lập |
| Cấu tạo và nguyên lý sản phẩm | `architecture.md`, báo cáo, slide: cảm biến khoảng cách và ESP32 dự kiến, h = H − d | Đã mô tả; phần cứng là giả định chưa chế tạo |
| Kiến trúc và luồng dữ liệu | `architecture.md`, `coursework/figures/architecture.*` | Có vai trò thu thập, truyền, xử lý, lưu và hiển thị |
| Cơ sở dữ liệu hoặc mô hình dữ liệu | SQLite schema, ERD trong `architecture.md` và báo cáo | Đã triển khai; migration/seed có kiểm thử dữ liệu mới và legacy |
| Ít nhất 2 Sequence Diagram | `sequence-telemetry.*`, `sequence-ack.*`, Mermaid trong `architecture.md` | Có 2 luồng trong báo cáo Word và bộ sơ đồ |
| API/giao tiếp, dữ liệu và tương tác | `api.md`, telemetry, API theo vai trò, simulator HTTP độc lập | Có đặc tả và luồng chạy thật qua HTTP |
| Threat Model và ít nhất 5 test bảo mật | `threat-model.md`, các suite telemetry/devices/security/operations/persistent-session | Có mô hình mối đe dọa và test chạy thật, vượt mức tối thiểu |
| Prototype/mô phỏng minh họa ít nhất 1 chức năng | Simulator 10 kịch bản, website, `demo-script.md`, ảnh trong `coursework/evidence/` | Đã kiểm chứng từ số đo tới trạng thái/cảnh báo/giao diện |
| Khách hàng, giá trị, chi phí/giá dự kiến và cách bán | `business-model.md`, báo cáo và slide | Có phân tích sơ bộ; số tiền là giả định, chưa có khảo sát/báo giá |
| Git repository và README | `https://github.com/tienpp1/TMDT`, README hướng dẫn cài, chạy, test và demo | Có mã nguồn, lockfile, tài liệu và minh chứng trong bản bàn giao |
| Phân công rõ ràng | `team.md`, Nhóm 10 và ba thành viên/MSSV đã xác nhận | Có phân công đề xuất cụ thể; nhóm cần xác nhận phần việc thực tế |
| Báo cáo tối đa 5 trang Word | `coursework/Bao_cao_IoT_Nhom10.docx`, receipt kiểm tra số trang | Đúng 5 trang, đã render và xem toàn bộ |
| Slide và nội dung demo | `coursework/slides/Thuyet_minh_IoT_Nhom10.pptx`, `demo-script.md` | 8 slide, có vấn đề kỹ thuật, rủi ro bảo mật và minh chứng |
| TH4: một lớp thiết kế bổ sung có giá trị | Logic cảnh báo và vận hành khi dữ liệu gián đoạn | Đã thiết kế và gắn với prototype hiện tại |
| TH4: bối cảnh, người dùng và vấn đề | Phiếu TH4 cuối trang 4; `coursework/TH4_tra_loi.md` | Đã điền đầy đủ |
| TH4: sơ đồ thành phần và luồng dữ liệu | Kiến trúc, lưu đồ trạng thái và mẫu dữ liệu | Có hiện vật trong báo cáo, slide và thư mục figures |
| TH4: ít nhất 4 quyết định thiết kế | Phiếu có 5 quyết định, Markdown giải thích 6 quyết định | Bao gồm ngưỡng/ba mẫu, độ mới/trùng, lỗi/mất mạng, ranh giới xử lý và quyền |
| TH4: ít nhất một hiện vật và cách tích hợp | Sơ đồ và mô phỏng dùng chung ingest; liệt kê API/bảng cần sửa | Có hiện vật và mô tả tích hợp; thiết bị được thay bằng simulator |

Kết quả kiểm chứng cuối: **68/68 test thuộc 8 suite**, **10/10 nhóm kiểm tra Chrome**, kiểm tra cú pháp **34 file JavaScript**, `npm audit` ghi **0 lỗ hổng được báo cáo**. Xem `test-results.md` và các JSON gốc trong `review-2026-10-23/`.

Các giới hạn không được diễn đạt thành kết quả đã hoàn thành: chưa thử cảm biến thực, chưa khảo sát khách hàng hoặc có báo giá; phân công còn cần nhóm xác nhận. Quy định học phần yêu cầu nhóm hiểu và tự biên soạn nội dung, không nộp nguyên toàn bộ nội dung AI. Việc đánh giá cuối cùng thuộc giảng viên.
