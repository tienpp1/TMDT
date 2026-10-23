# IoT giám sát mực nước và cảnh báo ngập bãi giữ xe

Đồ án Thương mại điện tử của **Nhóm 10**, chọn **Hướng 2 — thiết kế sản phẩm IoT bằng prototype và mô phỏng**. Hệ thống gồm website, Express API, SQLite và chương trình giả lập ba điểm đo gửi HTTP độc lập. Dữ liệu là mô phỏng; chưa kiểm chứng cảm biến hay sản phẩm vật lý.

| Thành viên | MSSV |
|---|---|
| Hà Minh Tiến | 1250080194 |
| Trương Quốc Toàn | 1250080203 |
| Huỳnh Nguyễn Duy Tiến | 1250080195 |

Repository: https://github.com/tienpp1/TMDT . Xem [phân công đề xuất](docs/team.md) để nhóm xác nhận phần việc thực tế.

## Cài đặt và chạy

Cần Node.js từ phiên bản 20.17.0, npm và trình duyệt. Không cần cài PostgreSQL. Chạy tại thư mục dự án:

```powershell
npm ci
Copy-Item .env.example .env
# Đặt SESSION_SECRET riêng trong .env trước khi dùng chung hệ thống.
npm run db:migrate
npm run db:seed
npm start
```

Mở http://localhost:3000 . Tài khoản demo mới: `manager@example.com` / `manager123` và `staff@example.com` / `staff123`. Có thể đặt mật khẩu khác qua `DEMO_MANAGER_PASSWORD` và `DEMO_STAFF_PASSWORD` trước lần seed đầu. Seed lặp lại giữ nguyên mật khẩu, thiết bị và lịch sử hiện có.

Ở cửa sổ PowerShell thứ hai:

```powershell
npm run simulator -- --scenario rise-fall --ticks 14
```

Simulator đọc ba khóa đã cấp từ `.env.simulator`; seed tạo khóa ngẫu nhiên cho thiết bị mới. Mỗi thiết bị gửi một mẫu mỗi5giây. Khóa cũ không thể khôi phục từ hash: quản lý có thể cấp lại trong Quản trị, sao chép khóa một lần rồi sửa cấu hình simulator. Thay `PORT` và `APP_BASE_URL` cùng nhau nếu cổng3000 đã được dùng.

Trang **Mô phỏng thiết bị** có thanh trượt riêng cho từng bãi/điểm đo thuộc các cơ sở bạn quản lý. **Cài Đặt Mức Nước** lưu mục tiêu 5–90 cm và đặt ngưỡng vàng 50%, đỏ 100%, kết thúc 30%, xác nhận sau 1 mẫu như chức năng cũ. **Đặt Lại** khôi phục 10/20/7 cm và 3 mẫu. Mực nước đo được hiển thị riêng; lưu mục tiêu không tự tạo số đo. Bộ gửi theo kịch bản vẫn ở phần **Kiểm thử nâng cao** bên dưới.

Trong chú thích bản đồ **Tổng quan**, chọn **Mưa Nhỏ**, **Mưa Vừa** hoặc **Bão Lớn**, rồi nhấp bản đồ/điểm đo/vùng nguy cơ hoặc chọn nhanh **Bãi Xanh/Vàng/Đỏ**. Vùng mưa bán kính 3 km làm nước dâng khác nhau theo cường độ, khoảng cách và mức dễ ngập. **Tạnh Mưa** để nước rút theo từng vùng; **Dừng mô phỏng** dừng gửi số đo. Xem [thuật toán và cách dùng](docs/rain-simulation.md).

Bấm dừng mô phỏng trên web trước khi chạy simulator độc lập để giữ kịch bản dễ quan sát. Khi không có nguồn gửi, website không tự sinh số đo hoặc đánh dấu thiết bị trực tuyến.

## Chức năng và quy tắc

- Đăng nhập, đăng xuất, quản lý và nhân viên có quyền theo cơ sở; tài khoản bị khóa mất quyền ngay ở yêu cầu API tiếp theo.
- Tổng quan, chất lượng dữ liệu, biểu đồ, lịch sử1/24/48/168giờ, cảnh báo, hồ sơ sự cố và xuấtCSV theo quyền.
- Quản lý tạo/cập nhật/vô hiệu hóa điểm đo, cấp lại khóa, chỉnh ngưỡng có kiểm tra phiên bản, quản lý tài khoản và xem nhật ký.
- Mặc định cần3mẫu liên tiếp: từ10cm tạo cảnh báo, từ20cm nâng mức cao, dưới7cm kết thúc đợt. Xác nhận tiếp nhận không tự kết thúc cảnh báo.
- Bản tin quá15giây hoặc không mới hơn mẫu hiện tại chỉ vào lịch sử; mẫu tương lai5–60giây cũng chỉ vào lịch sử; quá60giây bị từ chối. Khoảng gián đoạn trên30giây đặt lại bộ đếm. Sau30giây không nhận dữ liệu, trạng thái mất kết nối được hiển thị.
- `sensor_error` đi cùng `level_cm: null`, không được biểu diễn thành mực nước0. Mực nước hợp lệ0–90cm theo giả định cảm biến H100cm, khoảng cách10–100cm.
- Khóa băm bcrypt, UUID bản tin chống trùng, giới hạn tốc độ, truy vấn có tham số, cookie HttpOnly/SameSite và kiểm tra Origin cho yêu cầu web ghi dữ liệu.
- Hồ sơ hoàn tất sau khi đợt cảnh báo đã kết thúc, có người tiếp nhận và ghi chú kết quả; báo cáo ban đầu không thay ghi chú kết quả.

