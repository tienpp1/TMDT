const crypto = require('crypto');
const request = require('supertest');
const { setup, cleanup } = require('../helpers/fixture');

describe('Virtual parking lots stay available and notify only while red', () => {
  let ctx, measured;
  const originalMode = process.env.DEVICE_MODE;
  const originalRateLimit = process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE;
  const state = async () => (await ctx.db.query('SELECT * FROM devices WHERE id=$1', [ctx.deviceId])).rows[0];
  const overview = async () => (await ctx.manager.get(`/api/sites/${ctx.siteId}/overview`)).body.data;
  const sample = async (level, extra = {}) => require('../../backend/src/routes/telemetry').ingestReading({ device_id: ctx.deviceId, message_id: crypto.randomUUID(), measured_at: new Date(measured++).toISOString(), quality: 'ok', level_cm: level, ...extra });
  const rain = () => ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-rain-step`).send({ events: [{ lat: 0, lng: 0, radius_m: 3000, intensity: 30 }] });
  const count = async table => (await ctx.db.query(`SELECT COUNT(*) count FROM ${table}`)).rows[0].count;
  beforeAll(async () => { process.env.DEVICE_MODE = 'simulation'; process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE = '1000'; ctx = await setup(); });
  afterAll(async () => {
    await cleanup();
    if (originalMode === undefined) delete process.env.DEVICE_MODE; else process.env.DEVICE_MODE = originalMode;
    if (originalRateLimit === undefined) delete process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE; else process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE = originalRateLimit;
  });
  beforeEach(async () => {
    process.env.DEVICE_MODE = 'simulation'; measured = Date.now() - 1000;
    for (const table of ['alerts', 'incident_notes', 'incidents', 'readings', 'audit_logs']) await ctx.db.query(`DELETE FROM ${table}`);
    await ctx.db.query("UPDATE devices SET is_active=1,lat=0,lng=0,risk_level=1,zone_radius_km=1.5,demo_override_level=NULL,last_seen=NULL,last_fresh_received_at=NULL,latest_measured_at=NULL,latest_quality=NULL,latest_level_cm=NULL,warning_count=0,critical_count=0,clear_count=0,current_alert_level='normal',active_episode_id=NULL WHERE id=$1", [ctx.deviceId]);
    await ctx.db.query('UPDATE alert_rules SET warning_cm=10,critical_cm=20,clear_cm=7,sample_count=3,version=1 WHERE device_id=$1', [ctx.deviceId]);
  });
  test('simulation is the default and projects an enabled dry baseline without inventing readings or timestamps', async () => {
    delete process.env.DEVICE_MODE;
    const before = await state();
    const result = await overview();
    expect(result.device_mode).toBe('simulation');
    expect(result.devices[0]).toMatchObject({ device_mode: 'simulation', data_status: 'online', measurement_status: 'no_data', display_level_cm: 0, level_source: 'simulation_baseline', current_level_status: 'normal', latest_level_cm: null, latest_measured_at: null, last_seen: null });
    expect(await state()).toEqual(before);
    expect(await count('readings')).toBe(0);
    expect(await count('audit_logs')).toBe(0);
  });
  test('idle virtual lots remain online after 30 seconds while raw measurement freshness remains visible', async () => {
    const old = new Date(Date.now() - 31000).toISOString();
    await ctx.db.query("UPDATE devices SET latest_level_cm=12,latest_quality='ok',last_seen=$1,last_fresh_received_at=$1,latest_measured_at=$1 WHERE id=$2", [old, ctx.deviceId]);
    const before = await state();
    const device = (await overview()).devices[0];
    expect(device).toMatchObject({ data_status: 'online', measurement_status: 'offline', display_level_cm: 12, level_source: 'reading', current_level_status: 'warning', last_seen: old });
    expect(await state()).toEqual(before);
    process.env.DEVICE_MODE = 'telemetry';
    expect((await overview()).devices[0]).toMatchObject({ device_mode: 'telemetry', data_status: 'offline', measurement_status: 'offline' });
  });
  test('importing and idling the simulation backend never writes a virtual heartbeat', async () => {
    const before = await state();
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(await state()).toEqual(before);
    expect(await count('readings')).toBe(0);
    expect(await count('audit_logs')).toBe(0);
  });
  test('sensor errors remain unavailable measurements on an enabled online virtual lot', async () => {
    await sample(null, { quality: 'sensor_error' });
    expect((await overview()).devices[0]).toMatchObject({ data_status: 'online', measurement_status: 'sensor_error', display_level_cm: null, level_source: 'unavailable', current_level_status: 'unknown', latest_level_cm: null, latest_quality: 'sensor_error' });
  });
  test('yellow creates no alarm; the first red sample opens one episode, leaving red resolves it, and re-entry rearms', async () => {
    for (let index = 0; index < 3; index++) await sample(12);
    expect((await state()).current_alert_level).toBe('warning');
    expect(await count('alerts')).toBe(0); expect(await count('incidents')).toBe(0);
    await sample(20);
    const first = await state();
    expect(first.current_alert_level).toBe('critical'); expect(first.active_episode_id).not.toBeNull();
    expect(await count('alerts')).toBe(1); expect(await count('incidents')).toBe(1);
    await sample(21); await sample(25);
    expect((await state()).active_episode_id).toBe(first.active_episode_id);
    expect(await count('alerts')).toBe(1);
    await sample(19.9);
    expect(await state()).toMatchObject({ current_alert_level: 'warning', active_episode_id: null });
    expect((await ctx.db.query('SELECT resolved_at FROM alerts')).rows[0].resolved_at).not.toBeNull();
    await sample(20);
    expect((await state()).active_episode_id).not.toBe(first.active_episode_id);
    expect(await count('alerts')).toBe(2); expect(await count('incidents')).toBe(2);
    expect((await ctx.db.query('SELECT sample_count FROM alert_rules WHERE device_id=$1', [ctx.deviceId])).rows[0].sample_count).toBe(3);
  });
  test('switching from a virtual yellow state to physical telemetry can create its first confirmed critical episode', async () => {
    await sample(12);
    expect(await state()).toMatchObject({ current_alert_level: 'warning', active_episode_id: null });
    process.env.DEVICE_MODE = 'telemetry';
    await sample(22); await sample(22);
    expect((await ctx.db.query('SELECT level FROM alerts')).rows.some(alert => alert.level === 'critical')).toBe(false);
    await sample(22);
    expect((await state()).current_alert_level).toBe('critical');
    expect((await state()).active_episode_id).not.toBeNull();
    expect((await ctx.db.query('SELECT level FROM alerts')).rows.map(alert => alert.level).sort()).toEqual(['critical', 'warning']);
    expect(await count('incidents')).toBe(1);
  });
  test('a physical warning can acquire its missing episode after confirmation even when the visual level stays yellow', async () => {
    await sample(12);
    process.env.DEVICE_MODE = 'telemetry';
    await sample(12); await sample(12);
    expect((await state()).active_episode_id).not.toBeNull();
    expect(await count('alerts')).toBe(1);
    expect((await ctx.db.query('SELECT level FROM alerts')).rows[0].level).toBe('warning');
  });
  test.each(['rule', 'override'])('%s changes close a virtual episode when water is below the new red threshold, and lowering cannot resurrect it', async operation => {
    await sample(22);
    const before = await state(), episode = before.active_episode_id;
    const configure = (target, version) => operation === 'rule'
      ? ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send({ warning_cm: target / 2, critical_cm: target, clear_cm: target * 0.3, sample_count: 3, expected_version: version })
      : ctx.manager.post(`/api/devices/${ctx.deviceId}/override`).send({ override_level: target, expected_version: version });
    expect((await configure(30, 1)).status).toBe(200);
    expect(await state()).toMatchObject({ latest_level_cm: 22, latest_measured_at: before.latest_measured_at, last_seen: before.last_seen, current_alert_level: 'warning', active_episode_id: null });
    expect((await ctx.db.query('SELECT resolved_at FROM alerts WHERE episode_id=$1', [episode])).rows[0].resolved_at).not.toBeNull();
    expect((await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data.some(alert => alert.is_current)).toBe(false);
    expect((await configure(20, 2)).status).toBe(200);
    expect((await state()).active_episode_id).toBeNull();
    expect((await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data.some(alert => alert.is_current)).toBe(false);
    expect(await count('readings')).toBe(1);
    await sample(22);
    expect((await state()).active_episode_id).not.toBe(episode);
    expect(await count('alerts')).toBe(2);
  });
  test('raising physical thresholds preserves the active episode until measured clear confirmation', async () => {
    process.env.DEVICE_MODE = 'telemetry';
    await sample(22); await sample(22); await sample(22);
    const episode = (await state()).active_episode_id;
    expect((await ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send({ warning_cm: 15, critical_cm: 30, clear_cm: 9, sample_count: 3, expected_version: 1 })).status).toBe(200);
    expect(await state()).toMatchObject({ current_alert_level: 'critical', active_episode_id: episode });
    expect((await ctx.db.query('SELECT resolved_at FROM alerts WHERE episode_id=$1', [episode])).rows[0].resolved_at).toBeNull();
  });
  test('old critical samples stay history-only and cannot create a virtual alarm', async () => {
    expect((await sample(40, { measured_at: new Date(Date.now() - 30000).toISOString() })).history_only).toBe(true);
    expect((await state()).latest_level_cm).toBeNull(); expect(await count('alerts')).toBe(0);
  });
  test('historical orphan alerts remain readable but never count as current red notifications', async () => {
    for (const level of ['warning', 'critical']) await ctx.db.query('INSERT INTO alerts(id,episode_id,device_id,level,rule_version) VALUES($1,$2,$3,$4,1)', [crypto.randomUUID(), crypto.randomUUID(), ctx.deviceId, level]);
    let alerts = (await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data;
    expect(alerts).toHaveLength(2); expect(alerts.every(alert => alert.is_current === false)).toBe(true);
    await sample(20);
    alerts = (await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data;
    expect(alerts).toHaveLength(3); expect(alerts.filter(alert => alert.is_current)).toHaveLength(1);
    await sample(19.9);
    expect((await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data.some(alert => alert.is_current)).toBe(false);
  });
  test('an older current red alert survives the history limit after more than 100 newer historical records', async () => {
    await sample(20);
    const current = (await ctx.db.query('SELECT id FROM alerts')).rows[0].id;
    await ctx.db.query('UPDATE alerts SET opened_at=$1 WHERE id=$2', ['2000-01-01T00:00:00.000Z', current]);
    for (let index = 0; index < 101; index++) await ctx.db.query("INSERT INTO alerts(id,episode_id,device_id,level,opened_at,resolved_at,rule_version) VALUES($1,$2,$3,'critical',$4,$4,1)", [crypto.randomUUID(), crypto.randomUUID(), ctx.deviceId, new Date(Date.now() + index).toISOString()]);
    const alerts = (await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data;
    expect(alerts).toHaveLength(100);
    expect(alerts.find(alert => alert.id === current)).toMatchObject({ is_current: true });
  });
  test('disabling freezes measurements and rain, closes alarms, and reactivation awaits an actual sample', async () => {
    await sample(20);
    expect((await ctx.manager.delete(`/api/devices/${ctx.deviceId}`)).status).toBe(200);
    const frozen = await state();
    expect(frozen).toMatchObject({ is_active: 0, current_alert_level: 'normal', active_episode_id: null, warning_count: 0, critical_count: 0, clear_count: 0, latest_level_cm: 20 });
    expect((await ctx.db.query('SELECT resolved_at FROM alerts')).rows.every(alert => alert.resolved_at)).toBe(true);
    expect((await overview()).devices[0]).toMatchObject({ data_status: 'disabled', display_level_cm: null, current_level_status: 'disabled' });
    const readings = await count('readings');
    await rain();
    expect(await state()).toEqual(frozen); expect(await count('readings')).toBe(readings);
    const rejected = await request(ctx.app).post('/api/telemetry').set('X-Device-Key', ctx.deviceKey).send({ device_id: ctx.deviceId, message_id: crypto.randomUUID(), measured_at: new Date().toISOString(), level_cm: 30, quality: 'ok' });
    expect(rejected.status).toBe(401); expect(await state()).toEqual(frozen);
    await ctx.manager.put(`/api/devices/${ctx.deviceId}`).send({ is_active: 1 });
    expect(await state()).toMatchObject({ is_active: 1, last_seen: frozen.last_seen, latest_level_cm: 20, active_episode_id: null });
    expect((await overview()).devices[0].data_status).toBe('online');
    expect((await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data.some(alert => alert.is_current)).toBe(false);
    await rain();
    expect((await state()).active_episode_id).not.toBeNull(); expect(await count('alerts')).toBe(2);
  });
  test.each(['delete', 'put'])('%s disable waits for an in-flight rain step and is frozen after its response', async method => {
    await sample(13.7);
    let rainRead, releaseRain, disableAuthorized;
    const readStarted = new Promise(resolve => { rainRead = resolve; });
    const continueRain = new Promise(resolve => { releaseRain = resolve; });
    const authorized = new Promise(resolve => { disableAuthorized = resolve; });
    const query = ctx.db.query.bind(ctx.db);
    let paused = false;
    const querySpy = jest.spyOn(ctx.db, 'query').mockImplementation(async (sql, params) => {
      const result = await query(sql, params);
      if (sql.includes('FROM devices d JOIN alert_rules') && !paused) { paused = true; rainRead(); await continueRain; }
      else if (paused && sql.startsWith('SELECT su.role')) disableAuthorized();
      return result;
    });
    const connectSpy = jest.spyOn(ctx.db.pool, 'connect');
    const raining = rain().then(result => result);
    let disabling;
    try {
      await readStarted;
      disabling = ctx.manager[method](`/api/devices/${ctx.deviceId}`).send(method === 'put' ? { is_active: 0 } : {}).then(result => result);
      await authorized; await new Promise(setImmediate);
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      releaseRain(); await Promise.all([raining, disabling]); querySpy.mockRestore(); connectSpy.mockRestore();
    }
    const frozen = await state();
    expect(frozen).toMatchObject({ is_active: 0, latest_level_cm: 15.1 });
    await rain(); expect(await state()).toEqual(frozen);
  });
});
