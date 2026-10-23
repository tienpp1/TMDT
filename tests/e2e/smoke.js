// Browser acceptance tests run against an isolated temporary SQLite database.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
// Routine tests use fixture map images and keep the original coursework evidence intact.
const artifactDir = path.resolve(process.env.E2E_ARTIFACT_DIR || path.join(root, 'artifacts/e2e'));
const evidenceDir = path.join(artifactDir, 'screenshots');
const reportFile = path.join(artifactDir, 'browser-results.json');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmdt-e2e-'));
const results = { started_at: new Date().toISOString(), browser: 'Chrome headless', isolated_database: true, checks: [], screenshots: [], javascript_errors: [], api_errors: [], map_tiles: { source: 'intercepted PNG fixtures', live_provider_verified: false } };
const tilePNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const tileReferrers = [];
let failTiles = false;
let browser, server, context, currentPage;
let baseUrl;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availablePort(preferred = 0) {
  const probe = net.createServer();
  const port = await new Promise((resolve, reject) => {
    probe.once('error', error => error.code === 'EADDRINUSE' ? resolve(null) : reject(error));
    probe.listen(preferred, () => resolve(probe.address().port));
  });
  if (port === null) return availablePort(0);
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function check(name, operation) {
  await operation();
  results.checks.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true, animations: 'disabled' });
  results.screenshots.push(path.relative(root, path.join(evidenceDir, name)).replace(/\\/g, '/'));
}
async function login(page, email, password) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#app-view:not(.hidden)').waitFor();
  await page.waitForFunction(() => document.querySelector('#site-selector').options.length > 0 && /^Cập nhật: [^\-]/.test(document.querySelector('#last-updated-time').textContent));
}
async function navigate(page, name) {
  const menu = page.locator('#menu-toggle');
  if (await menu.isVisible()) await menu.click();
  await page.locator('[data-page="' + name + '"]').click();
  await page.locator('#page-' + name + ':not(.hidden)').waitFor();
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const port = await availablePort();
  baseUrl = 'http://localhost:' + port;
  results.port = port;
  const environment = { ...process.env, NODE_ENV: 'test', SQLITE_PATH: path.join(temporaryDir, 'browser.sqlite'), APP_BASE_URL: baseUrl, PORT: String(port), SESSION_SECRET: 'isolated-e2e-session-only', COOKIE_SECURE: 'false', DEMO_MANAGER_PASSWORD: 'manager123', DEMO_STAFF_PASSWORD: 'staff123' };
  execFileSync(process.execPath, ['-e', "require('./backend/scripts/seed').seed({writeSimulatorEnv:false}).then(()=>require('./backend/src/db').pool.end()).catch(error=>{console.error(error.message);process.exitCode=1})"], { cwd: root, env: environment, windowsHide: true, stdio: 'pipe' });
  let serverOutput = '';
  server = spawn(process.execPath, ['backend/src/server.js'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Test server stopped: ' + serverOutput);
    try { if ((await fetch(baseUrl + '/api/auth/me')).status === 401) { ready = true; break; } } catch (_) { /* Startup only. */ }
    await pause(100);
  }
  assert(ready, 'isolated server must start');
  console.log('Isolated browser server: ' + baseUrl);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'vi-VN', timezoneId: 'Asia/Bangkok' });
  context.setDefaultTimeout(10000);
  await context.route('https://tile.openstreetmap.org/**', async route => {
    tileReferrers.push(route.request().headers().referer);
    await route.fulfill(failTiles
      ? { status: 403, contentType: 'image/png', headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: tilePNG }
      : { status: 200, contentType: 'image/png', headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: tilePNG });
  });
  const page = await context.newPage();
  currentPage = page;
  page.on('pageerror', error => results.javascript_errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/^Failed to load resource:|net::ERR_|Access to (?:font|image|script)/.test(message.text())) results.javascript_errors.push(message.text());
  });
  page.on('response', response => {
    if (response.url().startsWith(baseUrl + '/api/') && response.status() >= 400 && !(response.url().endsWith('/api/auth/me') && response.status() === 401)) {
      results.api_errors.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await check('manager dashboard starts with three points and no fabricated readings', async () => {
    await login(page, 'manager@example.com', 'manager123');
    assert.equal(await page.locator('#dashboard-devices-grid .device-card').count(), 3);
    assert.equal(await page.locator('#dashboard-devices-grid .level-value').allTextContents().then(levels => levels.every(value => value === '--')), true);
    assert.equal(await page.locator('#dashboard-devices-grid .device-badge').allTextContents().then(badges => badges.every(value => value.includes('Chưa có dữ liệu'))), true);
    assert(await page.locator('[data-page=settings]').isVisible());
    assert(await page.locator('[data-page=water-levels]').isVisible());
  });
  await check('map tiles send origin referrer, fail gracefully and recover without losing device markers', async () => {
    await page.locator('#leaflet-map img.leaflet-tile-loaded').first().waitFor();
    const markerCount = await page.locator('#leaflet-map .leaflet-marker-icon').count();
    assert.equal(markerCount, 3);
    assert(tileReferrers.length > 0);
    assert(tileReferrers.every(value => value === baseUrl + '/'));
    failTiles = true;
    await page.evaluate(() => leafletMap.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.redraw(); }));
    await page.locator('#dashboard-map-status:not(.hidden)').waitFor();
    await page.waitForFunction(() => {
      const tiles = [...document.querySelectorAll('#leaflet-map img.leaflet-tile')];
      return tiles.length > 0 && tiles.every(tile => tile.style.visibility === 'hidden');
    });
    assert.equal(await page.locator('#leaflet-map .leaflet-marker-icon').count(), markerCount);
    assert.equal(await page.locator('#dashboard-devices-grid .device-card').count(), 3);
    failTiles = false;
    await page.evaluate(() => leafletMap.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.redraw(); }));
    await page.locator('#leaflet-map img.leaflet-tile-loaded').first().waitFor();
    await page.locator('#dashboard-map-status.hidden').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#leaflet-map .leaflet-marker-icon').count(), markerCount);
  });
  const session = await context.request.get(baseUrl + '/api/auth/me');
  const siteId = (await session.json()).data.sites[0].id;
  const overview = async () => (await (await context.request.get(baseUrl + '/api/sites/' + siteId + '/overview')).json()).data;
  const sample = async scenario => {
    const response = await context.request.post(baseUrl + '/api/devices/site/' + siteId + '/demo-sample', { data: { scenario } });
    assert.equal(response.status(), 201, await response.text());
  };
  const samples = async scenario => { for (let index = 0; index < 3; index++) await sample(scenario); };
  await check('normal then warning transitions only after the third sample', async () => {
    await samples('normal');
    assert((await overview()).devices.every(device => device.current_alert_level === 'normal'));
    await sample('warning');
    await sample('warning');
    assert((await overview()).devices.every(device => device.current_alert_level === 'normal'));
    await sample('warning');
    assert((await overview()).devices.every(device => device.current_alert_level === 'warning'));
  });
  await check('critical dashboard renders real chart and current sensor quality', async () => {
    await samples('critical');
    await page.evaluate(() => pollData());
    await page.waitForFunction(() => [...document.querySelectorAll('#dashboard-devices-grid .device-badge')].every(element => element.textContent === 'NGUY HIỂM'));
    assert.equal(await page.locator('#dashboard-devices-grid .quality-text').allTextContents().then(values => values.every(value => value === 'Tín hiệu tốt')), true);
    await page.waitForFunction(() => typeof Chart !== 'undefined' && !!Chart.getChart('dashboard-chart'));
    assert(await page.evaluate(() => Chart.getChart('dashboard-chart').data.datasets[0].data.every(value => value === 20)));
    await screenshot(page, 'desktop-critical-dashboard.png');
  });
  await check('alert acknowledgement preserves critical level and active episode', async () => {
    await navigate(page, 'alerts');
    const ack = page.locator('#alerts-tbody button[data-action=ack-alert]').first();
    await ack.waitFor();
    await ack.click();
    await page.waitForFunction(() => document.querySelector('#alerts-tbody').textContent.includes('Đã xác nhận'));
    assert((await overview()).devices.every(device => device.current_alert_level === 'critical'));
    await screenshot(page, 'alert-center.png');
  });
  await check('manager simulator uses the shared one-sample endpoint and shows thresholds', async () => {
    await navigate(page, 'water-levels');
    await page.locator('#demo-scenario').selectOption('normal');
    await page.getByRole('button', { name: 'Gửi 1 mẫu', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#demo-status').textContent.includes('Đã gửi một mẫu'));
    await sample('normal');
    await sample('normal');
    assert((await overview()).devices.every(device => device.current_alert_level === 'normal'));
    await page.evaluate(() => pollData());
    await screenshot(page, 'device-simulator.png');
    await sample('sensor-error');
    await page.evaluate(() => pollData());
    await page.waitForFunction(() => [...document.querySelectorAll('#dashboard-devices-grid .device-badge')].every(element => element.textContent.includes('Lỗi cảm biến')));
    assert((await page.locator('#dashboard-devices-grid .level-value').allTextContents()).every(value => value === '--'));
    await samples('normal');
  });
  await check('history chart, range selector and CSV download work', async () => {
    await navigate(page, 'devices');
    await page.waitForFunction(() => document.querySelector('#history-readings-tbody').textContent.includes('Điểm đo'));
    const rangeResponse = page.waitForResponse(response => response.url().includes('/history-stats?hours=1') && response.status() === 200);
    await page.locator('#history-time-range').selectOption('1');
    await rangeResponse;
    await page.waitForFunction(() => !!Chart.getChart('history-chart'));
    assert(await page.evaluate(() => Chart.getChart('history-chart').data.datasets.every(dataset => dataset.data.every(point => typeof point.x === 'number' && (typeof point.y === 'number' || point.y === null)))));
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Xuất CSV', exact: false }).click();
    const download = await downloadPromise;
    assert(download.suggestedFilename().endsWith('.csv'));
  });
  await check('device creation renders hostile names as text and shows a key only once', async () => {
    await navigate(page, 'settings');
    await page.getByRole('button', { name: 'Thêm điểm đo', exact: false }).click();
    await page.locator('#dev-modal-map img.leaflet-tile-loaded').first().waitFor();
    failTiles = true;
    await page.evaluate(() => pickerMap.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.redraw(); }));
    await page.locator('#picker-map-status:not(.hidden)').waitFor();
    assert(await page.locator('#dashboard-map-status').evaluate(element => element.classList.contains('hidden')));
    await page.waitForFunction(() => document.querySelectorAll('#dev-modal-map .leaflet-marker-icon').length === 1);
    failTiles = false;
    await page.evaluate(() => pickerMap.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.redraw(); }));
    await page.locator('#dev-modal-map img.leaflet-tile-loaded').first().waitFor();
    await page.locator('#picker-map-status.hidden').waitFor({ state: 'attached' });
    const hostileName = '<img src=x onerror="window.__xss=1"> O\'Hare';
    await page.locator('#dev-modal-name').fill(hostileName);
    const createdPromise = page.waitForResponse(response => response.url().endsWith('/api/devices/site/' + siteId) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Lưu điểm đo', exact: false }).click();
    const created = await (await createdPromise).json();
    assert(created.data.id);
    await page.locator('#modal-provisioning.active').waitFor();
    assert.equal(await page.locator('#provisioning-key').inputValue(), created.data.key);
    await page.getByRole('button', { name: 'Đã lưu khóa', exact: true }).click();
    assert.equal(await page.locator('#provisioning-key').inputValue(), '');
    await page.evaluate(() => pollData());
    await page.waitForFunction(name => document.querySelector('#admin-devices-tbody').textContent.includes(name), hostileName);
    assert.equal(await page.locator('#admin-devices-tbody img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    const editButton = page.locator('[data-action=edit-device][data-id="' + created.data.id + '"]');
    const row = editButton.locator('xpath=ancestor::tr');
    await row.getByRole('button', { name: 'Đổi khóa', exact: true }).click();
    const rotatePromise = page.waitForResponse(response => response.url().endsWith('/devices/' + created.data.id + '/rotate-key'));
    await page.locator('#modal-rotate-key.active').getByRole('button', { name: 'Đổi khóa', exact: true }).click();
    assert.equal((await rotatePromise).status(), 200);
    await page.locator('#modal-provisioning.active').waitFor();
    assert.notEqual(await page.locator('#provisioning-key').inputValue(), created.data.key);
    assert((await page.locator('#provisioning-key').inputValue()).startsWith(created.data.id + '.'));
    await page.getByRole('button', { name: 'Đã lưu khóa', exact: true }).click();
    await editButton.click();
    await page.locator('#dev-modal-warn').fill('11');
    await page.locator('#dev-modal-crit').fill('21');
    const rulePromise = page.waitForResponse(response => response.url().endsWith('/devices/' + created.data.id + '/rule') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Lưu điểm đo', exact: false }).click();
    assert.equal((await rulePromise).status(), 200);
    await page.locator('#modal-device.active').waitFor({ state: 'hidden' });
    await page.evaluate(() => pollData());
    await row.getByRole('button', { name: 'Vô hiệu hóa', exact: true }).click();
    await page.locator('#modal-delete-device.active').getByRole('button', { name: 'Vô hiệu hóa', exact: true }).click();
    await page.waitForFunction(id => [...document.querySelectorAll('#admin-devices-tbody tr')].some(row => row.querySelector('[data-id="' + id + '"][data-action=toggle-device]')), created.data.id);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
  });
  await check('mobile menu, navigation and logout are usable at 390 pixels', async () => {
    await navigate(page, 'dashboard');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#menu-toggle').click();
    assert(await page.locator('.sidebar.open').isVisible());
    await page.waitForFunction(() => Math.abs(document.querySelector('.sidebar').getBoundingClientRect().left) < 1);
    assert(await page.evaluate(() => !!document.elementFromPoint(120, 650)?.closest('.sidebar')), 'map controls must remain behind the open menu');
    await screenshot(page, 'mobile-navigation.png');
    await page.locator('[data-page=dashboard]').click();
    assert.equal(await page.locator('.sidebar.open').count(), 0);
    await page.locator('#menu-toggle').click();
    await page.locator('#logout-btn').click();
    await page.locator('#login-view:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(() => window.devicesCache.length), 0);
    assert.equal(await page.locator('#provisioning-key').inputValue(), '');
  });
  await check('staff receives clean dashboard, reports and no administration or simulator', async () => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await login(page, 'staff@example.com', 'staff123');
    assert(!(await page.locator('[data-page=settings]').isVisible()));
    assert(!(await page.locator('[data-page=water-levels]').isVisible()));
    assert(await page.locator('#page-dashboard').isVisible());
    await navigate(page, 'reports');
    await page.locator('#reports-devices-tbody a').first().waitFor();
    const response = await context.request.get(new URL(await page.locator('#reports-devices-tbody a').first().getAttribute('href'), baseUrl).href);
    assert.equal(response.status(), 200);
    assert((response.headers()['content-type'] || '').includes('text/csv'));
    await screenshot(page, 'staff-reports.png');
  });
  await check('backend outage displays connection failure and preserves previous values', async () => {
    await navigate(page, 'dashboard');
    const before = await page.locator('#dashboard-devices-grid .level-value').allTextContents();
    await page.route('**/api/sites/*/overview', route => route.abort('failed'));
    await page.evaluate(() => pollData());
    await page.locator('#connection-error:not(.hidden)').waitFor();
    assert.equal(await page.locator('#connection-status.online').count(), 0);
    assert.deepEqual(await page.locator('#dashboard-devices-grid .level-value').allTextContents(), before);
    await page.unroute('**/api/sites/*/overview');
  });
  assert.deepEqual(results.javascript_errors, [], 'frontend must not produce JavaScript errors');
  assert.deepEqual(results.api_errors, [], 'frontend must not call failing application APIs');
  assert(tileReferrers.every(value => value === baseUrl + '/'), 'both maps must send the application origin on every tile request');
  results.map_tiles = { ...results.map_tiles, http_status_cases: [200, 403], failure_payload: 'valid PNG', requests: tileReferrers.length, referrers: [...new Set(tileReferrers)], failure_and_recovery: 'passed for dashboard and picker' };
  results.status = 'passed';
}

main().catch(async error => {
  results.status = 'failed';
  results.failure = error.stack || error.message;
  console.error(error.stack || error.message);
  if (currentPage && !currentPage.isClosed()) {
    results.failure_ui = await currentPage.evaluate(() => ({
      current_page: [...document.querySelectorAll('.page:not(.hidden)')].map(element => element.id),
      active_dialogs: [...document.querySelectorAll('.modal-overlay.active')].map(element => element.id),
      admin_buttons: [...document.querySelectorAll('#admin-devices-tbody button')].map(element => ({ text: element.textContent.trim(), action: element.dataset.action, id: element.dataset.id })),
      toasts: document.querySelector('#toast-container')?.textContent,
      connection: document.querySelector('#connection-error')?.textContent,
      map_status: document.querySelector('#dashboard-map-status')?.textContent,
      tiles: [...document.querySelectorAll('#leaflet-map img.leaflet-tile')].map(tile => ({ visibility: tile.style.visibility, complete: tile.complete, naturalWidth: tile.naturalWidth }))
    })).catch(() => null);
  }
  process.exitCode = 1;
}).finally(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), pause(3000)]);
  }
  if (browser) await browser.close().catch(() => {});
  results.finished_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(results, null, 2) + '\n');
  // Remove only the exact directory created above, after checking the resolved target.
  const resolved = path.resolve(temporaryDir), parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('tmdt-e2e-')) fs.rmSync(resolved, { recursive: true, force: true });
  else throw new Error('Refusing to clean an unexpected temporary path');
});
