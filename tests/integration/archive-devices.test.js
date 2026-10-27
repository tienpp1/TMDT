const crypto = require('crypto');
const request = require('supertest');
const { setup, cleanup } = require('../helpers/fixture');

describe('Removing a bay preserves history and prevents further operation', () => {
  let ctx, measured;
  const state = async () => (await ctx.db.query('SELECT * FROM devices WHERE id=$1', [ctx.deviceId])).rows[0];
  const count = async table => (await ctx.db.query(`SELECT COUNT(*) count FROM ${table} WHERE device_id=$1`, [ctx.deviceId])).rows[0].count;
  const reading = level => require('../../backend/src/routes/telemetry').ingestReading({ device_id: ctx.deviceId, message_id: crypto.randomUUID(), measured_at: new Date(measured++).toISOString(), level_cm: level, quality: 'ok' });
  const rain = () => ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-rain-step`).send({ events: [{ lat: 0, lng: 0, radius_m: 3000, intensity: 30 }] });
  beforeAll(async () => { ctx = await setup(); });
  afterAll(cleanup);
  beforeEach(async () => {
    process.env.DEVICE_MODE = 'simulation'; measured = Date.now() - 500;
    for (const table of ['alerts', 'incident_notes', 'incidents', 'readings', 'audit_logs']) await ctx.db.query(`DELETE FROM ${table}`);
    await ctx.db.query("UPDATE devices SET deleted_at=NULL,is_active=1,lat=0,lng=0,risk_level=1,latest_level_cm=NULL,latest_quality=NULL,latest_measured_at=NULL,last_seen=NULL,last_fresh_received_at=NULL,current_alert_level='normal',active_episode_id=NULL,warning_count=0,critical_count=0,clear_count=0 WHERE id=$1", [ctx.deviceId]);
  });

  test('only a manager of the owning site can remove a bay', async () => {
    expect((await ctx.staff.post(`/api/devices/${ctx.deviceId}/archive`).send({})).status).toBe(403);
    expect((await ctx.otherManager.post(`/api/devices/${ctx.deviceId}/archive`).send({})).status).toBe(403);
    expect((await request(ctx.app).post(`/api/devices/${ctx.deviceId}/archive`).send({})).status).toBe(401);
    expect((await state()).deleted_at).toBeNull();
  });

  test('removing an active red bay closes the alarm, preserves all history and hides operational lists', async () => {
    await reading(25);
    const before = await state(), readings = await count('readings'), incidents = await count('incidents');
    const result = await ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({});
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ id: ctx.deviceId, is_active: 0 });
    expect(result.body.data.deleted_at).toBeTruthy();
    expect(await state()).toMatchObject({ is_active: 0, latest_level_cm: before.latest_level_cm, latest_measured_at: before.latest_measured_at, current_alert_level: 'normal', active_episode_id: null });
    expect(await count('readings')).toBe(readings);
    expect(await count('incidents')).toBe(incidents);
    expect((await ctx.db.query('SELECT resolved_at FROM alerts WHERE device_id=$1', [ctx.deviceId])).rows[0].resolved_at).toBeTruthy();
    expect((await ctx.manager.get(`/api/devices/site/${ctx.siteId}`)).body.data).toEqual([]);
    expect((await ctx.manager.get(`/api/sites/${ctx.siteId}/overview`)).body.data.devices).toEqual([]);
    expect((await ctx.manager.get(`/api/devices/site/${ctx.siteId}/history-stats`)).body.data).toEqual([]);
    const alerts = (await ctx.manager.get(`/api/alerts/site/${ctx.siteId}`)).body.data;
    expect(alerts).toHaveLength(1); expect(alerts[0].is_current).toBe(false);
    expect((await ctx.manager.get(`/api/incidents/site/${ctx.siteId}`)).body.data).toHaveLength(1);
    const history = await ctx.staff.get(`/api/devices/${ctx.deviceId}/readings`);
    expect(history.status).toBe(200); expect(history.body.data).toHaveLength(readings);
    expect((await ctx.staff.get(`/api/reports/site/${ctx.siteId}/device/${ctx.deviceId}/csv`)).status).toBe(200);
    expect((await ctx.db.query("SELECT COUNT(*) count FROM audit_logs WHERE action='ARCHIVE_DEVICE' AND entity_id=$1", [ctx.deviceId])).rows[0].count).toBe(1);
  });

  test('a disabled bay can be removed and repeat removal does not duplicate audit', async () => {
    expect((await ctx.manager.delete(`/api/devices/${ctx.deviceId}`)).status).toBe(200);
    const first = await ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({});
    const second = await ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({});
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(second.body.data.deleted_at).toBe(first.body.data.deleted_at);
    expect((await ctx.db.query("SELECT COUNT(*) count FROM audit_logs WHERE action='ARCHIVE_DEVICE' AND entity_id=$1", [ctx.deviceId])).rows[0].count).toBe(1);
  });

  test('removed bays cannot be reactivated, edited, controlled or assigned new incidents', async () => {
    await ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({});
    for (const response of [
      await ctx.manager.put(`/api/devices/${ctx.deviceId}`).send({ is_active: 1 }),
      await ctx.manager.put(`/api/devices/${ctx.deviceId}`).send({ name: 'Restored' }),
      await ctx.manager.post(`/api/devices/${ctx.deviceId}/rotate-key`).send({}),
      await ctx.manager.post(`/api/devices/${ctx.deviceId}/override`).send({ override_level: 30, expected_version: 1 }),
      await ctx.manager.patch(`/api/devices/${ctx.deviceId}/rule`).send({ warning_cm: 10, critical_cm: 20, clear_cm: 7, sample_count: 3, expected_version: 1 }),
      await ctx.manager.delete(`/api/devices/${ctx.deviceId}`),
      await ctx.manager.post(`/api/incidents/site/${ctx.siteId}/report`).send({ device_id: ctx.deviceId, title: 'Invalid removed bay incident' })
    ]) expect(response.status).toBe(404);
    const before = await state();
    const telemetry = await request(ctx.app).post('/api/telemetry').set('X-Device-Key', ctx.deviceKey).send({ device_id: ctx.deviceId, message_id: crypto.randomUUID(), measured_at: new Date().toISOString(), level_cm: 50, quality: 'ok' });
    expect(telemetry.status).toBe(401); expect(await state()).toEqual(before);
  });

  test('removal is serialized with rain and later rain cannot add readings or move the frozen level', async () => {
    await rain();
    const responses = await Promise.all([rain(), ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({})]);
    expect(responses.map(response => response.status)).toEqual([201, 200]);
    const before = await state(), readings = await count('readings');
    const later = await rain();
    expect(later.status).toBe(201); expect(later.body.data.readings).toEqual([]);
    expect(await count('readings')).toBe(readings); expect(await state()).toEqual(before);
    expect((await ctx.manager.post(`/api/devices/site/${ctx.siteId}/demo-sample`).send({ device_id: ctx.deviceId, scenario: 'critical' })).status).toBe(404);
  });

  test('an overlapping activation request cannot bring a removed bay back to operation', async () => {
    const [removed, activated] = await Promise.all([
      ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({}),
      ctx.manager.put(`/api/devices/${ctx.deviceId}`).send({ is_active: 1 })
    ]);
    expect(removed.status).toBe(200); expect([200, 404]).toContain(activated.status);
    expect((await state()).is_active).toBe(0); expect((await state()).deleted_at).toBeTruthy();
  });

  test('an audit failure rolls back removal and keeps the current alert and history intact', async () => {
    await reading(25);
    const before = await state();
    const alertsBefore = (await ctx.db.query('SELECT * FROM alerts WHERE device_id=$1', [ctx.deviceId])).rows;
    await ctx.db.query("CREATE TRIGGER fail_archive_audit BEFORE INSERT ON audit_logs WHEN NEW.action='ARCHIVE_DEVICE' BEGIN SELECT RAISE(ABORT,'archive audit failed'); END");
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await ctx.manager.post(`/api/devices/${ctx.deviceId}/archive`).send({})).status).toBe(500);
      expect(await state()).toEqual(before);
      expect((await ctx.db.query('SELECT * FROM alerts WHERE device_id=$1', [ctx.deviceId])).rows).toEqual(alertsBefore);
      expect(await count('readings')).toBe(1);
    } finally {
      log.mockRestore();
      await ctx.db.query('DROP TRIGGER fail_archive_audit');
    }
  });
});
