const db = require('../src/db');

async function migrateM7() {
  console.log("Running migration M7...");
  const client = await db.pool.connect();
  try {
    // Add columns to devices
    try {
      await client.query('ALTER TABLE devices ADD COLUMN zone_radius_km REAL DEFAULT 1.5');
      console.log("Added zone_radius_km to devices");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) console.log(e.message);
    }

    try {
      await client.query('ALTER TABLE devices ADD COLUMN risk_level INTEGER DEFAULT 1');
      console.log("Added risk_level to devices");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) console.log(e.message);
    }

    // Set initial values for existing 3 devices
    await client.query(`
      UPDATE devices 
      SET risk_level = 5, zone_radius_km = 1.5 
      WHERE point_label LIKE '%Đỏ%' OR name LIKE '%Đỏ%' OR name LIKE '%Do%'
    `);
    await client.query(`
      UPDATE devices 
      SET risk_level = 3, zone_radius_km = 1.5 
      WHERE point_label LIKE '%Vàng%' OR name LIKE '%Vàng%' OR name LIKE '%Vang%'
    `);
    await client.query(`
      UPDATE devices 
      SET risk_level = 1, zone_radius_km = 1.5 
      WHERE point_label LIKE '%Xanh%' OR name LIKE '%Xanh%'
    `);

    // Add columns to incidents
    try {
      await client.query('ALTER TABLE incidents ADD COLUMN device_id TEXT');
      console.log("Added device_id to incidents");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) console.log(e.message);
    }

    try {
      await client.query('ALTER TABLE incidents ADD COLUMN title TEXT');
      console.log("Added title to incidents");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) console.log(e.message);
    }

    try {
      await client.query('ALTER TABLE incidents ADD COLUMN reported_by TEXT');
      console.log("Added reported_by to incidents");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) console.log(e.message);
    }

    try {
      await client.query('ALTER TABLE incidents ADD COLUMN manager_note TEXT');
      console.log("Added manager_note to incidents");
    } catch(e) {
      if(!e.message.includes("duplicate column name")) console.log(e.message);
    }

    console.log("Migration M7 completed successfully.");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrateM7();
