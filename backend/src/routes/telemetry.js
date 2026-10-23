const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { isSimulationMode } = require('../lib/device-mode');
const router = express.Router();
const rateLimits = new Map();
const ipLimits = new Map();

function fail(status, code, message) {
  const error = new Error(message);
  Object.assign(error, { status, code });
  throw error;
}
function validatePayload(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'BAD_REQUEST', 'Bản tin phải là đối tượng JSON');
  const { device_id, message_id, measured_at, level_cm, quality } = body;
  if (typeof device_id !== 'string' || device_id.length > 128 || !device_id.trim()) fail(400, 'BAD_REQUEST', 'Định danh thiết bị không hợp lệ');
  if (typeof message_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message_id)) fail(400, 'BAD_REQUEST', 'message_id phải là UUID');
  const measuredTime = typeof measured_at === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(measured_at) ? Date.parse(measured_at) : NaN;
  if (!Number.isFinite(measuredTime) || measuredTime - now > 60000) fail(400, 'BAD_REQUEST', 'Thời gian đo không hợp lệ hoặc vượt quá 60 giây tương lai');
  if (!['ok', 'sensor_error'].includes(quality)) fail(400, 'BAD_REQUEST', 'Chất lượng cảm biến không hợp lệ');
  if (quality === 'ok' && (typeof level_cm !== 'number' || !Number.isFinite(level_cm) || level_cm < 0 || level_cm > 90)) fail(400, 'BAD_REQUEST', 'Mực nước phải là số từ 0 đến 90 cm');
  if (quality === 'sensor_error' && level_cm !== null) fail(400, 'BAD_REQUEST', 'Lỗi cảm biến yêu cầu mực nước null');
  return { device_id, message_id, measured_at: new Date(measuredTime).toISOString(), measuredTime, level_cm, quality };
}
function applyRateLimit(deviceId, now) {
  const limit = Number(process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE) || 60;
  let entry = rateLimits.get(deviceId);
  if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + 60000 };
  entry.count++;
  rateLimits.set(deviceId, entry);
  if (rateLimits.size > 1000) for (const [id, value] of rateLimits) if (value.resetAt <= now) rateLimits.delete(id);
  if (entry.count > limit) fail(429, 'TOO_MANY_REQUESTS', `Vượt quá hạn mức ${limit} bản tin/phút/thiết bị`);
}
function applyIpLimit(ip, now) {
  let entry = ipLimits.get(ip);
  if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + 60000 };
  entry.count++;
  ipLimits.set(ip, entry);
  if (ipLimits.size > 1000) for (const [address, value] of ipLimits) if (value.resetAt <= now) ipLimits.delete(address);
  if (entry.count > (Number(process.env.TELEMETRY_IP_RATE_LIMIT_PER_MINUTE) || 300)) fail(429, 'TOO_MANY_REQUESTS', 'Vượt hạn mức gửi từ địa chỉ mạng');
}
function parseTime(value) {
  if (!value) return NaN;
  return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
}

