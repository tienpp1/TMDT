const request=require('supertest');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const {setup,cleanup}=require('../helpers/fixture');
describe('Device provisioning, rules and demo isolation',()=>{
 let ctx;
 beforeAll(async()=>{ctx=await setup();});
 afterAll(async()=>{await cleanup();});
 test('provisioned keys are hashed, returned once and can authenticate telemetry',async()=>{
  const created=await ctx.manager.post(`/api/devices/site/${ctx.siteId}`).send({name:'New sensor'});
  expect(created.status).toBe(201); const d=created.body.data;
  const stored=(await ctx.db.query('SELECT key_hash FROM devices WHERE id=$1',[d.id])).rows[0];
  expect(await bcrypt.compare(d.key,stored.key_hash)).toBe(true);
  const ingested=await request(ctx.app).post('/api/telemetry').set('X-Device-Key',d.key).send({device_id:d.id,message_id:crypto.randomUUID(),measured_at:new Date().toISOString(),level_cm:5,quality:'ok'});
  expect(ingested.status).toBe(201);
  const list=await ctx.staff.get(`/api/devices/site/${ctx.siteId}`); expect(list.status).toBe(200);
  expect(list.text).not.toContain(stored.key_hash); expect(list.text).not.toContain(d.key);
 });
 test('staff and managers outside the site cannot control demo',async()=>{
  expect((await ctx.staff.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({scenario:'critical'})).status).toBe(403);
  expect((await ctx.otherManager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({scenario:'critical'})).status).toBe(403);
 });
 test('demo uses the same three samples and rejects another site device',async()=>{
  await ctx.db.query("UPDATE devices SET warning_count=0,critical_count=0,current_alert_level='normal',latest_measured_at=NULL WHERE id=$1",[ctx.deviceId]);
  for(let i=0;i<2;i++) expect((await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({device_id:ctx.deviceId,scenario:'critical'})).status).toBe(201);
  expect((await ctx.db.query('SELECT current_alert_level FROM devices WHERE id=$1',[ctx.deviceId])).rows[0].current_alert_level).toBe('normal');
  expect((await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({device_id:ctx.deviceId,scenario:'critical'})).status).toBe(201);
  expect((await ctx.db.query('SELECT current_alert_level FROM devices WHERE id=$1',[ctx.deviceId])).rows[0].current_alert_level).toBe('critical');
  expect((await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({device_id:ctx.otherDeviceId,scenario:'critical'})).status).toBe(403);
 });
 test('metadata endpoint cannot bypass rule versioning',async()=>{
  expect((await ctx.manager.put(`/api/devices/${ctx.deviceId}`).send({warning_cm:1})).status).toBe(400);
 });
 test('rule update requires manager, valid bounds and matching version and resets counters',async()=>{
  const rule=(await ctx.db.query('SELECT * FROM alert_rules WHERE device_id=$1',[ctx.deviceId])).rows[0];
  const body={warning_cm:11,critical_cm:21,clear_cm:7,sample_count:3,expected_version:rule.version};
  expect((await ctx.staff.patch(`/api/devices/${ctx.deviceId}/rule`).send(body)).status).toBe(403);
  expect((await ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send({...body,sample_count:1.5})).status).toBe(400);
  await ctx.db.query('UPDATE devices SET warning_count=2 WHERE id=$1',[ctx.deviceId]);
  expect((await ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send(body)).status).toBe(200);
  expect((await ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send(body)).status).toBe(409);
  expect((await ctx.db.query('SELECT warning_count FROM devices WHERE id=$1',[ctx.deviceId])).rows[0].warning_count).toBe(0);
  const audit=(await ctx.db.query("SELECT new_values FROM audit_logs WHERE action='UPDATE_RULE' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1",[ctx.deviceId])).rows[0];
  expect(JSON.parse(audit.new_values).warning_cm).toBe(11);
 });
 test('rotating a device credential revokes the old key and keeps the new key out of audit',async()=>{
  const result=await ctx.manager.post(`/api/devices/${ctx.deviceId}/rotate-key`).send({});
  expect(result.status).toBe(200);
  const body={device_id:ctx.deviceId,message_id:crypto.randomUUID(),measured_at:new Date().toISOString(),level_cm:5,quality:'ok'};
  expect((await request(ctx.app).post('/api/telemetry').set('X-Device-Key',ctx.deviceKey).send(body)).status).toBe(401);
  expect((await request(ctx.app).post('/api/telemetry').set('X-Device-Key',result.body.data.key).send(body)).status).toBe(201);
  const audit=await ctx.manager.get(`/api/audit/site/${ctx.siteId}`);
  expect(audit.text).not.toContain(result.body.data.key);
 });
 test('history statistics count valid samples in the requested time window',async()=>{
  const id=crypto.randomUUID();
  const hash=(await ctx.db.query('SELECT key_hash FROM devices WHERE id=$1',[ctx.deviceId])).rows[0].key_hash;
  await ctx.db.query('INSERT INTO devices(id,site_id,name,key_hash) VALUES($1,$2,$3,$4)',[id,ctx.siteId,'History test',hash]);
  await ctx.db.query('INSERT INTO alert_rules(device_id,warning_cm,critical_cm,clear_cm) VALUES($1,10,20,7)',[id]);
  for(const [level,quality,age] of [[10,'ok',1000],[30,'ok',500],[null,'sensor_error',100],[85,'ok',7200000]]){
   const measured=new Date(Date.now()-age).toISOString();
   await ctx.db.query('INSERT INTO readings(device_id,message_id,measured_at,received_at,level_cm,quality) VALUES($1,$2,$3,$3,$4,$5)',[id,crypto.randomUUID(),measured,level,quality]);
  }
  const result=await ctx.staff.get(`/api/devices/site/${ctx.siteId}/history-stats?hours=1`);
  const history=result.body.data.find(d=>d.id===id);
  expect(history.peak_level).toBe(30);expect(history.avg_level).toBe(20);
  expect(history.reading_count).toBe(3);expect(history.quality_count).toBe(2);expect(history.readings_limited).toBe(false);
 });
});
