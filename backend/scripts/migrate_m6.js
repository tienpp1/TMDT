const db = require('../src/db');

async function migrate() {
  try {
    // 1. Quận 1
    await db.query("UPDATE devices SET lat = 10.776, lng = 106.701, point_label = 'Khu Quận 1 (Ổn định)' WHERE id = '11111111-1111-4111-8111-111111111111'");
    // 2. Khu vực phía Đông (Vừa)
    await db.query("UPDATE devices SET lat = 10.840, lng = 106.780, point_label = 'Khu vực Đông (Vừa)' WHERE id = '22222222-2222-4222-8222-222222222222'");
    // 3. Khu vực phía Nam (Nặng)
    await db.query("UPDATE devices SET lat = 10.680, lng = 106.720, point_label = 'Khu vực Nam (Nặng)' WHERE id = '33333333-3333-4333-8333-333333333333'");

    console.log("Migration M6 completed.");
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}

migrate();
