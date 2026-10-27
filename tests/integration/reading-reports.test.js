const request = require('supertest');
const crypto = require('crypto');
const { setup, cleanup } = require('../helpers/fixture');

let ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(cleanup);

function parseCSV(text) {
  const rows = [], row = [];
  let value = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(value); rows.push([...row]); row.length = 0; value = '';
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push([...row]); }
  const headers = rows.shift() || [];
  return { headers, rows: rows.map(values => Object.fromEntries(headers.map((header, i) => [header, values[i]]))) };
}
async function newDevice(name = 'Bãi báo cáo') {
  const response = await ctx.manager.post(`/api/devices/site/${ctx.siteId}`).send({ name, point_label: 'Khu A', warning_cm: 5, critical_cm: 10, clear_cm: 3, sample_count: 3 });
  expect(response.status).toBe(201);
  return response.body.data;
}
async function send(device, level, measuredAt = new Date().toISOString(), quality = 'ok', messageId = crypto.randomUUID()) {
  return request(ctx.app).post('/api/telemetry').set('X-Device-Key', device.key).send({ device_id: device.id, message_id: messageId, measured_at: measuredAt, level_cm: level, quality });
}
async function csv(device, query = '') {
  const response = await ctx.manager.get(`/api/reports/site/${ctx.siteId}/device/${device.id}/csv${query}`);
  expect(response.status).toBe(200);
  return { response, ...parseCSV(response.text) };
}

test('CSV shows the complete OK → warning → danger → warning → OK cycle instead of sensor quality', async () => {
  const device = await newDevice();
  const now = Date.now() - 50;
  for (const [index, level] of [0, 5, 10, 7, 2].entries()) {
    expect((await send(device, level, new Date(now + index * 5).toISOString())).status).toBe(201);
  }
  const { response, rows } = await csv(device);
  expect(rows.map(row => row['Trạng thái mực nước'])).toEqual(['OK', 'Cảnh báo', 'Nguy hiểm', 'Cảnh báo', 'OK']);
  expect(rows.map(row => row['Chất lượng số đo'])).toEqual(Array(5).fill('Hợp lệ'));
  expect(rows.map(row => row['Mực nước (cm)'])).toEqual(['0', '5', '10', '7', '2']);
  expect(response.text.startsWith('\uFEFF')).toBe(true);
  expect(response.text).toContain('\r\n');
});

test('ingestion stores threshold snapshots and later target changes cannot rewrite their classification', async () => {
  const device = await newDevice();
  const messageId = crypto.randomUUID(), measuredAt = new Date(Date.now() - 20).toISOString();
  expect((await send(device, 11, measuredAt, 'ok', messageId)).status).toBe(201);
  expect((await ctx.manager.post(`/api/devices/${device.id}/override`).send({ override_level: 40, expected_version: 1 })).status).toBe(200);
  expect((await send(device, 11)).status).toBe(201);
  expect((await send(device, 11, measuredAt, 'ok', messageId)).status).toBe(200);
  const stored = (await ctx.db.query('SELECT warning_cm_snapshot,critical_cm_snapshot,rule_version_snapshot FROM readings WHERE device_id=$1 ORDER BY rowid', [device.id])).rows;
  expect(stored).toEqual([
    { warning_cm_snapshot: 5, critical_cm_snapshot: 10, rule_version_snapshot: 1 },
    { warning_cm_snapshot: 20, critical_cm_snapshot: 40, rule_version_snapshot: 2 }
  ]);
  const { rows } = await csv(device);
  expect(rows.map(row => row['Trạng thái mực nước'])).toEqual(['Nguy hiểm', 'OK']);
  expect(rows.map(row => row['Ngưỡng nguy hiểm (cm)'])).toEqual(['10', '40']);
});

test('sensor errors remain unknown while late samples identify snapshots as received-time thresholds', async () => {
  const device = await newDevice();
  expect((await send(device, null, new Date().toISOString(), 'sensor_error')).status).toBe(201);
  expect((await send(device, 12, new Date(Date.now() - 60000).toISOString())).status).toBe(201);
  const { rows } = await csv(device);
  const error = rows.find(row => row['Chất lượng số đo'] === 'Lỗi cảm biến');
  expect(error['Trạng thái mực nước']).toBe('Không xác định');
  expect(error['Mực nước (cm)']).toBe('');
  const late = rows.find(row => row['Chỉ lưu lịch sử'] === 'Có');
  expect(late['Trạng thái mực nước']).toBe('Nguy hiểm');
  expect(late['Nguồn ngưỡng']).toContain('nhận');
  expect(late['Ghi chú']).toContain('lúc đo');
  const stored = (await ctx.db.query('SELECT warning_cm_snapshot,critical_cm_snapshot FROM readings WHERE device_id=$1 AND history_only=1', [device.id])).rows[0];
  expect(stored).toEqual({ warning_cm_snapshot: 5, critical_cm_snapshot: 10 });
});

