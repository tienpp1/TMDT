const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.NODE_ENV = 'test';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tmdt-setup-'));
process.env.SQLITE_PATH=path.join(temp,'fresh.sqlite');
const db=require('../../backend/src/db');

afterAll(async()=>{await db.pool.end();fs.rmSync(temp,{recursive:true,force:true});});
test('fresh database has every device and incident column required by routes',async()=>{
  const {migrate}=require('../../backend/scripts/migrate');
  expect(typeof migrate).toBe('function');
  await migrate();
  const conn=await db.getDb();
  const deviceCols=(await conn.all('PRAGMA table_info(devices)')).map(c=>c.name);
  const incidentCols=(await conn.all('PRAGMA table_info(incidents)')).map(c=>c.name);
  expect(deviceCols).toEqual(expect.arrayContaining(['demo_override_level','lat','lng','zone_radius_km','risk_level']));
  expect(incidentCols).toEqual(expect.arrayContaining(['device_id','title','reported_by','manager_note']));
  expect((await conn.get('PRAGMA foreign_keys')).foreign_keys).toBe(1);
});
test('migration can run twice and does not change existing device data',async()=>{
  const {migrate}=require('../../backend/scripts/migrate');
  await db.query('INSERT INTO sites(id,name) VALUES($1,$2)',['s','Existing site']);
  await db.query('INSERT INTO devices(id,site_id,name,key_hash,latest_level_cm) VALUES($1,$2,$3,$4,12)',['d','s','Existing','hashed']);
  await migrate();
  const result=await db.query('SELECT latest_level_cm FROM devices WHERE id=$1',['d']);
  expect(result.rows[0].latest_level_cm).toBe(12);
});
test('demo seed is idempotent and preserves existing records and passwords',async()=>{
  const {seed}=require('../../backend/scripts/seed');
  expect(typeof seed).toBe('function');
  await seed({writeSimulatorEnv:false});
  const before=(await db.query('SELECT password_hash FROM users WHERE email=$1',['manager@example.com'])).rows[0].password_hash;
  await seed({writeSimulatorEnv:false});
  expect((await db.query('SELECT password_hash FROM users WHERE email=$1',['manager@example.com'])).rows[0].password_hash).toBe(before);
  expect((await db.query('SELECT latest_level_cm FROM devices WHERE id=$1',['d'])).rows[0].latest_level_cm).toBe(12);
  expect((await db.query('SELECT COUNT(*) AS n FROM devices')).rows[0].n).toBe(4);
});
test('legacy database gains missing columns and classifies system notes without losing text',async()=>{
  const {open}=require('sqlite');
  const sqlite3=require('sqlite3');
  const legacyPath=path.join(temp,'legacy.sqlite');
  const legacy=await open({filename:legacyPath,driver:sqlite3.Database});
  await legacy.exec("CREATE TABLE incidents(id TEXT PRIMARY KEY,episode_id TEXT,site_id TEXT); CREATE TABLE incident_notes(id TEXT PRIMARY KEY,incident_id TEXT,author_id TEXT,note TEXT,created_at TEXT); INSERT INTO incident_notes(id,note) VALUES('report','[Báo cáo bởi: Nhân viên] Đã tạo báo cáo sự cố.'),('assignment','[Chỉ đạo phân công bởi Quản lý] Kiểm tra'),('outcome','Đã kiểm tra và xử lý');");
  await legacy.close();
  require('child_process').execFileSync(process.execPath,[path.resolve(__dirname,'../../backend/scripts/migrate.js')],{env:{...process.env,SQLITE_PATH:legacyPath},stdio:'pipe'});
  const upgraded=await open({filename:legacyPath,driver:sqlite3.Database});
  try{
    const notes=await upgraded.all('SELECT id,note,kind FROM incident_notes ORDER BY id');
    expect(notes.map(n=>[n.id,n.kind])).toEqual([['assignment','assignment'],['outcome','outcome'],['report','report']]);
    expect(notes[2].note).toContain('Đã tạo báo cáo sự cố.');
    expect((await upgraded.all('PRAGMA table_info(incidents)')).map(c=>c.name)).toContain('device_id');
  }finally{await upgraded.close();}
});
