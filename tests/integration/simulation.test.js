const crypto = require('crypto');
const request = require('supertest');
const { setup, cleanup } = require('../helpers/fixture');

describe('Explicit manual targets and geographic rain simulation', () => {
  let ctx;
  const originalRateLimit = process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE;
  const override = body => ctx.manager.post(`/api/devices/${ctx.deviceId}/override`).send(body);
  const rain = (events, agent = ctx.manager, site = ctx.siteId) => agent.post(`/api/devices/site/${site}/demo-rain-step`).send({ events });
  const storm = { lat: 0, lng: 0, radius_m: 3000, intensity: 30 };
  const state = async () => (await ctx.db.query('SELECT * FROM devices WHERE id=$1', [ctx.deviceId])).rows[0];
  const rule = async () => (await ctx.db.query('SELECT * FROM alert_rules WHERE device_id=$1', [ctx.deviceId])).rows[0];
  beforeAll(async () => { process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE = '1000'; ctx = await setup(); });
  afterAll(async () => {
    await cleanup();
    if (originalRateLimit === undefined) delete process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE;
    else process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE = originalRateLimit;
  });
  beforeEach(async () => {
    for (const table of ['alerts', 'incident_notes', 'incidents', 'readings']) await ctx.db.query(`DELETE FROM ${table}`);
    await ctx.db.query("UPDATE devices SET is_active=1,lat=0,lng=0,risk_level=1,zone_radius_km=1.5,demo_override_level=NULL,last_seen=NULL,last_fresh_received_at=NULL,latest_measured_at=NULL,latest_quality=NULL,latest_level_cm=NULL,warning_count=0,critical_count=0,clear_count=0,current_alert_level='normal',active_episode_id=NULL WHERE id=$1", [ctx.deviceId]);
    await ctx.db.query('UPDATE alert_rules SET warning_cm=10,critical_cm=20,clear_cm=7,sample_count=3,version=1 WHERE device_id=$1', [ctx.deviceId]);
  });
  test('a target changes thresholds atomically, preserves the measured level, versions and audits it', async () => {
    await ctx.db.query('UPDATE devices SET latest_level_cm=4,warning_count=2 WHERE id=$1', [ctx.deviceId]);
    const response = await override({ override_level: 30, expected_version: 1 });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: ctx.deviceId, override_level: 30, warning_cm: 15, critical_cm: 30, clear_cm: 9, sample_count: 1, rule_version: 2 });
    expect((await state()).latest_level_cm).toBe(4);
    expect((await state()).warning_count).toBe(0);
    expect((await ctx.manager.get(`/api/devices/site/${ctx.siteId}`)).body.data[0].demo_override_level).toBe(30);
    expect((await ctx.manager.get(`/api/sites/${ctx.siteId}/overview`)).body.data.devices[0].demo_override_level).toBe(30);
    expect((await ctx.db.query("SELECT actor_user_id,site_id FROM audit_logs WHERE action='SET_DEMO_TARGET'")).rows).toEqual([{ actor_user_id: ctx.managerId, site_id: ctx.siteId }]);
    expect((await override({ override_level: 40, expected_version: 1 })).status).toBe(409);
    const reset = await override({ override_level: null, expected_version: 2 });
    expect(reset.body.data).toMatchObject({ override_level: null, warning_cm: 10, critical_cm: 20, clear_cm: 7, sample_count: 3, rule_version: 3 });
  });
  test.each([4, 91, '20', undefined])('invalid target %s cannot change rules', async level => {
    expect((await override({ override_level: level, expected_version: 1 })).status).toBe(400);
    expect((await rule()).version).toBe(1);
  });
  test('targets and rain require the manager of that site and reject disabled targets', async () => {
    const endpoint = `/api/devices/${ctx.deviceId}/override`;
    for (const agent of [ctx.staff, ctx.otherManager]) expect((await agent.post(endpoint).send({ override_level: 20, expected_version: 1 })).status).toBe(403);
    expect((await rain([storm], ctx.staff)).status).toBe(403);
    expect((await rain([storm], ctx.otherManager)).status).toBe(403);
    expect((await request(ctx.app).post(`/api/devices/site/${ctx.siteId}/demo-rain-step`).send({ events: [] })).status).toBe(401);
    await ctx.db.query('UPDATE devices SET is_active=0 WHERE id=$1', [ctx.deviceId]);
    expect((await override({ override_level: 20, expected_version: 1 })).status).toBe(409);
  });
  test('unknown readings outside rain stay unknown; zero coordinates are valid and affected readings enter shared ingestion', async () => {
    expect((await rain([])).body.data).toEqual({ readings: [], has_water: false, needs_samples: false });
    expect((await state()).latest_level_cm).toBeNull();
    const result = await rain([storm]);
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ has_water: true, readings: [{ device_id: ctx.deviceId, level_cm: 3.2, history_only: false }] });
    expect((await state()).latest_level_cm).toBe(3.2);
    expect((await ctx.db.query('SELECT COUNT(*) count FROM readings')).rows[0].count).toBe(1);
    expect((await ctx.db.query('SELECT latest_level_cm FROM devices WHERE id=$1', [ctx.otherDeviceId])).rows[0].latest_level_cm).toBeNull();
  });
  test('rain follows each target through the shared alert engine and keeps real device samples unchanged', async () => {
    expect((await override({ override_level: 5, expected_version: 1 })).status).toBe(200);
    await ctx.db.query('UPDATE devices SET latest_level_cm=4.9,latest_quality=$1 WHERE id=$2', ['ok', ctx.deviceId]);
    const result = await rain([storm]);
    expect(result.body.data.readings[0].level_cm).toBe(5.3);
    expect((await state()).current_alert_level).toBe('critical');
    const alert = (await ctx.db.query('SELECT * FROM alerts')).rows[0];
    expect(alert.trigger_reading_id).toBe(result.body.data.readings[0].id);
    expect(alert.rule_version).toBe(2);
    const telemetry = await request(ctx.app).post('/api/telemetry').set('X-Device-Key', ctx.deviceKey).send({ device_id: ctx.deviceId, message_id: crypto.randomUUID(), measured_at: new Date(Date.now() + 100).toISOString(), level_cm: 1, quality: 'ok' });
    expect(telemetry.status).toBe(201);
    expect((await state()).latest_level_cm).toBe(1);
    expect((await state()).current_alert_level).toBe('normal');
  });
  test('empty rain events drain known water to zero and do not create heartbeats afterwards', async () => {
    await ctx.db.query('UPDATE devices SET latest_level_cm=1,latest_quality=$1 WHERE id=$2', ['ok', ctx.deviceId]);
    const result = await rain([]);
    expect(result.body.data).toMatchObject({ has_water: false, readings: [{ level_cm: 0 }] });
    const before = (await state()).last_seen;
    expect((await rain([])).body.data.readings).toEqual([]);
    expect((await state()).last_seen).toBe(before);
  });
  test('zero-level drain samples continue until configured consecutive clear samples resolve the alert', async () => {
    await ctx.db.query('UPDATE alert_rules SET clear_cm=0.1,sample_count=3 WHERE device_id=$1', [ctx.deviceId]);
    for (let index = 0; index < 3; index++) await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({ scenario: 'critical', device_id: ctx.deviceId });
    expect((await state()).current_alert_level).toBe('critical');
    await ctx.db.query('UPDATE devices SET latest_level_cm=0.2 WHERE id=$1', [ctx.deviceId]);
    for (let index = 0; index < 3; index++) {
      const response = await rain([]);
      expect(response.body.data).toMatchObject({ has_water: false, needs_samples: index < 2, readings: [{ level_cm: 0 }] });
    }
    expect((await state()).current_alert_level).toBe('normal');
    expect((await ctx.db.query('SELECT resolved_at FROM alerts')).rows[0].resolved_at).not.toBeNull();
    expect((await rain([])).body.data).toEqual({ readings: [], has_water: false, needs_samples: false });
  });
  test('malformed outer payloads return validation errors', async () => {
    expect((await ctx.manager.post(`/api/devices/${ctx.deviceId}/override`).set('Content-Type', 'application/json').send('null')).status).toBe(400);
    expect((await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-rain-step`).set('Content-Type', 'application/json').send('null')).status).toBe(400);
  });
  test('a target waits for an in-flight rain calculation and clears its remembered peak afterwards', async () => {
    await ctx.db.query('UPDATE devices SET latest_level_cm=19.9,latest_quality=$1 WHERE id=$2', ['ok', ctx.deviceId]);
    let releaseRain, rainRead, overrideAuthorized;
    const readStarted = new Promise(resolve => { rainRead = resolve; });
    const continueRain = new Promise(resolve => { releaseRain = resolve; });
    const authorized = new Promise(resolve => { overrideAuthorized = resolve; });
    const query = ctx.db.query.bind(ctx.db);
    let paused = false;
    const querySpy = jest.spyOn(ctx.db, 'query').mockImplementation(async (sql, params) => {
      const result = await query(sql, params);
      if (sql.includes('FROM devices d JOIN alert_rules') && !paused) {
        paused = true; rainRead(); await continueRain;
      } else if (paused && sql.startsWith('SELECT su.role')) overrideAuthorized();
      return result;
    });
    const connectSpy = jest.spyOn(ctx.db.pool, 'connect');
    const raining = rain([storm]).then(result => result);
    let saving;
    try {
      await readStarted;
      saving = override({ override_level: 30, expected_version: 1 }).then(result => result);
      await authorized;
      // Advance past the guard's promise continuation, without waiting on wall time.
      await new Promise(setImmediate);
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      releaseRain();
      await Promise.all([raining, saving]);
      querySpy.mockRestore(); connectSpy.mockRestore();
    }
    expect((await state()).latest_level_cm).toBe(21.3);
    expect((await rule()).critical_cm).toBe(30);
    expect((await rain([])).body.data.readings[0].level_cm).toBe(18.3);
  });
  test.each([[13.7, 15, 15.1, 13.6], [19.9, 30, 21.3, 18.3]])('rule changes wait for the in-flight model at %f cm and reset its peak', async (initial, target, afterRain, afterDrain) => {
    await ctx.db.query('UPDATE devices SET latest_level_cm=$1,latest_quality=$2 WHERE id=$3', [initial, 'ok', ctx.deviceId]);
    let releaseRain, rainRead, ruleAuthorized;
    const readStarted = new Promise(resolve => { rainRead = resolve; });
    const continueRain = new Promise(resolve => { releaseRain = resolve; });
    const authorized = new Promise(resolve => { ruleAuthorized = resolve; });
    const query = ctx.db.query.bind(ctx.db);
    let paused = false;
    const querySpy = jest.spyOn(ctx.db, 'query').mockImplementation(async (sql, params) => {
      const result = await query(sql, params);
      if (sql.includes('FROM devices d JOIN alert_rules') && !paused) {
        paused = true; rainRead(); await continueRain;
      } else if (paused && sql.startsWith('SELECT su.role')) ruleAuthorized();
      return result;
    });
    const connectSpy = jest.spyOn(ctx.db.pool, 'connect');
    const raining = rain([storm]).then(result => result);
    let saving;
    try {
      await readStarted;
      saving = ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send({ warning_cm: target / 2, critical_cm: target, clear_cm: target * 0.3, sample_count: 1, expected_version: 1 }).then(result => result);
      await authorized;
      await new Promise(setImmediate);
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      releaseRain();
      await Promise.all([raining, saving]);
      querySpy.mockRestore(); connectSpy.mockRestore();
    }
    expect((await state()).latest_level_cm).toBe(afterRain);
    expect((await state()).current_alert_level).toBe('normal');
    expect((await rule()).version).toBe(2);
    expect((await rain([])).body.data.readings[0].level_cm).toBe(afterDrain);
  });
  test('tiny valid admin thresholds retain fractional drain progress and eventually clear', async () => {
    await ctx.db.query('UPDATE alert_rules SET warning_cm=0.1,critical_cm=0.2,clear_cm=0.03,sample_count=3 WHERE device_id=$1', [ctx.deviceId]);
    await ctx.db.query('UPDATE devices SET risk_level=5 WHERE id=$1', [ctx.deviceId]);
    for (let index = 0; index < 3; index++) await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({ scenario: 'critical', device_id: ctx.deviceId });
    let result, steps = 0;
    do {
      const response = await rain([]);
      expect(response.status).toBe(201);
      result = response.body.data;
      steps++;
    } while ((result.has_water || result.needs_samples) && steps < 55);
    expect(steps).toBeLessThan(55);
    expect((await state()).latest_level_cm).toBe(0);
    expect((await state()).current_alert_level).toBe('normal');
    expect(result).toMatchObject({ has_water: false, needs_samples: false });
  });
  test.each(['timestamp', 'rule version'])('fractional carry resets after an external %s change', async change => {
    await ctx.db.query('UPDATE alert_rules SET warning_cm=0.1,critical_cm=0.2,clear_cm=0.03,sample_count=3 WHERE device_id=$1', [ctx.deviceId]);
    await ctx.db.query("UPDATE devices SET risk_level=5,latest_level_cm=0.2,latest_quality='ok',current_alert_level='critical' WHERE id=$1", [ctx.deviceId]);
    for (let index = 0; index < 16; index++) expect((await rain([])).body.data.readings[0].level_cm).toBe(0.2);
    if (change === 'timestamp') await ctx.db.query('UPDATE devices SET latest_measured_at=$1 WHERE id=$2', [new Date(Date.now() + 100).toISOString(), ctx.deviceId]);
    else await ctx.db.query('UPDATE alert_rules SET version=version+1 WHERE device_id=$1', [ctx.deviceId]);
    expect((await rain([])).body.data.readings[0].level_cm).toBe(0.2);
  });
  test.each([
    null, {}, Array(21).fill(storm), [{ ...storm, lat: 91 }], [{ ...storm, lng: -181 }], [{ ...storm, intensity: 10 }], [{ ...storm, radius_m: 0 }], [{ ...storm, lat: '0' }]
  ])('rain rejects malformed or unbounded events %#', async events => {
    expect((await rain(events)).status).toBe(400);
    expect((await state()).last_seen).toBeNull();
  });
});
