const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { setTimeout: delay } = require('timers/promises');
const SCENARIOS = ['normal', 'warning', 'critical', 'rise-fall', 'fluctuate', 'sensor-error', 'disconnect', 'duplicate', 'late-data', 'invalid-key'];

function sampleFor(device, index, scenario, tick, now = Date.now(), previous) {
  let level_cm = 5, quality = 'ok', measured = now;
  if (index === 0) {
    if (scenario === 'disconnect' && tick >= 3) return null;
    if (scenario === 'duplicate' && tick === 3 && previous) return { ...previous };
    if (scenario === 'warning' && tick >= 3) level_cm = 12;
    if (scenario === 'critical' && tick >= 3) level_cm = 22;
    if (scenario === 'rise-fall') level_cm = tick < 3 ? 5 : tick < 6 ? 12 : tick < 10 ? 22 : 5;
    if (scenario === 'fluctuate') level_cm = tick % 2 ? 11 : 9;
    if (scenario === 'sensor-error' && tick >= 3) { quality = 'sensor_error'; level_cm = null; }
    if (scenario === 'late-data' && tick === 3) { measured -= 30000; level_cm = 22; }
  }
  return { device_id: device.id, message_id: crypto.randomUUID(), measured_at: new Date(measured).toISOString(), level_cm, quality };
}
function loadQueue(filename) {
  if (!fs.existsSync(filename)) return [];
  const queue = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(queue) || queue.some(item => !item.payload || typeof item.payload.device_id !== 'string' || !Number.isFinite(item.nextAt) || !Number.isInteger(item.attempts))) throw new Error('Queue không hợp lệ; hãy lưu bản sao và kiểm tra file trước khi tiếp tục');
  return queue;
}
function saveQueue(filename, queue) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(queue, null, 2), { mode: 0o600 });
  fs.renameSync(temp, filename);
}
async function run() {
  require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
  require('dotenv').config({ path: path.join(__dirname, '../../.env.simulator'), quiet: true });
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  if (args.includes('--help')) {
    console.log(`Dùng: npm run simulator -- --scenario <${SCENARIOS.join('|')}> [--ticks N] [--interval MS]`);
    return;
  }
  const scenario = option('--scenario', 'normal');
  if (!SCENARIOS.includes(scenario)) throw new Error(`Kịch bản không hợp lệ. Chọn: ${SCENARIOS.join(', ')}`);
  const interval = Number(option('--interval', process.env.SIMULATOR_INTERVAL_MS || 5000));
  const ticks = Number(option('--ticks', args.includes('--once') ? 1 : Infinity));
  if (!Number.isInteger(interval) || interval < 1000 || interval > 3600000) throw new Error('Chu kỳ phải là số nguyên từ 1000 đến 3600000 ms');
  if (ticks !== Infinity && (!Number.isInteger(ticks) || ticks < 1)) throw new Error('--ticks phải là số nguyên dương');
  const devices = [1, 2, 3].map((number) => ({ id: process.env[`SIMULATOR_DEVICE_${number}_ID`] || `${number}${number}${number}${number}${number}${number}${number}${number}-${number}${number}${number}${number}-4${number}${number}${number}-8${number}${number}${number}-${String(number).repeat(12)}`, key: process.env[`SIMULATOR_DEVICE_${number}_KEY`] }));
  if (devices.some(device => !device.key)) throw new Error('Thiếu khóa trong .env.simulator. Chạy seed trên DB demo hoặc cấu hình ba khóa đã cấp.');
  const base = process.env.SIMULATOR_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  const url = new URL(base);
  if (!url.pathname.replace(/\/$/, '').endsWith('/api/telemetry')) url.pathname = url.pathname.replace(/\/$/, '') + '/api/telemetry';
  const queueFile = path.resolve(process.env.SIMULATOR_QUEUE_PATH || path.join(__dirname, '../.queue.json'));
  let queue = loadQueue(queueFile);
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.once('SIGINT', onStop); process.once('SIGTERM', onStop);
  const previous = new Map(), blockedUntil = new Map();
  console.log(`Mô phỏng ${scenario}: HTTP thật, ${interval} ms/mẫu, 3 điểm đo. Ctrl+C để dừng.`);
  async function attempt(item) {
    const device = devices.find(d => d.id === item.payload.device_id);
    if (!device) return 'discard';
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': item.invalidKey ? 'invalid-demo-key' : device.key }, body: JSON.stringify(item.payload), signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        console.log(`${device.id.slice(0, 8)}: ${item.payload.quality === 'ok' ? `${item.payload.level_cm} cm` : 'lỗi cảm biến'} (${response.status})`);
        return 'done';
      }
      if (response.status === 429) {
        const retry = Number(response.headers.get('Retry-After')) || 60;
        blockedUntil.set(device.id, Date.now() + Math.max(1000, retry * 1000));
        item.nextAt = blockedUntil.get(device.id);
        console.error(`${device.id.slice(0, 8)}: hạn mức 429; chờ ${retry}s`);
        return 'retry';
      }
      if (response.status < 500) { console.error(`${device.id.slice(0, 8)}: từ chối ${response.status}, không retry bản tin lỗi`); return 'discard'; }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      item.attempts++;
      item.nextAt = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(item.attempts - 1, 4));
      console.error(`${device.id.slice(0, 8)}: ${error.message}; đã giữ bản tin để retry`);
      return 'retry';
    }
  }
  function append(item) {
    if (queue.some(existing => existing.payload.device_id === item.payload.device_id && existing.payload.message_id === item.payload.message_id)) return;
    if (queue.filter(existing => existing.payload.device_id === item.payload.device_id).length >= 1000) throw new Error('Queue đã đủ 1000 bản tin/thiết bị; dừng để tránh âm thầm mất dữ liệu');
    queue.push(item); saveQueue(queueFile, queue);
  }
  try {
    for (let tick = 0; tick < ticks && !stop.signal.aborted; tick++) {
      for (const [index, device] of devices.entries()) {
        const payload = sampleFor(device, index, scenario, tick, Date.now(), previous.get(device.id));
        if (payload) {
          previous.set(device.id, payload);
          const item = { payload, attempts: 0, nextAt: Date.now(), invalidKey: scenario === 'invalid-key' && index === 0 && tick === 3 };
          // Persist before sending; a crash after success is an idempotent retry.
          append(item);
          if ((blockedUntil.get(device.id) || 0) <= Date.now()) {
            const result = await attempt(item);
            if (result !== 'retry') queue = queue.filter(record => record.payload.message_id !== item.payload.message_id);
            saveQueue(queueFile, queue);
          }
        }
        // One queued retry per device keeps new samples from waiting behind backlog.
        const pending = queue.find(item => item.payload.device_id === device.id && item.nextAt <= Date.now() && (!payload || item.payload.message_id !== payload.message_id));
        if (pending && (blockedUntil.get(device.id) || 0) <= Date.now()) {
          const result = await attempt(pending);
          if (result !== 'retry') queue = queue.filter(record => record !== pending);
          saveQueue(queueFile, queue);
        }
      }
      if (tick + 1 < ticks && !stop.signal.aborted) await delay(interval, undefined, { signal: stop.signal });
    }
  } catch (error) { if (error.name !== 'AbortError') throw error; }
  finally { saveQueue(queueFile, queue); process.removeListener('SIGINT', onStop); process.removeListener('SIGTERM', onStop); }
  console.log(`Đã dừng. Còn ${queue.length} bản tin chờ trong queue.`);
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { SCENARIOS, sampleFor, loadQueue, saveQueue };
