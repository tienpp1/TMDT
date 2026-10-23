const request = require('supertest');
const crypto = require('crypto');
const { setup, cleanup } = require('../helpers/fixture');

describe('Telemetry lifecycle, authentication and freshness', () => {
  let ctx, time;
  const payload = (extra={}) => ({device_id:ctx.deviceId,message_id:crypto.randomUUID(),measured_at:new Date(time++).toISOString(),level_cm:5,quality:'ok',...extra});
  const send = body => request(ctx.app).post('/api/telemetry').set('X-Device-Key',ctx.deviceKey).send(body);
  const state = async () => (await ctx.db.query('SELECT * FROM devices WHERE id = $1',[ctx.deviceId])).rows[0];
  beforeAll(async()=>{ctx=await setup();});
  afterAll(async()=>{await cleanup();});
  beforeEach(async()=>{
    time=Date.now()-1000;
    for(const table of ['alerts','incident_notes','incidents','readings']) await ctx.db.query(`DELETE FROM ${table}`);
    await ctx.db.query("UPDATE devices SET latest_measured_at=NULL,latest_quality=NULL,latest_level_cm=NULL,last_seen=NULL,last_fresh_received_at=NULL,warning_count=0,critical_count=0,clear_count=0,current_alert_level='normal',active_episode_id=NULL WHERE id=$1",[ctx.deviceId]);
  });
  test('S01 missing key cannot insert readings',async()=>{
    expect((await request(ctx.app).post('/api/telemetry').send(payload())).status).toBe(401);
    expect((await ctx.db.query('SELECT COUNT(*) count FROM readings')).rows[0].count).toBe(0);
  });
  test('S02 device A key cannot write for device B',async()=>{expect((await send(payload({device_id:ctx.otherDeviceId}))).status).toBe(403);});
  test.each([
    ['timestamp',{measured_at:'invalid'}],['quality',{quality:'unknown'}],['sensor range',{level_cm:95}],['numeric type',{level_cm:'5'}],['message ID',{message_id:''}],['error payload',{quality:'sensor_error',level_cm:2}],['future timestamp',{measured_at:new Date(Date.now()+120000).toISOString()}]
  ])('S06 rejects invalid %s without refreshing online',async(_label,extra)=>{
    expect((await send(payload(extra))).status).toBe(400);
    expect((await state()).last_seen).toBeNull();
  });
  test('F01/F03 three samples trigger each transition; acknowledgement never resolves an alert',async()=>{
    for(let i=0;i<2;i++) expect((await send(payload({level_cm:12}))).status).toBe(201);
    expect((await state()).current_alert_level).toBe('normal');
    await send(payload({level_cm:12}));
    expect((await state()).current_alert_level).toBe('warning');
    const warning=(await ctx.db.query('SELECT * FROM alerts')).rows[0];
    expect((await ctx.staff.post(`/api/alerts/${warning.id}/ack`).send({})).status).toBe(200);
    expect((await ctx.db.query('SELECT resolved_at FROM alerts WHERE id=$1',[warning.id])).rows[0].resolved_at).toBeNull();
    for(let i=0;i<3;i++) await send(payload({level_cm:22}));
    const alerts=(await ctx.db.query('SELECT * FROM alerts')).rows;
    expect(alerts.map(a=>a.level).sort()).toEqual(['critical','warning']);
    expect(new Set(alerts.map(a=>a.episode_id)).size).toBe(1);
    for(let i=0;i<3;i++) await send(payload({level_cm:5}));
    expect((await state()).current_alert_level).toBe('normal');
    expect((await ctx.db.query('SELECT COUNT(*) count FROM alerts WHERE resolved_at IS NULL')).rows[0].count).toBe(0);
  });
  test('S05 retries are idempotent and conflicting payload cannot advance counters',async()=>{
    const body=payload({level_cm:12});
    expect((await send(body)).status).toBe(201);
    expect((await send(body)).body.data.status).toBe('duplicate');
    expect((await state()).warning_count).toBe(1);
    expect((await send({...body,level_cm:22})).status).toBe(409);
    expect((await ctx.db.query('SELECT COUNT(*) count FROM readings')).rows[0].count).toBe(1);
  });
  test('F05 old and uncertain future readings are history only',async()=>{
    await send(payload({level_cm:12})); const before=await state();
    for(const measured_at of [new Date(Date.now()-30000).toISOString(),new Date(Date.now()+30000).toISOString()]) {
      const result=await send(payload({level_cm:22,measured_at}));
      expect(result.status).toBe(201); expect(result.body.data.history_only).toBe(true);
    }
    expect((await state()).warning_count).toBe(1);
    expect((await state()).latest_measured_at).toBe(before.latest_measured_at);
  });
  test('F07 error samples reset counters and preserve last good freshness',async()=>{
    await send(payload({level_cm:12})); const before=await state();
    expect((await send(payload({quality:'sensor_error',level_cm:null}))).status).toBe(201);
    const after=await state();
    expect(after.warning_count).toBe(0); expect(after.latest_quality).toBe('sensor_error'); expect(after.latest_level_cm).toBeNull();
    expect(after.last_fresh_received_at).toBe(before.last_fresh_received_at);
  });
  test('a gap over 30 seconds resets the sequence',async()=>{
    await ctx.db.query('UPDATE devices SET latest_measured_at=$1,warning_count=2 WHERE id=$2',[new Date(Date.now()-40000).toISOString(),ctx.deviceId]);
    await send(payload({level_cm:12})); expect((await state()).warning_count).toBe(1); expect((await state()).current_alert_level).toBe('normal');
  });
  test('F04 overview exposes valid UTC timestamps and detects offline',async()=>{
    await send(payload()); let overview=await ctx.staff.get(`/api/sites/${ctx.siteId}/overview`);
    const d=overview.body.data.devices.find(d=>d.id===ctx.deviceId);
    expect(Number.isFinite(Date.parse(d.latest_measured_at))).toBe(true); expect(d.latest_quality).toBe('ok');
    await ctx.db.query('UPDATE devices SET last_seen=$1 WHERE id=$2',[new Date(Date.now()-31000).toISOString(),ctx.deviceId]);
    overview=await ctx.staff.get(`/api/sites/${ctx.siteId}/overview`);
    expect(overview.body.data.devices.find(d=>d.id===ctx.deviceId).data_status).toBe('offline');
  });
  test('F02 alternating readings do not form a warning sequence',async()=>{
    for (const level_cm of [9,11,9,11,9,11]) await send(payload({level_cm}));
    expect((await state()).current_alert_level).toBe('normal');
    expect((await ctx.db.query('SELECT COUNT(*) count FROM alerts')).rows[0].count).toBe(0);
  });
  test('concurrent retries produce exactly one reading and one counter increment',async()=>{
    const body=payload({level_cm:12});
    const responses=await Promise.all(Array.from({length:8},()=>send(body)));
    expect(responses.filter(r=>r.status===201)).toHaveLength(1);
    expect(responses.filter(r=>r.status===200)).toHaveLength(7);
    expect((await state()).warning_count).toBe(1);
  });
  test('S07 authenticated devices receive 60 requests per minute; invalid credentials cannot exhaust their bucket',async()=>{
    const id=crypto.randomUUID();
    const hash=(await ctx.db.query('SELECT key_hash FROM devices WHERE id=$1',[ctx.deviceId])).rows[0].key_hash;
    await ctx.db.query('INSERT INTO devices(id,site_id,name,key_hash) VALUES($1,$2,$3,$4)',[id,ctx.siteId,'Rate limit',hash]);
    await ctx.db.query('INSERT INTO alert_rules(device_id,warning_cm,critical_cm,clear_cm) VALUES($1,10,20,7)',[id]);
    for(let i=0;i<3;i++) expect((await request(ctx.app).post('/api/telemetry').set('X-Device-Key','invalid-key').send(payload({device_id:id}))).status).toBe(401);
    for(let i=0;i<60;i++) expect((await send(payload({device_id:id}))).status).toBe(201);
    expect((await send(payload({device_id:id}))).status).toBe(429);
    expect((await ctx.staff.get(`/api/sites/${ctx.siteId}/overview`)).status).toBe(200);
  },15000);
  test('backend import cannot invent a sensor heartbeat',async()=>{
    const before=await state();
    await new Promise(resolve=>setTimeout(resolve,1100));
    expect((await state()).last_seen).toBe(before.last_seen);
  });
});