test('legacy readings use clearly labelled current thresholds and show readable UTC+7 plus original UTC', async () => {
  const device = await newDevice();
  await ctx.db.query('INSERT INTO readings(device_id,message_id,measured_at,received_at,level_cm,quality) VALUES($1,$2,$3,$4,7,$5)', [device.id, crypto.randomUUID(), '2026-10-27T07:00:00.123Z', '2026-10-27T07:00:03.456Z', 'ok']);
  const { rows } = await csv(device, '?from=2026-10-26T00:00:00Z&to=2026-10-28T00:00:00Z');
  expect(rows[0]['Thời gian đo (UTC+07:00)']).toBe('2026-10-27 14:00:00.123');
  expect(rows[0]['Thời gian nhận (UTC+07:00)']).toBe('2026-10-27 14:00:03.456');
  expect(rows[0]['Thời gian đo (UTC)']).toBe('2026-10-27T07:00:00.123Z');
  expect(rows[0]['Trạng thái mực nước']).toBe('Cảnh báo');
  expect(rows[0]['Nguồn ngưỡng']).toContain('hiện tại');
  expect(rows[0]['Ghi chú']).toContain('không xác nhận ngưỡng lịch sử');
});

test('CSV preserves quoted text and neutralizes spreadsheet formulas in device metadata', async () => {
  const device = await newDevice('=SUM(1,2) "Bãi"');
  expect((await send(device, 1)).status).toBe(201);
  const { rows } = await csv(device);
  expect(rows[0]['Tên bãi']).toBe('\'=SUM(1,2) "Bãi"');
  expect(rows[0]['Vị trí']).toBe('Khu A');
});

test('CSV exports more than 1000 rows in measured-time order, applies the requested range and defaults to a fixed current cutoff', async () => {
  const device = await newDevice();
  const start = new Date(Date.now() - 2000000).toISOString();
  await ctx.db.query(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<1004)
    INSERT INTO readings(device_id,message_id,measured_at,received_at,level_cm,quality)
    SELECT $1,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ',$2,'+'||n||' seconds'),strftime('%Y-%m-%dT%H:%M:%fZ',$2,'+'||n||' seconds'),n%15,'ok' FROM seq`, [device.id, start]);
  await ctx.db.query('INSERT INTO readings(device_id,message_id,measured_at,received_at,level_cm,quality) VALUES($1,$2,$3,$3,2,$4)', [device.id, crypto.randomUUID(), new Date(Date.now() + 3600000).toISOString(), 'ok']);
  const all = await csv(device);
  expect(all.rows).toHaveLength(1005);
  const times = all.rows.map(row => Date.parse(row['Thời gian đo (UTC)']));
  expect(times).toEqual([...times].sort((a, b) => a - b));
  const from = new Date(Date.parse(start) + 100000).toISOString(), until = new Date(Date.parse(start) + 102000).toISOString();
  const filtered = await csv(device, '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(until));
  expect(filtered.rows).toHaveLength(3);
  expect(all.response.headers['x-exported-at']).toBeTruthy();
});

test('CSV access is bounded to the actual site and invalid date ranges are rejected', async () => {
  const device = await newDevice();
  expect((await ctx.otherManager.get(`/api/reports/site/${ctx.siteId}/device/${device.id}/csv`)).status).toBe(403);
  expect((await ctx.manager.get(`/api/reports/site/${ctx.siteId}/device/${ctx.otherDeviceId}/csv`)).status).toBe(404);
  for (const query of ['?from=not-a-date', '?from=2026-10-28&to=2026-10-27', '?to=']) {
    expect((await ctx.manager.get(`/api/reports/site/${ctx.siteId}/device/${device.id}/csv${query}`)).status).toBe(400);
  }
});

test('archived devices retain exportable history but cannot authenticate or receive a reading even if is_active is forced true', async () => {
  const device = await newDevice();
  expect((await send(device, 8)).status).toBe(201);
  await ctx.db.query('UPDATE devices SET deleted_at=$1,is_active=1 WHERE id=$2', [new Date().toISOString(), device.id]);
  expect((await send(device, 9)).status).toBe(401);
  expect((await ctx.db.query('SELECT COUNT(*) AS count FROM readings WHERE device_id=$1', [device.id])).rows[0].count).toBe(1);
  expect((await csv(device)).rows).toHaveLength(1);
});
