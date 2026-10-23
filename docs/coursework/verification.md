# Kiểm tra bộ tài liệu học phần

## Phạm vi và công cụ

Nguồn Word trong Downloads được đọc, không ghi đè. Tài liệu được tạo bằng Python/Node của Codex workspace dependencies. Sơ đồ SVG/PNG là bản vẽ xác định từ code; không phải ảnh ứng dụng chạy thật.

Windows runtime không chứa LibreOffice và Word COM không đăng ký. Đã lấy MSI LibreOffice 26.2.6 từ nguồn chính thức The Document Foundation, kiểm tra Authenticode Valid với người ký The Document Foundation, rồi administrative-extract vào `%TEMP%/codex-tmdt-lo-20261023/extracted`. Không cài ứng dụng toàn hệ thống và không bật giao diện. Phiên bản headless trả `LibreOffice 26.2.6.3`.

Canonical `render_docx.py` được chạy với binary tạm trong PATH và profile riêng; Poppler của runtime tạo PNG. Lần render nguồn có lỗi console cp1252 khi in tên tiếng Việt, đã chạy lại với `PYTHONIOENCODING=utf-8`, thành công. Cảnh báo `Could not find platform independent libraries <prefix>` không ngăn tạo PDF/PNG.

## Kết quả bố cục ban đầu

- Báo cáo: 5 trang A4, hai sequence, kiến trúc, ERD; đã mở và xem đủ cả năm PNG.
- TH4 đã điền: 4 trang, đã mở và xem cả bốn PNG; toàn bộ câu trả lời cuối nằm trên trang 4.
- Nguồn TH4: 4 trang. So pixel với bản điền: trang 2 và 3 giống hệt; trang 1 chỉ vùng Nhóm; trang 4 chỉ vùng phiếu. Xem `qa/th4-fidelity.json`.
- Kiểm tra package TH4: chỉ `word/document.xml` thay đổi; tất cả ZIP parts khác có SHA256 giống nguồn. Bảng vẫn 6; xem `template-preservation.json`.
- Sau QA ban đầu, đã sửa border Title mặc định và nhãn ERD để không gộp audit_logs với quan hệ devices–alerts. Render cuối `qa/report-final` vẫn đúng 5 trang; `qa/th4-final` đúng 4 trang. Đã mở và xem đủ cả 9 PNG cuối: không clipping/overlap, đủ tiếng Việt, hai sequence đọc được, bảng không cắt nội dung.

## Kết quả phần mềm

Không suy từ tài liệu hay kế hoạch thành PASS. JSON cuối ghi 8 suites, 68 tests PASS, không fail/pending; Chrome headless 10 checks PASS và không lỗi JavaScript/API. Bản Word/slide dẫn trực tiếp JSON và `../test-results.md`; không in cứng số Jest để tránh sai khác khi nhóm bổ sung ca. Không có thử nghiệm phần cứng/thực địa.

## PowerPoint

Bản 8 slide dùng `@oai/artifact-tool`, sơ đồ và bảng là đối tượng native chỉnh sửa được. QA phát hiện draft dùng thuộc tính font sai và mũi tên ngược; đã sửa trong nguồn trước bản bàn giao. Finalizer xác nhận package integrity, layout, Arial và first-party import đều đạt, 0 findings/0 warnings. Đã xem đủ 8 PNG sau sửa: không tràn chữ hoặc mũi tên sai chiều. Slide 8 có ảnh dashboard chạy thật với dữ liệu giả lập. Chưa mở bằng Microsoft PowerPoint; kiểm tra runtime không được diễn đạt thành kiểm tra ứng dụng PowerPoint.

Receipt riêng: `.slides-build/Thuyet_minh_IoT_Nhom10.pptx.validation.json`. Bản cuối: `slides/Thuyet_minh_IoT_Nhom10.pptx`. Các hash/số trang cuối ở `artifact-verification.json`. Thư mục `qa` và `.slides-build` là bằng chứng kiểm tra nội bộ, được bỏ qua khi commit.

## Hiệu chỉnh sau review

Đối chiếu telemetry xác nhận thiếu/sai khóa trả 401, khóa hợp lệ thuộc thiết bị khác trả 403 DEVICE_MISMATCH. Đã sửa hàng S02 trong báo cáo/nguồn và Threat Model, làm rõ API. Đổi mô tả kiểm thử chức năng từ yêu cầu tương lai thành các trường hợp đã bao gồm trong bộ kiểm thử. Báo cáo được dựng lại riêng và render trong `qa/report-reviewed-final`, vẫn 5 trang; đã xem đủ năm PNG, không tràn/chồng nội dung. So pixel: trang 1, 2, 3 và 5 giống hệt bản trước; chỉ trang 4 đổi như dự kiến (`qa/report-review-fidelity.json`). Không sửa nội dung TH4 hay PowerPoint; hash TH4 so receipt trước review giống hệt. Receipt tổng hợp đã cập nhật 68 Jest PASS và 10 browser checks PASS.
