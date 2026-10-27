function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validThresholds(warning, critical) {
  return warning !== null && critical !== null && warning >= 0 && warning < critical && critical <= 90;
}

// Reports describe the measured water level, independently of alarm debounce,
// acknowledgement or the device's present state. Older rows have no snapshot.
function decorateReading(reading, currentRule = {}) {
  const snapshotWarning = finiteNumber(reading.warning_cm_snapshot);
  const snapshotCritical = finiteNumber(reading.critical_cm_snapshot);
  const snapshot = validThresholds(snapshotWarning, snapshotCritical);
  const warning_cm = snapshot ? snapshotWarning : finiteNumber(currentRule.warning_cm);
  const critical_cm = snapshot ? snapshotCritical : finiteNumber(currentRule.critical_cm);
  const level = finiteNumber(reading.level_cm);
  const validLevel = reading.quality === 'ok' && level !== null && level >= 0 && level <= 90;
  let water_status = 'unknown';
  if (validLevel && validThresholds(warning_cm, critical_cm)) {
    water_status = level >= critical_cm ? 'critical' : level >= warning_cm ? 'warning' : 'normal';
  }
  const ruleVersion = finiteNumber(snapshot ? reading.rule_version_snapshot : (currentRule.version ?? currentRule.rule_version));
  const historyOnly = reading.history_only === 1 || reading.history_only === true;
  const threshold_source = snapshot ? 'snapshot' : 'current_rule';
  const report_note = snapshot
    ? (historyOnly ? 'Chỉ lưu lịch sử; ngưỡng lưu tại lúc nhận số đo, không khẳng định ngưỡng tại lúc đo.' : 'Đối chiếu ngưỡng lưu tại lúc nhận số đo.')
    : 'Áp dụng ngưỡng hiện tại cho dữ liệu cũ; không xác nhận ngưỡng lịch sử.';
  return {
    ...reading,
    water_status,
    water_status_label: { normal: 'OK', warning: 'Cảnh báo', critical: 'Nguy hiểm', unknown: 'Không xác định' }[water_status],
    warning_cm,
    critical_cm,
    threshold_source,
    threshold_source_label: snapshot ? 'Ngưỡng lưu khi nhận số đo' : 'Ngưỡng hiện tại (chưa có ngưỡng lịch sử)',
    threshold_time_basis: snapshot ? 'received_at' : 'current_rule',
    rule_version: Number.isInteger(ruleVersion) && ruleVersion > 0 ? ruleVersion : null,
    quality_label: reading.quality === 'sensor_error' ? 'Lỗi cảm biến' : validLevel ? 'Hợp lệ' : 'Không hợp lệ',
    report_note
  };
}

function parseReadingTime(value) {
  if (typeof value !== 'string' || !value) return NaN;
  return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
}
function utcTime(value) {
  const time = parseReadingTime(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}
function localTime(value) {
  const time = parseReadingTime(value);
  return Number.isFinite(time) ? new Date(time + 7 * 3600000).toISOString().replace('T', ' ').replace('Z', '') : '';
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

const CSV_HEADERS = [
  'Thời gian đo (UTC+07:00)', 'Tên bãi', 'Mực nước (cm)', 'Trạng thái mực nước',
  'Ngưỡng cảnh báo (cm)', 'Ngưỡng nguy hiểm (cm)', 'Chất lượng số đo', 'Vị trí',
  'Thời gian nhận (UTC+07:00)', 'Chỉ lưu lịch sử', 'Nguồn ngưỡng', 'Phiên bản ngưỡng',
  'Thời gian đo (UTC)', 'Thời gian nhận (UTC)', 'Ghi chú'
];
function readingCSV(device, readings) {
  const rows = [CSV_HEADERS];
  for (const reading of readings) {
    const item = decorateReading(reading, device);
    rows.push([
      localTime(item.measured_at), device.name, item.quality_label === 'Hợp lệ' ? item.level_cm : '', item.water_status_label,
      item.warning_cm, item.critical_cm, item.quality_label, device.point_label,
      localTime(item.received_at), item.history_only === 1 || item.history_only === true ? 'Có' : 'Không', item.threshold_source_label, item.rule_version,
      utcTime(item.measured_at), utcTime(item.received_at), item.report_note
    ]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { decorateReading, readingCSV };
