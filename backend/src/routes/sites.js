const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireSiteMember } = require('../middleware/auth');
const { getDeviceMode } = require('../lib/device-mode');
function utc(value) {
  if (!value) return null;
  const time = Date.parse(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query('SELECT s.id,s.name,s.location,su.role FROM sites s JOIN site_users su ON s.id=su.site_id WHERE su.user_id=$1 AND s.is_active=1', [req.session.userId]);
    res.json({ data: result.rows });
  } catch (error) { next(error); }
});
router.get('/:id/overview', requireSiteMember, async (req, res, next) => {
  try {
    const site = (await db.query('SELECT id,name,location FROM sites WHERE id=$1 AND is_active=1', [req.params.id])).rows[0];
    if (!site) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy cơ sở' } });
    const result = await db.query(`SELECT d.id,d.name,d.point_label,d.is_active,d.last_seen,d.last_fresh_received_at,d.latest_measured_at,d.latest_quality,d.latest_level_cm,d.current_alert_level,d.demo_override_level,d.lat,d.lng,d.zone_radius_km,d.risk_level,r.warning_cm,r.critical_cm,r.clear_cm,r.sample_count,r.version AS rule_version,
      (SELECT received_at FROM readings WHERE device_id=d.id AND history_only=0 ORDER BY julianday(received_at) DESC,rowid DESC LIMIT 1) AS latest_received_at
      FROM devices d LEFT JOIN alert_rules r ON r.device_id=d.id WHERE d.site_id=$1 ORDER BY d.name`, [req.params.id]);
    const now = Date.now(), offlineAfter = Number(process.env.DEVICE_OFFLINE_AFTER_MS) || 30000;
    const device_mode = getDeviceMode(), simulation = device_mode === 'simulation';
    const devices = result.rows.map(device => {
      let measurement_status = 'online';
      const lastSeen = utc(device.last_seen), lastFresh = utc(device.last_fresh_received_at);
      if (!device.is_active) measurement_status = 'disabled';
      else if (!lastSeen) measurement_status = 'no_data';
      else if (now - Date.parse(lastSeen) > offlineAfter) measurement_status = 'offline';
      else if (device.latest_quality === 'sensor_error') measurement_status = 'sensor_error';
      else if (!lastFresh || now - Date.parse(lastFresh) > offlineAfter) measurement_status = 'stale';
      const data_status = simulation ? (device.is_active ? 'online' : 'disabled') : measurement_status;
      const validLevel = device.latest_quality === 'ok' && device.latest_level_cm !== null && Number.isFinite(Number(device.latest_level_cm));
      const baseline = simulation && device.is_active && device.latest_level_cm === null && device.latest_quality === null && device.latest_measured_at === null;
      const display_level_cm = device.is_active && validLevel && (simulation || measurement_status === 'online') ? Number(device.latest_level_cm) : baseline ? 0 : null;
      const level_source = baseline ? 'simulation_baseline' : display_level_cm !== null ? 'reading' : 'unavailable';
      const current_level_status = !device.is_active ? 'disabled' : display_level_cm === null ? 'unknown' : simulation ? (display_level_cm >= device.critical_cm ? 'critical' : display_level_cm >= device.warning_cm ? 'warning' : 'normal') : device.current_alert_level;
      return { ...device, last_seen: lastSeen, last_fresh_received_at: lastFresh, latest_measured_at: utc(device.latest_measured_at), latest_received_at: utc(device.latest_received_at), device_mode, data_status, measurement_status, display_level_cm, level_source, current_level_status };
    });
    res.json({ data: { site, devices, device_mode, server_time: new Date(now).toISOString() } });
  } catch (error) { next(error); }
});
module.exports = router;