## Kiểm thử và trình diễn

```powershell
npm test
npm run check
npm run test:integration
npm run test:e2e
```

Các kiểm thử tự tạo SQLite tạm; không dùng hoặc xóa DB của bạn. Browser smoke dùng Playwright và Chrome headless, tạo máy chủ và DB demo riêng rồi dọn sau khi chạy. Xem [kịch bản demo](docs/demo-script.md), [kết quả kiểm chứng](docs/review-2026-10-23/) và [ảnh thực tế](docs/coursework/evidence/).

Các kịch bản CLI: `normal`, `warning`, `critical`, `rise-fall`, `fluctuate`, `sensor-error`, `disconnect`, `duplicate`, `late-data`, `invalid-key`. Dùng `--ticks N`, `--interval 5000` hoặc `--once` để giới hạn lần chạy. Queue cục bộ giữ bản tin khi mạng gián đoạn, có giới hạn và backoff; bản tin gửi lại vẫn phải qua kiểm tra độ mới/chống trùng. Không commit `.env`, khóa, queue hoặc SQLite.

## Hồ sơ đồ án và TH4

- [Bộ tài liệu nộp và trình bày](docs/coursework/README.md): báo cáo Word tối đa5trang, phiếuTH4 và slide.
- [Nội dung trả lời phiếuTH4](docs/coursework/TH4_tra_loi.md).
- [Kiến trúc và các sơ đồ](docs/architecture.md), [đặc tảAPI](docs/api.md), [Threat Model](docs/threat-model.md).
- [Ma trận đối chiếu yêu cầu](docs/requirement-traceability.md), [khách hàng và mô hình kinh doanh](docs/business-model.md).

TH4 bổ sung **logic cảnh báo và vận hành khi dữ liệu gián đoạn**. Các chủ đề trong TH4 là gợi ý lựa chọn; dự án không cần bổ sung giỏ hàng hoặc thanh toán của Hướng1.

## Giới hạn và vận hành

SQLite và khóa tuần tự phù hợp prototype một tiến trình. Giới hạn tốc độ nằm trong RAM và được đặt lại khi khởi động lại; chưa thay thế giải pháp bảo vệ ở cổng mạng. Bản đồ nền, font và thư viện giao diện CDN cần kết nối Internet. Bản đồ chỉ minh họa điểm đo; dữ liệu cảm biến tại một điểm không chứng minh vùng xung quanh bị ngập.

Nếu nền bản đồ hiện ảnh `403 Access blocked`, cập nhật mã rồi tải lại bằng `Ctrl+Shift+R`. Ứng dụng gửi Referer ở mức origin bằng `strict-origin-when-cross-origin`, theo [chính sách OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Khi máy chủ ảnh trả lỗi hoặc không kết nối được, giao diện báo lỗi nền bản đồ và giữ các điểm đo. Máy cần phân giải được `tile.openstreetmap.org`; kiểm tra bằng `Resolve-DnsName tile.openstreetmap.org`. Kiểm thử trình duyệt dùng ảnh tile giả lập để kiểm tra HTTP 200/403 và khả năng khôi phục; kết quả đó không xác nhận kết nối đến dịch vụ bản đồ thực tế. Ảnh kiểm thử mới lưu trong `artifacts/e2e`, tách khỏi minh chứng đồ án đã chụp.

Khi triển khai công khai cần HTTPS, `COOKIE_SECURE=true`, secret/khóa riêng, sao lưu DB và kiểm chứng hạ tầng thực tế. Chưa có khảo sát khách hàng, báo giá nhà cung cấp hoặc thử nghiệm phần cứng; các chi phí trong tài liệu là giả định cho bài thiết kế.

File `PROJECT_CONTEXT.md` và prompt nâng cấp cũ trong thư mục làm việc là tài liệu định hướng trước đây. Trạng thái triển khai hiện tại được xác định bởi mã nguồn, kiểm thử và tài liệu trong `docs/`; yêu cầu chính thức của giảng viên không bắt buộc PostgreSQL.

Hướng dẫn học phần yêu cầu nhóm hiểu và tự biên soạn phần trình bày, không đưa nguyên toàn bộ nội dung AI vào bài nộp. Nhóm cần đọc, chạy demo, xác nhận phân công và chỉnh nội dung theo phần việc thực tế trước khi nộp.