// Both the independent simulator and explicit manager demo controls use this transaction.
async function ingestReading(body, now = Date.now()) {
  const sample = validatePayload(body, now);
  const { device_id, message_id, measured_at, measuredTime, level_cm, quality } = sample;
  applyRateLimit(device_id, now);
  const received_at = new Date(now).toISOString();
  const client = await db.pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN IMMEDIATE'); transaction = true;
    const state = (await client.query('SELECT * FROM devices WHERE id = $1', [device_id])).rows[0];
    if (!state || !state.is_active) fail(401, 'UNAUTHORIZED', 'Thiết bị không hoạt động');
    const existing = (await client.query('SELECT * FROM readings WHERE device_id = $1 AND message_id = $2', [device_id, message_id])).rows[0];
    if (existing) {
      const identical = parseTime(existing.measured_at) === measuredTime && existing.quality === quality && (existing.level_cm === null ? level_cm === null : existing.level_cm === level_cm);
      if (!identical) fail(409, 'MESSAGE_ID_CONFLICT', 'message_id đã được sử dụng cho bản tin khác');
      await client.query('COMMIT'); transaction = false;
      return { duplicate: true, id: existing.id, received_at: existing.received_at, history_only: Boolean(existing.history_only) };
    }
    const history_only = measuredTime <= parseTime(state.latest_measured_at) || now - measuredTime > (Number(process.env.READING_FRESHNESS_MS) || 15000) || measuredTime - now > 5000;
    const readingId = crypto.randomUUID();
    await client.query(`INSERT INTO readings (id, device_id, message_id, measured_at, received_at, level_cm, quality, history_only) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [readingId, device_id, message_id, measured_at, received_at, level_cm, quality, history_only ? 1 : 0]);
    if (history_only) {
      await client.query('UPDATE devices SET last_seen = $1 WHERE id = $2', [received_at, device_id]);
    } else {
      const rule = (await client.query('SELECT * FROM alert_rules WHERE device_id = $1', [device_id])).rows[0];
      if (!rule) fail(409, 'RULE_REQUIRED', 'Điểm đo chưa có cấu hình cảnh báo');
      let { warning_count = 0, critical_count = 0, clear_count = 0, current_alert_level = 'normal', active_episode_id } = state;
      if (quality === 'sensor_error' || measuredTime - parseTime(state.latest_measured_at) > 30000 || now - parseTime(state.last_seen) > 30000) warning_count = critical_count = clear_count = 0;
      if (quality === 'ok') {
        warning_count = level_cm >= rule.warning_cm ? Math.min(warning_count + 1, rule.sample_count) : 0;
        critical_count = level_cm >= rule.critical_cm ? Math.min(critical_count + 1, rule.sample_count) : 0;
        clear_count = level_cm < rule.clear_cm ? Math.min(clear_count + 1, rule.sample_count) : 0;
        if (isSimulationMode()) {
          // Virtual lots notify immediately on a real fresh red sample. Yellow
          // is a visual state; physical confirmation and hysteresis remain below.
          const nextLevel = level_cm >= rule.critical_cm ? 'critical' : level_cm >= rule.warning_cm ? 'warning' : 'normal';
          if (nextLevel === 'critical') {
            const open = active_episode_id ? (await client.query("SELECT id FROM alerts WHERE episode_id=$1 AND device_id=$2 AND level='critical' AND resolved_at IS NULL", [active_episode_id, device_id])).rows[0] : null;
            if (!open) {
              if (active_episode_id) await client.query('UPDATE alerts SET resolved_at=$1 WHERE episode_id=$2 AND resolved_at IS NULL', [received_at, active_episode_id]);
              active_episode_id = crypto.randomUUID();
              await client.query("INSERT INTO incidents (id,episode_id,site_id,device_id,title,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'new',$6,$6)", [crypto.randomUUID(), active_episode_id, state.site_id, device_id, `Cảnh báo mực nước: ${state.name}`, received_at]);
              await client.query("INSERT INTO alerts (id,episode_id,device_id,level,opened_at,trigger_reading_id,rule_version) VALUES ($1,$2,$3,'critical',$4,$5,$6)", [crypto.randomUUID(), active_episode_id, device_id, received_at, readingId, rule.version]);
            }
          } else {
            if (active_episode_id) await client.query('UPDATE alerts SET resolved_at=$1 WHERE episode_id=$2 AND resolved_at IS NULL', [received_at, active_episode_id]);
            active_episode_id = null;
          }
          current_alert_level = nextLevel;
        } else {
          let nextLevel = current_alert_level;
          if (current_alert_level !== 'normal' && clear_count >= rule.sample_count) nextLevel = 'normal';
          else if (current_alert_level !== 'critical' && critical_count >= rule.sample_count) nextLevel = 'critical';
          else if (current_alert_level === 'normal' && warning_count >= rule.sample_count) nextLevel = 'warning';
          const confirmedWithoutEpisode = !active_episode_id && ((nextLevel === 'critical' && critical_count >= rule.sample_count) || (nextLevel === 'warning' && warning_count >= rule.sample_count));
          if (nextLevel !== current_alert_level || confirmedWithoutEpisode) {
            if (nextLevel === 'normal') {
              await client.query('UPDATE alerts SET resolved_at = $1 WHERE episode_id = $2 AND resolved_at IS NULL', [received_at, active_episode_id]);
              active_episode_id = null;
            } else {
              if (current_alert_level === 'normal' || !active_episode_id) {
                active_episode_id = crypto.randomUUID();
                await client.query("INSERT INTO incidents (id, episode_id, site_id, device_id, title, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'new',$6,$6)", [crypto.randomUUID(), active_episode_id, state.site_id, device_id, `Cảnh báo mực nước: ${state.name}`, received_at]);
              }
              await client.query('INSERT INTO alerts (id, episode_id, device_id, level, opened_at, trigger_reading_id, rule_version) VALUES ($1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(), active_episode_id, device_id, nextLevel, received_at, readingId, rule.version]);
            }
            current_alert_level = nextLevel;
          }
        }
      }
      await client.query(`UPDATE devices SET last_seen=$1,last_fresh_received_at=$2,latest_measured_at=$3,latest_quality=$4,latest_level_cm=$5,warning_count=$6,critical_count=$7,clear_count=$8,current_alert_level=$9,active_episode_id=$10 WHERE id=$11`, [received_at, quality === 'ok' ? received_at : state.last_fresh_received_at, measured_at, quality, level_cm, warning_count, critical_count, clear_count, current_alert_level, active_episode_id, device_id]);
    }
    await client.query('COMMIT'); transaction = false;
    return { id: readingId, received_at, history_only };
  } catch (error) {
    if (transaction) try { await client.query('ROLLBACK'); } catch (_) { /* Preserve original error. */ }
    throw error;
  } finally { client.release(); }
}

router.post('/', async (req, res, next) => {
  const now = Date.now();
  try {
    applyIpLimit(req.ip, now);
    const key = req.header('X-Device-Key');
    if (!key || typeof key !== 'string' || key.length > 256) fail(401, 'UNAUTHORIZED', 'Thiếu hoặc sai khóa thiết bị');
    const deviceId = req.body && req.body.device_id;
    if (typeof deviceId !== 'string') fail(400, 'BAD_REQUEST', 'Thiếu định danh thiết bị');
    const matches = async d => d && d.is_active && typeof d.key_hash === 'string' && d.key_hash.startsWith('$2') && await bcrypt.compare(key, d.key_hash);
    const separator = key.indexOf('.');
    if (separator > 0) {
      const credentialDevice = (await db.query('SELECT id,key_hash,is_active FROM devices WHERE id=$1', [key.slice(0, separator)])).rows[0];
      if (!await matches(credentialDevice)) fail(401, 'UNAUTHORIZED', 'Thiếu hoặc sai khóa thiết bị');
      if (credentialDevice.id !== deviceId) fail(403, 'DEVICE_MISMATCH', 'Khóa không thuộc thiết bị được khai báo');
    } else {
      const target = (await db.query('SELECT id,key_hash,is_active FROM devices WHERE id=$1', [deviceId])).rows[0];
      if (!await matches(target)) {
        // Compatibility for the three legacy demo credentials; new credentials carry an ID.
        const legacyIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
        const devices = (await db.query('SELECT id,key_hash,is_active FROM devices WHERE id IN ($1,$2,$3) AND id<>$4', [...legacyIds, deviceId])).rows;
        for (const other of devices) if (await matches(other)) fail(403, 'DEVICE_MISMATCH', 'Khóa không thuộc thiết bị được khai báo');
        fail(401, 'UNAUTHORIZED', 'Thiếu hoặc sai khóa thiết bị');
      }
    }
    const result = await ingestReading(req.body, now);
    if (!result.duplicate) req.app.locals.sseEmitter?.emit('update');
    res.status(result.duplicate ? 200 : 201).json({ data: result.duplicate ? { ...result, status: 'duplicate' } : result });
  } catch (error) {
    if (!error.status) return next(error);
    if (error.status === 429) res.set('Retry-After', '60');
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
});
router.ingestReading = ingestReading;
module.exports = router;
