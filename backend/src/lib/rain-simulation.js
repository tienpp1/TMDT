// One explicit simulation step represents one second of the original demo model.
// This module is pure: only the authenticated route may persist generated samples.
function distanceKm(lat1, lng1, lat2, lng2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians, dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function numeric(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function rainStep(device, events, previousPeak = null) {
  let maxRain = 0, maxResonance = 0;
  if (numeric(device.lat) && numeric(device.lng)) {
    for (const event of events) {
      const distance = distanceKm(Number(device.lat), Number(device.lng), event.lat, event.lng);
      const touch = event.radius_m / 1000 + (Number(device.zone_radius_km) || 1.5);
      if (distance <= touch) {
        maxRain = Math.max(maxRain, event.intensity >= 30 ? 5 : event.intensity >= 15 ? 3 : 1);
        maxResonance = Math.max(maxResonance, 0.3 + 0.7 * (1 - Math.max(0, Math.min(1, distance / touch))));
      }
    }
  }
  const raining = maxRain > 0;
  if (!numeric(device.latest_level_cm) && !raining) return { level_cm: null, peak: previousPeak, raining: false };
  const current = numeric(device.latest_level_cm) ? Math.max(0, Math.min(90, Number(device.latest_level_cm))) : 0;
  const target = Number(device.demo_override_level) > 0 ? Number(device.demo_override_level) : Number(device.critical_cm) || 20;
  const warning = target * 0.5, region = Number(device.risk_level) || 1;
  let next = current, peak = previousPeak || device.current_alert_level || 'normal';
  if (raining) {
    const rate = (target / 10) * (maxRain / 5) * (0.55 + region * 0.15) * maxResonance;
    if (current <= 0.5) next = Math.max(next, (region * 0.15 + maxRain * 0.15) * (target / 10) * maxResonance);
    next = Math.min(90, target + 5, next + rate);
    if (next >= target) peak = 'critical';
    else if (next >= warning && peak !== 'critical') peak = 'warning';
  } else if (current > 0) {
    let duration;
    if (peak === 'critical') duration = current > warning ? (region === 5 ? 32 : region === 3 ? 18 : 8) : (region === 5 ? 16 : region === 3 ? 9 : 4);
    else duration = region === 5 ? 20 : region === 3 ? 11 : 5;
    next = Math.max(0, current - warning / duration);
  } else return { level_cm: null, peak: null, raining: false };
  const level_cm = Math.round(Math.max(0, Math.min(90, next)) * 10) / 10;
  const drained = target < 5 ? next === 0 : level_cm === 0;
  return { level_cm, raw_level: next, peak: drained ? null : peak, raining };
}
module.exports = { distanceKm, rainStep };
