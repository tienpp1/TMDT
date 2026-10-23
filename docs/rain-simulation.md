# Mục tiêu mực nước và mô phỏng mưa theo vùng

Hai điều khiển được khôi phục từ bản sao mã nguồn trước đợt rà soát ngày 23/10/2026: thanh trượt riêng từng bãi và bộ chọn mưa trong chú thích bản đồ. Đây là dữ liệu mô phỏng phục vụ trình diễn hệ thống.

## Cách dùng

1. Đăng nhập quản lý, mở **Mô phỏng thiết bị**. Trang liệt kê các điểm đo ở tất cả cơ sở bạn có quyền quản lý. Chọn mức mục tiêu riêng cho từng bãi bằng thanh trượt hoặc ô nhập, rồi bấm **Cài Đặt Mức Nước**.
2. Với mục tiêu T, ngưỡng vàng là 50%T, đỏ là 100%T, kết thúc dưới 30%T, xác nhận sau 1 mẫu như điều khiển cũ. **Đặt Lại** đưa điểm đó về ngưỡng10/20/7cm và3mẫu. Mực nước đo được là giá trị riêng; lưu mục tiêu không làm nó lập tức bằng T.
3. Về **Tổng quan**, chọn **Mưa Nhỏ**, **Mưa Vừa** hoặc **Bão Lớn**. Nhấp bản đồ, vòng vùng nguy cơ hoặc marker để tạo mưa; có thể dùng nút nhanh **Bãi Xanh/Vàng/Đỏ**. Mỗi vùng mưa có bán kính3km; được tạo nhiều vùng, tối đa20.
4. **Tạnh Mưa** xóa các vùng mưa và tiếp tục mô phỏng rút nước. **Dừng mô phỏng** dừng hẳn nguồn số đo từ web. Đổi cơ sở hoặc đăng xuất cũng dừng nguồn cũ. Không chạy đồng thời bộ mô phỏng CLI để tránh trộn nguồn.

Các nút mưa tác động cơ sở đang chọn. Thanh trượt có thể lưu từng điểm ở cơ sở khác bạn quản lý. Các giá trị đang nhập được giữ khi trang tự cập nhật. Thiết bị vô hiệu hóa không nhận điều khiển.

## Phương trình đã phục hồi

Mỗi bước ứng với1giây mô hình. Ký hiệu T là mục tiêu đã lưu hoặc `critical_cm` đang cấu hình; r là `risk_level`, thường1/3/5 ứng với Xanh/Vàng/Đỏ.

Khoảng cách d dùng Haversine, bán kính Trái Đất6371km. Điểm đo chịu tác động khi `d <= 3 + zone_radius_km`. Vùng nguy cơ mặc định1,5km, có thể chỉnh trong Quản trị.

Giá trị cường độ5/15/30 tương ứng trọng số v=1/3/5. Hệ số khoảng cách `k = 0,30 + 0,70 × (1 − clamp(d / (3 + zone_radius_km), 0, 1))`. Mưa ở tâm có k=1; vừa chạm rìa có k=0,3. Khi chồng nhiều vùng, lấy riêng v lớn nhất và k lớn nhất như thuật toán cũ.

Tốc độ dâng: `(T/10) × (v/5) × (0,55 + 0,15r) × k` cm/bước. Hệ số vùng Xanh/Vàng/Đỏ lần lượt0,70/1,00/1,30. Khi nước không quá0,5cm, có bước khởi đầu `(0,15r + 0,15v) × (T/10) × k` trước khi cộng tốc độ dâng. Giới hạn trên là `min(T+5,90)`cm; hiển thị số đo đến0,1cm.

Khi không còn mưa chạm vùng, tốc độ rút là `(T/2)/D` cm/bước:

| Trạng thái đỉnh và mực nước | Xanh1: D | Vàng3: D | Đỏ5: D |
|---|---:|---:|---:|
| Từng đạt đỏ, còn trên T/2 | 8 | 18 | 32 |
| Từng đạt đỏ, đã xuống T/2 hoặc thấp hơn | 4 | 9 | 16 |
| Chưa từng đạt đỏ | 5 | 11 | 20 |

Nước không giảm dưới0. Đỉnh mô phỏng được xóa khi rút hết hoặc đổi mục tiêu. Vùng đỏ có tốc độ dâng cao hơn và thời gian rút dài hơn vùng xanh. Các hệ số là quy ước của bản mô phỏng cũ, không phải kết quả đo khí tượng/địa hình.

Với ngưỡng đặc biệt dưới5cm được đặt trong Quản trị, mô hình giữ phần lẻ nội bộ để tốc độ nhỏ hơn độ phân giải0,1cm vẫn tích lũy và nước rút được về0. Phần lẻ chỉ được dùng lại khi số đo, timestamp và phiên bản luật vẫn khớp; thay số đo bên ngoài hoặc cấu hình sẽ bỏ phần lẻ cũ. Mục tiêu từ5cm trở lên giữ cách làm tròn từng bước của bản cũ.

## Tích hợp với hệ thống hiện tại

Mỗi bước sinh reading qua cùng bộ xử lý nhận dữ liệu: lịch sử, số mẫu liên tiếp, cảnh báo và sự cố dùng cấu hình hiện hành. Không cập nhật cảnh báo trực tiếp từ màu vùng. Nước về0 nhưng chưa đủ mẫu kết thúc thì gửi tiếp các mẫu0 cần thiết. Điểm chưa có số đo ngoài vùng mưa vẫn hiển thị chưa có dữ liệu; chủ động tạo mưa tại điểm chưa có số đo dùng nền giả lập0cm để khởi tạo mô hình.

Khác biệt có chủ đích so với mã cũ: giới hạn90cm thay vì thanh trượt100cm; vùng mưa ghi đúng bán kính thực3km thay vì lời hướng dẫn cũ ghi5km; không có worker toàn cục tự tạo số đo khi khởi động. Cập nhật mục tiêu cần quyền quản lý và đúng phiên bản. Telemetry nhận từ thiết bị giữ nguyên giá trị gửi lên.
