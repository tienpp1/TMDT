const request=require('supertest');
const {setup,cleanup}=require('../helpers/fixture');
let ctx;
beforeAll(async()=>{ctx=await setup();});
afterAll(cleanup);

test('S03 staff cannot change a device rule or administer users',async()=>{
  expect((await ctx.staff.patch(`/api/devices/${ctx.deviceId}/rule`).send({warning_cm:11,critical_cm:21,clear_cm:7,sample_count:3,expected_version:1})).status).toBe(403);
  expect((await ctx.staff.get(`/api/users/site/${ctx.siteId}`)).status).toBe(403);
});
test('S04 manager cannot disable an account belonging only to another site',async()=>{
  const res=await ctx.manager.patch(`/api/users/${ctx.otherManagerId}/site/${ctx.siteId}`).send({is_active:0});
  expect([403,404]).toContain(res.status);
  expect((await ctx.db.query('SELECT is_active FROM users WHERE id=$1',[ctx.otherManagerId])).rows[0].is_active).toBe(1);
});
test('S05 CSV export checks the actual device site',async()=>{
  const res=await ctx.manager.get(`/api/reports/site/${ctx.siteId}/device/${ctx.otherDeviceId}/csv`);
  expect([403,404]).toContain(res.status);
});
test('S06 invalid JSON is 400 and unknown API endpoint is JSON 404',async()=>{
  const malformed=await request(ctx.app).post('/api/auth/login').set('Content-Type','application/json').send('{bad');
  expect(malformed.status).toBe(400);
  expect((await request(ctx.app).get('/api/not-an-endpoint')).status).toBe(404);
});
test('S07 a cross-origin browser write is rejected before login',async()=>{
  const response=await request(ctx.app).post('/api/auth/login').set('Origin','https://attacker.invalid').send({email:'staff@test.local',password:'test-password-123'});
  expect(response.status).toBe(403);
});
test('S08 existing sessions lose API access when their account is disabled',async()=>{
  await ctx.db.query('UPDATE users SET is_active=0 WHERE id=$1',[ctx.staffId]);
  const response=await ctx.staff.get(`/api/sites/${ctx.siteId}/overview`);
  expect(response.status).toBe(401);
  await ctx.db.query('UPDATE users SET is_active=1 WHERE id=$1',[ctx.staffId]);
  await ctx.staff.post('/api/auth/login').send({email:'staff@test.local',password:'test-password-123'});
});
test('S09 SQL injection cannot log in and non-string credentials return 400',async()=>{
  const response=await request(ctx.app).post('/api/auth/login').send({email:"' OR 1=1 --",password:'anything'});
  expect(response.status).toBe(401);
  expect((await request(ctx.app).post('/api/auth/login').send({email:{invalid:true},password:42})).status).toBe(400);
});
test('S10 incident creation cannot attach a foreign device',async()=>{
  const response=await ctx.staff.post(`/api/incidents/site/${ctx.siteId}/report`).send({title:'Incident',device_id:ctx.otherDeviceId});
  expect([403,404]).toContain(response.status);
});
test('S11 invalid role and boolean do not corrupt staff records',async()=>{
  expect((await ctx.manager.patch(`/api/users/${ctx.staffId}/site/${ctx.siteId}`).send({role:'administrator'})).status).toBe(400);
  expect((await ctx.manager.patch(`/api/users/${ctx.staffId}/site/${ctx.siteId}`).send({is_active:'false'})).status).toBe(400);
});
test('S12 last active manager cannot be disabled',async()=>{
  expect((await ctx.manager.patch(`/api/users/${ctx.managerId}/site/${ctx.siteId}`).send({is_active:0})).status).toBe(403);
});
test('S13 repeated failed logins are rate limited',async()=>{
  let status;
  for(let i=0;i<11;i++){
    status=(await request(ctx.app).post('/api/auth/login').send({email:'bruteforce@test.local',password:'incorrect'})).status;
  }
  expect(status).toBe(429);
});
test('S14 disabling a global account preserves the last manager in every affected site',async()=>{
  await ctx.db.query("UPDATE site_users SET role='manager' WHERE site_id=$1 AND user_id=$2",[ctx.siteId,ctx.staffId]);
  await ctx.db.query("UPDATE site_users SET role='staff' WHERE site_id=$1 AND user_id=$2",[ctx.otherSiteId,ctx.otherManagerId]);
  await ctx.db.query("INSERT INTO site_users(site_id,user_id,role) VALUES($1,$2,'manager')",[ctx.otherSiteId,ctx.managerId]);
  const response=await ctx.manager.patch(`/api/users/${ctx.managerId}/site/${ctx.siteId}`).send({is_active:0});
  expect(response.status).toBe(403);
  expect((await ctx.db.query('SELECT is_active FROM users WHERE id=$1',[ctx.managerId])).rows[0].is_active).toBe(1);
});
test('S15 legacy audit responses redact credential fields',async()=>{
  await ctx.db.query("INSERT INTO audit_logs(site_id,actor_user_id,action,entity_type,entity_id,old_values) VALUES($1,$2,'LEGACY','devices',$3,$4)",[ctx.siteId,ctx.managerId,ctx.deviceId,JSON.stringify({name:'Old',key_hash:'must-not-leak',nested:{password:'also-secret'}})]);
  const res=await ctx.manager.get(`/api/audit/site/${ctx.siteId}`);
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).not.toContain('must-not-leak');
  expect(JSON.stringify(res.body)).not.toContain('also-secret');
});
test('S16 JSON larger than 16KB is rejected before authentication or storage',async()=>{
  const response=await request(ctx.app).post('/api/auth/login').send({email:'x'.repeat(17000),password:'test-password-123'});
  expect(response.status).toBe(413);
  expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
});
test('S17 HTML sends an origin referrer to map tiles without exposing cross-origin paths',async()=>{
  const response=await request(ctx.app).get('/');
  expect(response.status).toBe(200);
  expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
});
