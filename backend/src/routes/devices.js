const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireSiteMember, requireSiteManager } = require('../middleware/auth');
const { ingestReading } = require('./telemetry');
const { rainStep } = require('../lib/rain-simulation');
const { isSimulationMode } = require('../lib/device-mode');
const router = express.Router();
const DEVICE_FIELDS = 'd.id,d.site_id,d.name,d.point_label,d.is_active,d.last_seen,d.last_fresh_received_at,d.latest_measured_at,d.latest_quality,d.latest_level_cm,d.current_alert_level,d.demo_override_level,d.created_at,d.lat,d.lng,d.zone_radius_km,d.risk_level';
const RULE_FIELDS = 'r.warning_cm,r.critical_cm,r.clear_cm,r.sample_count,r.version AS rule_version';
const rainPeaks = new Map();
const rainLevels = new Map();
const rainQueues = new Map();
async function simulationQueue(site, action) {
  const previous = rainQueues.get(site) || Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  rainQueues.set(site, pending);
  try { return await pending; }
  finally { if (rainQueues.get(site) === pending) rainQueues.delete(site); }
}
function bad(message, status = 400, code = 'BAD_REQUEST') { const error = new Error(message); Object.assign(error, { status, code }); throw error; }
function respondError(error, res, next) { if (!error.status) return next(error); return res.status(error.status).json({ error: { code: error.code, message: error.message } }); }
function publish(req) { req.app.locals.sseEmitter?.emit('update'); }
async function transaction(action) {
  const client = await db.pool.connect();
  try { await client.query('BEGIN IMMEDIATE'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch (_) { /* Preserve original error. */ } throw error; }
  finally { client.release(); }
}
async function closeDisabledDevice(client, id) {
  await client.query('UPDATE alerts SET resolved_at=$1 WHERE device_id=$2 AND resolved_at IS NULL', [new Date().toISOString(), id]);
  await client.query("UPDATE devices SET warning_count=0,critical_count=0,clear_count=0,current_alert_level='normal',active_episode_id=NULL WHERE id=$1", [id]);
}
function clearSimulationState(site, id) {
  rainPeaks.get(site)?.delete(id);
  rainLevels.get(site)?.delete(id);
}
async function reconcileSimulationRule(client, id, rule) {
  if (!isSimulationMode()) return;
  const device = (await client.query('SELECT is_active,latest_quality,latest_level_cm,active_episode_id FROM devices WHERE id=$1', [id])).rows[0];
  if (!device?.is_active || device.latest_quality !== 'ok' || device.latest_level_cm === null || !Number.isFinite(Number(device.latest_level_cm)) || device.latest_level_cm >= rule.critical_cm) return;
  if (device.active_episode_id) await client.query('UPDATE alerts SET resolved_at=$1 WHERE episode_id=$2 AND resolved_at IS NULL', [new Date().toISOString(), device.active_episode_id]);
  const level = device.latest_level_cm >= rule.warning_cm ? 'warning' : 'normal';
  await client.query('UPDATE devices SET current_alert_level=$1,active_episode_id=NULL WHERE id=$2', [level, id]);
}
function validateRules(rule) {
  for (const key of ['warning_cm', 'critical_cm', 'clear_cm']) if (typeof rule[key] !== 'number' || !Number.isFinite(rule[key]) || rule[key] < 0 || rule[key] > 90) bad('Ngưỡng phải là số trong khoảng 0–90 cm');
  if (!(rule.clear_cm < rule.warning_cm && rule.warning_cm < rule.critical_cm)) bad('Ngưỡng yêu cầu clear < warning < critical');
  if (!Number.isInteger(rule.sample_count) || rule.sample_count < 1 || rule.sample_count > 60) bad('Số mẫu phải là số nguyên từ 1 đến 60');
}
function metadata(body, existing = {}) {
  const value = { ...existing };
  for (const key of ['name', 'point_label']) if (body[key] !== undefined) {
    if (typeof body[key] !== 'string' || body[key].trim().length > 200 || (key === 'name' && !body[key].trim())) bad('Tên điểm đo không hợp lệ');
    value[key] = body[key].trim();
  }
  if (!value.name) bad('Thiếu tên điểm đo');
  for (const [key, min, max] of [['lat', -90, 90], ['lng', -180, 180], ['zone_radius_km', 0.01, 100], ['risk_level', 1, 5]]) if (body[key] !== undefined) {
    if (body[key] === null && ['lat', 'lng'].includes(key)) { value[key] = null; continue; }
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max || (key === 'risk_level' && !Number.isInteger(body[key]))) bad('Thông tin vị trí hoặc mức rủi ro không hợp lệ');
    value[key] = body[key];
  }
  if (body.is_active !== undefined) {
    if (![true, false, 0, 1].includes(body.is_active)) bad('Trạng thái thiết bị không hợp lệ');
    value.is_active = body.is_active ? 1 : 0;
  }
  return value;
}
const checkDeviceMembership = async (req, res, next) => {
  try {
    const device = (await db.query('SELECT site_id FROM devices WHERE id=$1', [req.params.id])).rows[0];
    if (!device) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy điểm đo' } });
    req.params.siteId = device.site_id; next();
  } catch (error) { next(error); }
};

