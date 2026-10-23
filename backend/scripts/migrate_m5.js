const db = require('../src/db');

async function migrateM5() {
  console.log("Bắt đầu cập nhật schema cho M5 (lat, lng)...");
  const client = await db.pool.connect();
  try {
    // Thêm cột lat và lng
    try {
      await client.query('ALTER TABLE devices ADD COLUMN lat REAL');
      console.log(" Đã thêm cột lat");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) throw e;
    }

    try {
      await client.query('ALTER TABLE devices ADD COLUMN lng REAL');
      console.log(" Đã thêm cột lng");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) throw e;
    }

    // Tọa độ mẫu quanh Quận 1, TPHCM
    const coords = [
      { id: '11111111-1111-4111-8111-111111111111', lat: 10.7760, lng: 106.7010 }, // Cổng vào
      { id: '22222222-2222-4222-8222-222222222222', lat: 10.7765, lng: 106.7005 }, // Khu vực thấp
      { id: '33333333-3333-4333-8333-333333333333', lat: 10.7755, lng: 106.7015 }, // Thoát nước
    ];

    for (const c of coords) {
      await client.query('UPDATE devices SET lat = $1, lng = $2 WHERE id = $3', [c.lat, c.lng, c.id]);
    }

    console.log(" Đã cập nhật tọa độ mẫu thành công.");
  } catch (err) {
    console.error("Lỗi:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrateM5();
