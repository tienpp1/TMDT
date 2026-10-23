const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.NODE_ENV = 'test';
// Existing suites exercise physical telemetry semantics explicitly.
process.env.DEVICE_MODE = 'telemetry';
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmdt-test-'));
process.env.SQLITE_PATH = path.join(testDir, 'test.sqlite');
process.env.SESSION_SECRET = 'test-session-secret-not-for-deployment';
process.env.APP_BASE_URL = 'http://localhost:3000';
const db = require('../../backend/src/db');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

async function setup() {
  const { migrate } = require('../../backend/scripts/migrate');
  await migrate();
  const app = require('../../backend/src/app');
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const managerId = randomUUID(), staffId = randomUUID(), otherManagerId = randomUUID();
  const passwordHash = await bcrypt.hash('test-password-123', 4);
  for (const [id,email] of [[managerId,'manager@test.local'],[staffId,'staff@test.local'],[otherManagerId,'other@test.local']]) {
    await db.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)', [id,email,email,passwordHash]);
  }
  await db.query('INSERT INTO sites(id,name) VALUES($1,$2),($3,$4)',[siteId,'Test A',otherSiteId,'Test B']);
  for (const [site,user,role] of [[siteId,managerId,'manager'],[siteId,staffId,'staff'],[otherSiteId,otherManagerId,'manager']]) {
    await db.query('INSERT INTO site_users(site_id,user_id,role) VALUES($1,$2,$3)',[site,user,role]);
  }
  const deviceId='11111111-1111-4111-8111-111111111111', otherDeviceId='22222222-2222-4222-8222-222222222222', deviceKey='test-device-key-123';
  const keyHash = await bcrypt.hash(deviceKey,4);
  for (const [id,site] of [[deviceId,siteId],[otherDeviceId,otherSiteId]]) {
    await db.query('INSERT INTO devices(id,site_id,name,key_hash) VALUES($1,$2,$3,$4)',[id,site,'Điểm đo thử nghiệm',site===siteId?keyHash:await bcrypt.hash('other-device-key-456',4)]);
    await db.query('INSERT INTO alert_rules(device_id,warning_cm,critical_cm,clear_cm,sample_count) VALUES($1,10,20,7,3)',[id]);
  }
  const manager=request.agent(app),staff=request.agent(app),otherManager=request.agent(app);
  for(const [agent,email] of [[manager,'manager@test.local'],[staff,'staff@test.local'],[otherManager,'other@test.local']]) {
    const response=await agent.post('/api/auth/login').send({email,password:'test-password-123'});
    if(response.status!==200)throw new Error(`Fixture login failed: ${response.status}`);
  }
  return {app,db,siteId,otherSiteId,managerId,staffId,otherManagerId,manager,staff,otherManager,deviceId,otherDeviceId,deviceKey};
}
async function cleanup(){
  await db.pool.end();
  if(path.dirname(path.resolve(testDir))!==path.resolve(os.tmpdir())||!path.basename(testDir).startsWith('tmdt-test-'))throw new Error('Unsafe test cleanup path');
  fs.rmSync(testDir,{recursive:true,force:true});
}
module.exports={setup,cleanup};