router.get('/site/:siteId', requireAuth, requireSiteMember, async (req, res, next) => {
  try { res.json({ data: (await db.query(`SELECT ${DEVICE_FIELDS},${RULE_FIELDS} FROM devices d LEFT JOIN alert_rules r ON r.device_id=d.id WHERE d.site_id=$1 ORDER BY d.name`, [req.params.siteId])).rows }); }
  catch (error) { next(error); }
});
router.post('/site/:siteId', requireAuth, requireSiteManager, async (req, res, next) => {
  try {
    const info = metadata(req.body, { point_label: '', lat: null, lng: null, zone_radius_km: 1.5, risk_level: 1, is_active: 1 });
    const rule = { warning_cm: req.body.warning_cm ?? 10, critical_cm: req.body.critical_cm ?? 20, clear_cm: req.body.clear_cm ?? 7, sample_count: req.body.sample_count ?? 3 };
    validateRules(rule);
    const id = crypto.randomUUID(), key = `${id}.${crypto.randomBytes(16).toString('hex')}`, hash = await bcrypt.hash(key, 10);
    await transaction(async client => {
      await client.query('INSERT INTO devices (id,site_id,name,point_label,key_hash,is_active,lat,lng,zone_radius_km,risk_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, req.params.siteId, info.name, info.point_label, hash, info.is_active, info.lat, info.lng, info.zone_radius_km, info.risk_level]);
      await client.query('INSERT INTO alert_rules (device_id,warning_cm,critical_cm,clear_cm,sample_count,version,updated_by) VALUES ($1,$2,$3,$4,$5,1,$6)', [id, rule.warning_cm, rule.critical_cm, rule.clear_cm, rule.sample_count, req.session.userId]);
      await client.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES ($1,$2,'CREATE_DEVICE','devices',$3,$4)", [req.params.siteId, req.session.userId, id, JSON.stringify({ ...info, ...rule })]);
    });
    publish(req); res.status(201).json({ data: { id, ...info, ...rule, rule_version: 1, key } });
  } catch (error) { respondError(error, res, next); }
});
router.put('/:id', requireAuth, checkDeviceMembership, requireSiteManager, async (req, res, next) => {
  try {
    if (['warning_cm', 'critical_cm', 'clear_cm', 'sample_count', 'expected_version'].some(key => req.body[key] !== undefined)) bad('Dùng API PATCH rule với expected_version để thay đổi ngưỡng');
    const info = await simulationQueue(req.params.siteId, async () => {
      const updated = await transaction(async client => {
        const current = (await client.query(`SELECT ${DEVICE_FIELDS} FROM devices d WHERE d.id=$1`, [req.params.id])).rows[0];
        const updated = metadata(req.body, current);
        await client.query('UPDATE devices SET name=$1,point_label=$2,lat=$3,lng=$4,zone_radius_km=$5,risk_level=$6,is_active=$7 WHERE id=$8', [updated.name, updated.point_label, updated.lat, updated.lng, updated.zone_radius_km, updated.risk_level, updated.is_active, req.params.id]);
        if (!updated.is_active) { await closeDisabledDevice(client, req.params.id); updated.current_alert_level = 'normal'; }
        await client.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,old_values,new_values) VALUES ($1,$2,'UPDATE_DEVICE','devices',$3,$4,$5)", [req.params.siteId, req.session.userId, req.params.id, JSON.stringify(current), JSON.stringify(updated)]);
        return updated;
      });
      if (!updated.is_active) clearSimulationState(req.params.siteId, req.params.id);
      return updated;
    });
    publish(req); res.json({ data: { ...info, success: true } });
  } catch (error) { respondError(error, res, next); }
});
router.delete('/:id', requireAuth, checkDeviceMembership, requireSiteManager, async (req, res, next) => {
  try {
    await simulationQueue(req.params.siteId, async () => {
      await transaction(async client => {
        const current = (await client.query(`SELECT ${DEVICE_FIELDS} FROM devices d WHERE d.id=$1`, [req.params.id])).rows[0];
        // Disabling preserves measurements and closes notification eligibility.
        await client.query('UPDATE devices SET is_active=0 WHERE id=$1', [req.params.id]);
        await closeDisabledDevice(client, req.params.id);
        await client.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,old_values,new_values) VALUES ($1,$2,'DISABLE_DEVICE','devices',$3,$4,$5)", [req.params.siteId, req.session.userId, req.params.id, JSON.stringify(current), JSON.stringify({ is_active: 0 })]);
      });
      clearSimulationState(req.params.siteId, req.params.id);
    });
    publish(req); res.json({ data: { success: true, is_active: 0 } });
  } catch (error) { next(error); }
});
router.patch('/:id/rule', requireAuth, checkDeviceMembership, requireSiteManager, async (req, res, next) => {
  try {
    const { warning_cm, critical_cm, clear_cm, sample_count, expected_version } = req.body;
    validateRules({ warning_cm, critical_cm, clear_cm, sample_count });
    if (!Number.isInteger(expected_version) || expected_version < 1) bad('Thiếu phiên bản cấu hình hợp lệ');
    const data = await simulationQueue(req.params.siteId, async () => {
      const updated = await transaction(async client => {
        const current = (await client.query('SELECT * FROM alert_rules WHERE device_id=$1', [req.params.id])).rows[0];
        if (!current) bad('Không tìm thấy cấu hình', 404, 'NOT_FOUND');
        if (current.version !== expected_version) bad('Cấu hình đã thay đổi. Vui lòng tải lại.', 409, 'CONFLICT');
        const updated = { warning_cm, critical_cm, clear_cm, sample_count, version: current.version + 1 };
        await client.query('UPDATE alert_rules SET warning_cm=$1,critical_cm=$2,clear_cm=$3,sample_count=$4,version=$5,updated_by=$6,updated_at=$7 WHERE device_id=$8', [warning_cm, critical_cm, clear_cm, sample_count, updated.version, req.session.userId, new Date().toISOString(), req.params.id]);
        await client.query('UPDATE devices SET warning_count=0,critical_count=0,clear_count=0 WHERE id=$1', [req.params.id]);
        await reconcileSimulationRule(client, req.params.id, updated);
        await client.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,old_values,new_values) VALUES ($1,$2,'UPDATE_RULE','alert_rules',$3,$4,$5)", [req.params.siteId, req.session.userId, req.params.id, JSON.stringify(current), JSON.stringify(updated)]);
        return updated;
      });
      rainPeaks.get(req.params.siteId)?.delete(req.params.id);
      rainLevels.get(req.params.siteId)?.delete(req.params.id);
      return updated;
    });
    publish(req); res.json({ data });
  } catch (error) { respondError(error, res, next); }
});
router.post('/:id/override', requireAuth, checkDeviceMembership, requireSiteManager, async (req, res, next) => {
  try {
    const { override_level, expected_version } = req.body;
    if (override_level !== null && (typeof override_level !== 'number' || !Number.isFinite(override_level) || override_level < 5 || override_level > 90)) bad('Mục tiêu mô phỏng phải là số từ 5 đến 90 cm hoặc null để đặt lại');
    if (!Number.isInteger(expected_version) || expected_version < 1) bad('Thiếu phiên bản cấu hình hợp lệ');
    const data = await simulationQueue(req.params.siteId, async () => {
      const updated = await transaction(async client => {
        const device = (await client.query('SELECT is_active,demo_override_level FROM devices WHERE id=$1', [req.params.id])).rows[0];
        if (!device?.is_active) bad('Điểm đo đã bị vô hiệu hóa', 409, 'DEVICE_DISABLED');
        const current = (await client.query('SELECT * FROM alert_rules WHERE device_id=$1', [req.params.id])).rows[0];
        if (!current) bad('Không tìm thấy cấu hình', 404, 'NOT_FOUND');
        if (current.version !== expected_version) bad('Cấu hình đã thay đổi. Vui lòng tải lại.', 409, 'CONFLICT');
        const rule = override_level === null ? { warning_cm: 10, critical_cm: 20, clear_cm: 7, sample_count: 3 } : { warning_cm: override_level * 0.5, critical_cm: override_level, clear_cm: override_level * 0.3, sample_count: 1 };
        validateRules(rule);
        const updated = { id: req.params.id, override_level, ...rule, rule_version: current.version + 1 };
        await client.query('UPDATE devices SET demo_override_level=$1,warning_count=0,critical_count=0,clear_count=0 WHERE id=$2', [override_level, req.params.id]);
        await client.query('UPDATE alert_rules SET warning_cm=$1,critical_cm=$2,clear_cm=$3,sample_count=$4,version=$5,updated_by=$6,updated_at=$7 WHERE device_id=$8', [rule.warning_cm, rule.critical_cm, rule.clear_cm, rule.sample_count, updated.rule_version, req.session.userId, new Date().toISOString(), req.params.id]);
        await reconcileSimulationRule(client, req.params.id, rule);
        await client.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,old_values,new_values) VALUES ($1,$2,'SET_DEMO_TARGET','devices',$3,$4,$5)", [req.params.siteId, req.session.userId, req.params.id, JSON.stringify({ override_level: device.demo_override_level, ...current }), JSON.stringify(updated)]);
        return updated;
      });
      rainPeaks.get(req.params.siteId)?.delete(req.params.id);
      rainLevels.get(req.params.siteId)?.delete(req.params.id);
      return updated;
    });
    publish(req); res.json({ data });
  } catch (error) { respondError(error, res, next); }
});
router.post('/:id/rotate-key', requireAuth, checkDeviceMembership, requireSiteManager, async (req, res, next) => {
  try {
    const key = `${req.params.id}.${crypto.randomBytes(16).toString('hex')}`;
    const hash = await bcrypt.hash(key, 10);
    await transaction(async client => {
      await client.query('UPDATE devices SET key_hash=$1 WHERE id=$2', [hash, req.params.id]);
      await client.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES ($1,$2,'ROTATE_DEVICE_KEY','devices',$3,$4)", [req.params.siteId, req.session.userId, req.params.id, JSON.stringify({ rotated: true })]);
    });
    res.json({ data: { id: req.params.id, key } });
  } catch (error) { next(error); }
});
router.get('/site/:siteId/history-stats', requireAuth, requireSiteMember, async (req, res, next) => {
  try {
    const hours = req.query.hours === undefined ? 24 : Number(req.query.hours);
    if (![1, 24, 48, 168].includes(hours)) bad('Khoảng thời gian hỗ trợ: 1, 24, 48 hoặc 168 giờ');
    const since = new Date(Date.now() - hours * 3600000).toISOString(), until = new Date().toISOString();
    const devices = (await db.query(`SELECT ${DEVICE_FIELDS},${RULE_FIELDS} FROM devices d LEFT JOIN alert_rules r ON d.id=r.device_id WHERE d.site_id=$1 ORDER BY d.name`, [req.params.siteId])).rows;
    const results = [];
    for (const device of devices) {
      const readings = (await db.query('SELECT measured_at,received_at,level_cm,quality,history_only FROM readings WHERE device_id=$1 AND julianday(measured_at)>=julianday($2) AND julianday(measured_at)<=julianday($3) ORDER BY julianday(measured_at) DESC LIMIT 2000', [device.id, since, until])).rows.reverse();
      const stats = (await db.query("SELECT MAX(CASE WHEN quality='ok' THEN level_cm END) peak_level,AVG(CASE WHEN quality='ok' THEN level_cm END) avg_level,COUNT(*) reading_count,COUNT(CASE WHEN quality='ok' THEN level_cm END) quality_count FROM readings WHERE device_id=$1 AND julianday(measured_at)>=julianday($2) AND julianday(measured_at)<=julianday($3)", [device.id, since, until])).rows[0];
      const count = (await db.query('SELECT COUNT(*) count FROM alerts WHERE device_id=$1 AND julianday(opened_at)>=julianday($2) AND julianday(opened_at)<=julianday($3)', [device.id, since, until])).rows[0].count;
      results.push({ ...device, current_level: device.latest_quality === 'ok' ? device.latest_level_cm : null, peak_level: stats.peak_level, avg_level: stats.avg_level === null ? null : Math.round(stats.avg_level * 10) / 10, quality_count: stats.quality_count, reading_count: stats.reading_count, readings_limited: stats.reading_count > readings.length, alert_count: count, readings, hours, since, until });
    }
    res.json({ data: results });
  } catch (error) { respondError(error, res, next); }
});
router.get('/:id/readings', requireAuth, checkDeviceMembership, requireSiteMember, async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) bad('Giới hạn bản ghi phải từ 1 đến 2000');
    const since = req.query.since ? new Date(req.query.since) : new Date(0), until = req.query.until ? new Date(req.query.until) : new Date();
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since > until) bad('Khoảng thời gian không hợp lệ');
    const readings = (await db.query('SELECT id,measured_at,received_at,level_cm,quality,history_only FROM readings WHERE device_id=$1 AND julianday(measured_at)>=julianday($2) AND julianday(measured_at)<=julianday($3) ORDER BY julianday(measured_at) DESC LIMIT $4', [req.params.id, since.toISOString(), until.toISOString(), limit])).rows;
    res.json({ data: readings });
  } catch (error) { respondError(error, res, next); }
});
router.post('/site/:siteId/demo-sample', requireAuth, requireSiteManager, async (req, res, next) => {
  try {
    const scenario = req.body.scenario || 'normal';
    if (!['normal', 'warning', 'critical', 'sensor-error', 'stale', 'custom'].includes(scenario)) bad('Kịch bản mô phỏng không hợp lệ');
    if (scenario === 'custom' && (typeof req.body.level_cm !== 'number' || !Number.isFinite(req.body.level_cm) || req.body.level_cm < 0 || req.body.level_cm > 90)) bad('Mực nước mô phỏng phải trong khoảng 0–90 cm');
    if (req.body.device_id) {
      const device = (await db.query('SELECT site_id FROM devices WHERE id=$1', [req.body.device_id])).rows[0];
      if (!device || device.site_id !== req.params.siteId) bad('Điểm đo không thuộc cơ sở', 403, 'FORBIDDEN');
    }
    const devices = (await db.query('SELECT d.id,d.latest_measured_at,r.warning_cm,r.critical_cm,r.clear_cm FROM devices d JOIN alert_rules r ON r.device_id=d.id WHERE d.site_id=$1 AND d.is_active=1', [req.params.siteId])).rows.filter(d => !req.body.device_id || d.id === req.body.device_id);
    if (!devices.length) bad('Không có điểm đo đang hoạt động', 404, 'NOT_FOUND');
    const results = [];
    for (const device of devices) {
      const now = Date.now();
      const last = device.latest_measured_at ? Date.parse(device.latest_measured_at) : 0;
      const measured = scenario === 'stale' ? now - 30000 : Math.max(now, last + 1);
      const level_cm = scenario === 'sensor-error' ? null : scenario === 'custom' ? req.body.level_cm : scenario === 'warning' ? device.warning_cm : scenario === 'critical' ? device.critical_cm : Math.max(0, Math.min(5, device.clear_cm - 1));
      const reading = await ingestReading({ device_id: device.id, message_id: crypto.randomUUID(), measured_at: new Date(measured).toISOString(), level_cm, quality: scenario === 'sensor-error' ? 'sensor_error' : 'ok' });
      results.push({ device_id: device.id, ...reading });
    }
    await db.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES ($1,$2,'DEMO_SAMPLE','sites',$1,$3)", [req.params.siteId, req.session.userId, JSON.stringify({ scenario, device_id: req.body.device_id || null, sample_count: results.length })]);
    publish(req); res.status(201).json({ data: { scenario, readings: results } });
  } catch (error) { respondError(error, res, next); }
});
router.post('/site/:siteId/demo-rain-step', requireAuth, requireSiteManager, async (req, res, next) => {
  try {
    const events = req.body.events;
    if (!Array.isArray(events) || events.length > 20) bad('Cần danh sách tối đa 20 vùng mưa');
    for (const event of events) {
      if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.lat !== 'number' || !Number.isFinite(event.lat) || event.lat < -90 || event.lat > 90 || typeof event.lng !== 'number' || !Number.isFinite(event.lng) || event.lng < -180 || event.lng > 180 || event.radius_m !== 3000 || ![5, 15, 30].includes(event.intensity)) bad('Vùng mưa phải có tọa độ hợp lệ, bán kính 3000 m và cường độ 5, 15 hoặc 30');
    }
    const site = req.params.siteId;
    const data = await simulationQueue(site, async () => {
      const devices = (await db.query(`SELECT ${DEVICE_FIELDS},${RULE_FIELDS} FROM devices d JOIN alert_rules r ON r.device_id=d.id WHERE d.site_id=$1 AND d.is_active=1`, [site])).rows;
      const peaks = rainPeaks.get(site) || new Map();
      const levels = rainLevels.get(site) || new Map();
      const readings = [];
      let has_water = false, needs_samples = false;
      for (const device of devices) {
        const target = Number(device.demo_override_level) > 0 ? Number(device.demo_override_level) : Number(device.critical_cm) || 20;
        // The restored 5–90cm slider keeps its original rounded-state model.
        // Smaller valid admin thresholds need fractional carry so a sub-0.05cm
        // drain step cannot round back to the same level forever.
        const fractional = target < 5;
        const carry = levels.get(device.id);
        const carryMatches = fractional && carry && carry.level_cm === device.latest_level_cm && carry.measured_at === device.latest_measured_at && carry.rule_version === device.rule_version;
        if (!carryMatches) levels.delete(device.id);
        const result = rainStep(carryMatches ? { ...device, latest_level_cm: carry.raw_level } : device, events, peaks.get(device.id));
        if (result.level_cm === null) {
          if (result.peak === null) peaks.delete(device.id);
          // A final zero is still a real sample when the configured clear sequence
          // has not finished. Never initialize an unknown reading in dry weather.
          if (device.latest_level_cm === 0 && device.clear_cm > 0 && ['warning', 'critical'].includes(device.current_alert_level)) result.level_cm = 0;
          else continue;
        }
        const now = Date.now(), last = Date.parse(device.latest_measured_at || '');
        const measured_at = new Date(Math.max(now, Number.isFinite(last) ? last + 1 : now)).toISOString();
        const reading = await ingestReading({ device_id: device.id, message_id: crypto.randomUUID(), measured_at, level_cm: result.level_cm, quality: 'ok' }, now);
        if (['warning', 'critical'].includes(result.peak)) peaks.set(device.id, result.peak); else peaks.delete(device.id);
        if (fractional && result.raw_level > 0 && !reading.history_only) levels.set(device.id, { raw_level: result.raw_level, level_cm: result.level_cm, measured_at, rule_version: device.rule_version });
        else levels.delete(device.id);
        has_water ||= result.level_cm > 0 || (fractional && result.raw_level > 0);
        if (result.level_cm < device.clear_cm) {
          const current = (await db.query('SELECT current_alert_level FROM devices WHERE id=$1', [device.id])).rows[0];
          needs_samples ||= ['warning', 'critical'].includes(current.current_alert_level);
        }
        readings.push({ device_id: device.id, level_cm: result.level_cm, ...reading });
      }
      if (peaks.size) rainPeaks.set(site, peaks); else rainPeaks.delete(site);
      if (levels.size) rainLevels.set(site, levels); else rainLevels.delete(site);
      await db.query("INSERT INTO audit_logs (site_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES ($1,$2,'DEMO_RAIN_STEP','sites',$1,$3)", [site, req.session.userId, JSON.stringify({ events, sample_count: readings.length })]);
      if (readings.length) publish(req);
      return { readings, has_water, needs_samples };
    });
    res.status(201).json({ data });
  } catch (error) { respondError(error, res, next); }
});
module.exports = router;

