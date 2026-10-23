const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUI(apiOverrides = {}) {
  const nodes = new Map();
  const node = id => {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(id.startsWith('page-') && id !== 'page-dashboard' ? ['hidden'] : []);
    const el = {
      id, value: '', textContent: '', innerHTML: '', style: {}, children: [],
      classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, force) => { const on = force === undefined ? !classes.has(x) : force; on ? classes.add(x) : classes.delete(x); return on; } },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, remove() {}, click() {},
      querySelector: selector => node(`${id}:${selector}`)
    };
    el.content = { cloneNode: () => ({ querySelector: selector => node(`clone:${selector}`) }) };
    nodes.set(id, el);
    return el;
  };
  const context = vm.createContext({
      document: { getElementById: node, querySelectorAll: () => [], querySelector: () => node('query'), createElement: tag => node(`created:${tag}:${nodes.size}`), body: node('body'), addEventListener() {} },
    api: { getMe: async () => { throw new Error('signed out'); }, ...apiOverrides },
    window: { addEventListener() {}, location: { reload() {} } },
    navigator: {}, console: { error() {}, log() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
    EventSource: class { close() {} },
    Chart: class { constructor(_ctx, options) { Object.assign(this, options); } destroy() {} update() {} },
    URL, Blob, Date, Map, Set, AbortController
  });
  // Browser global functions assigned through window are also available as identifiers.
  context.window = context;
  context.addEventListener = () => {};
  // Exercise exported browser functions without starting the real authentication bootstrap.
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
  vm.runInContext(source, context);
  return { context, node, run: code => vm.runInContext(code, context) };
}

test('incident titles and notes remain text even when they contain executable HTML', async () => {
  const ui = loadUI({ getSiteIncidents: async () => [{ id: 'incident-1', title: '<img src=x onerror=alert(1)>', status: 'new', created_at: '2026-10-23T00:00:00Z' }], getIncidentNotes: async () => [{ note: '<img src=x onerror=alert(2)>', author_name: '<script>x</script>', created_at: '2026-10-23T00:00:00Z' }] });
  ui.run("currentUser = {sites:[{id:'site',role:'staff'}]}; currentSiteId='site'; renderIncidents([{id:'incident-1',title:'<img src=x onerror=alert(1)>',status:'new',created_at:'2026-10-23T00:00:00Z'}]);");
  expect(ui.node('incidents-tbody').children[0].innerHTML).not.toContain('<img');
  await ui.run("openIncidentNotesModal('incident-1')");
  expect(ui.node('incident-notes-list').innerHTML).not.toContain('<img');
  expect(ui.node('incident-notes-list').innerHTML).not.toContain('<script>');
});

test('overlapping refreshes do not start a second overview request', async () => {
  let calls = 0;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const ui = loadUI({ getSiteOverview: () => { calls++; return pending; }, getSiteAlerts: async () => [], getSiteIncidents: async () => [] });
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'staff'}]}");
  const first = ui.run('pollData()');
  const second = ui.run('pollData()');
  expect(calls).toBe(1);
  finish({ devices: [] });
  await Promise.all([first, second]);
});

test('logout closes updates and removes data from the previous account', () => {
  const ui = loadUI();
  let closed = false;
  ui.context.evtSource = { close: () => { closed = true; } };
  ui.run("currentSiteId='private-site'; latestDevicesList=[{id:'private-device'}]; window.devicesCache=latestDevicesList; showLogin()");
  expect(closed).toBe(true);
  expect(ui.run('currentSiteId')).toBe(null);
  expect(ui.run('latestDevicesList.length')).toBe(0);
  expect(ui.run('window.devicesCache.length')).toBe(0);
});

test('history range excludes older measurements and preserves unavailable sensor readings', () => {
  const ui = loadUI();
  ui.node('history-device-select').value = 'all';
  ui.node('history-time-range').value = '1';
  ui.run("historyStatsCache=[{id:'d',name:'Điểm đo',critical_cm:20,warning_cm:10,readings:[{measured_at:new Date(Date.now()-7200000).toISOString(),level_cm:88,quality:'ok'},{measured_at:new Date().toISOString(),level_cm:null,quality:'sensor_error'}]}]; filterHistoryDisplay()");
  expect(ui.node('history-readings-tbody').innerHTML).not.toContain('88.0');
  expect(ui.node('history-readings-tbody').innerHTML).toContain('--');
  expect(ui.node('history-readings-tbody').innerHTML).toContain('Lỗi cảm biến');
  expect(ui.node('history-readings-tbody').innerHTML).not.toContain('Bình thường');
});

test('staff report downloads use the member overview rather than administration', async () => {
  const ui = loadUI({ request: async () => ({ avg_resolution_minutes: 12 }), getSiteOverview: async () => ({ devices: [{ id: 'd', name: 'Điểm đo', point_label: 'Cổng' }] }), getDevices: async () => { throw new Error('manager only'); } });
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'staff'}]}");
  await ui.run('loadReportsData()');
  expect(ui.node('reports-devices-tbody').innerHTML).toContain('/api/reports/site/site/device/d/csv');
});

test('new device key is shown once and is removed when its dialog closes', async () => {
  const ui = loadUI({ addDevice: async () => ({ id: 'new-device', key: 'one-time-secret' }) });
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'manager'}]}");
  const values = { 'dev-modal-name': 'Cổng', 'dev-modal-lat': '10', 'dev-modal-lng': '106', 'dev-modal-radius-slider': '1.5', 'dev-modal-risk': '1', 'dev-modal-warn': '10', 'dev-modal-crit': '20', 'dev-modal-clr': '7', 'dev-modal-samples': '3' };
  Object.entries(values).forEach(([id, value]) => { ui.node(id).value = value; });
  await ui.run('submitDeviceModal()');
  expect(ui.node('provisioning-key').value).toBe('one-time-secret');
  expect(ui.node('modal-provisioning').classList.contains('active')).toBe(true);
  let copied;
  ui.context.navigator.clipboard = { writeText: async value => { copied = value; } };
  await ui.run('copyProvisioningKey()');
  expect(copied).toBe('one-time-secret');
  ui.run("closeModal('modal-provisioning')");
  expect(ui.node('provisioning-key').value).toBe('');
});

test('editing alert thresholds sends their version through the rule endpoint', async () => {
  const writes = [];
  const ui = loadUI({ updateRule: async (id, payload) => { writes.push({ kind: 'rule', id, payload }); }, updateDevice: async (id, payload) => { writes.push({ kind: 'device', id, payload }); } });
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'manager'}]}; adminDevicesCache=[{id:'d',warning_cm:10,critical_cm:20,clear_cm:7,sample_count:3,rule_version:9}]");
  const values = { 'dev-modal-id': 'd', 'dev-modal-name': 'Cổng', 'dev-modal-lat': '10', 'dev-modal-lng': '106', 'dev-modal-radius-slider': '1.5', 'dev-modal-risk': '1', 'dev-modal-warn': '11', 'dev-modal-crit': '21', 'dev-modal-clr': '7', 'dev-modal-samples': '3', 'dev-modal-rule-version': '9' };
  Object.entries(values).forEach(([id, value]) => { ui.node(id).value = value; });
  await ui.run('submitDeviceModal()');
  expect(writes[0]).toEqual({ kind: 'rule', id: 'd', payload: { warning_cm: 11, critical_cm: 21, clear_cm: 7, sample_count: 3, expected_version: 9 } });
  expect(writes[1].payload).not.toHaveProperty('warning_cm');
});

test('a device creation response arriving after logout cannot reveal its key', async () => {
  let finish;
  const ui = loadUI({ addDevice: () => new Promise(resolve => { finish = resolve; }) });
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'manager'}]}");
  const values = { 'dev-modal-name': 'Cổng', 'dev-modal-lat': '10', 'dev-modal-lng': '106', 'dev-modal-radius-slider': '1.5', 'dev-modal-risk': '1', 'dev-modal-warn': '10', 'dev-modal-crit': '20', 'dev-modal-clr': '7', 'dev-modal-samples': '3' };
  Object.entries(values).forEach(([id, value]) => { ui.node(id).value = value; });
  const pending = ui.run('submitDeviceModal()');
  ui.run('showLogin()');
  finish({ id: 'new-device', key: 'private-secret' });
  await pending;
  expect(ui.node('provisioning-key').value).toBe('');
  expect(ui.node('modal-provisioning').classList.contains('active')).toBe(false);
});

test('demo sends one requested sample and is unavailable to staff', async () => {
  const samples = [];
  const ui = loadUI({ sendDemoSample: async (site, payload) => { samples.push({ site, payload }); } });
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'staff'}]}");
  ui.node('demo-scenario').value = 'critical';
  ui.node('demo-device').value = 'd';
  await ui.run('sendDemoSample()');
  expect(samples).toHaveLength(0);
  ui.run("currentUser.sites[0].role='manager'");
  await ui.run('sendDemoSample()');
  expect(samples).toEqual([{ site: 'site', payload: { scenario: 'critical', device_id: 'd' } }]);
});

test('a failed refresh exposes stale connection state without replacing a known reading', async () => {
  const ui = loadUI({ getSiteOverview: async () => { throw new Error('network'); }, getSiteAlerts: async () => [], getSiteIncidents: async () => [] });
  ui.node('connection-error').classList.add('hidden');
  ui.run("currentSiteId='site'; currentUser={sites:[{id:'site',role:'staff'}]}; latestDevicesList=[{id:'d',latest_level_cm:22}]");
  await ui.run('pollData()');
  expect(ui.node('connection-error').classList.contains('hidden')).toBe(false);
  expect(ui.node('connection-status').classList.contains('online')).toBe(false);
  expect(ui.run('latestDevicesList[0].latest_level_cm')).toBe(22);
});

test('sensor errors and missing measurements display unavailable instead of zero or normal', () => {
  const ui = loadUI();
  ui.run("renderDashboard([{id:'d',name:'Cổng',is_active:1,data_status:'sensor_error',latest_quality:'sensor_error',latest_level_cm:null,current_alert_level:'critical'}],[],[])");
  expect(ui.node('clone:.level-value').textContent).toBe('--');
  expect(ui.node('clone:.device-badge').textContent).toContain('Lỗi cảm biến');
  expect(ui.node('clone:.device-badge').textContent).toContain('NGUY HIỂM');
});

test('different device timestamps keep continuous individual series and only real sensor errors produce gaps', () => {
  const ui = loadUI();
  ui.run("renderHistoryChart([{id:'a',name:'A',readings:[{measured_at:'2026-10-23T00:00:00Z',level_cm:1,quality:'ok'},{measured_at:'2026-10-23T00:00:10Z',level_cm:null,quality:'sensor_error'},{measured_at:'2026-10-23T00:00:20Z',level_cm:2,quality:'ok'}]},{id:'b',name:'B',readings:[{measured_at:'2026-10-23T00:00:05Z',level_cm:3,quality:'ok'},{measured_at:'2026-10-23T00:00:15Z',level_cm:4,quality:'ok'}]}])");
  const datasets = ui.run('historyChartInstance.data.datasets');
  expect(datasets[0].data).toEqual([{ x: Date.parse('2026-10-23T00:00:00Z'), y: 1 }, { x: Date.parse('2026-10-23T00:00:10Z'), y: null }, { x: Date.parse('2026-10-23T00:00:20Z'), y: 2 }]);
  expect(datasets[1].data).toEqual([{ x: Date.parse('2026-10-23T00:00:05Z'), y: 3 }, { x: Date.parse('2026-10-23T00:00:15Z'), y: 4 }]);
});

function mapLayers(ui) {
  const layers = [];
  ui.context.L = {
    map: () => ({ setView() { return this; }, on() { return this; } }),
    tileLayer: (url, options) => {
      const layer = { url, options, handlers: {}, on(events, handler) { events.split(' ').forEach(event => { this.handlers[event] = handler; }); return this; }, addTo() { return this; }, getTileUrl: () => 'https://tile.openstreetmap.org/1/0/1.png' };
      layers.push(layer);
      return layer;
    }
  };
  return layers;
}

test('both map surfaces send the application origin as cross-origin tile referrer', () => {
  const ui = loadUI();
  const layers = mapLayers(ui);
  ui.run('initMap(); initPickerMap();');
  expect(layers).toHaveLength(2);
  expect(layers.map(layer => layer.options.referrerPolicy)).toEqual(['strict-origin-when-cross-origin', 'strict-origin-when-cross-origin']);
});

test('tile failures hide blocked images, report per-map errors and recover on load or leaving the viewport', () => {
  const ui = loadUI();
  const layers = mapLayers(ui);
  ui.node('dashboard-map-status').classList.add('hidden');
  ui.node('picker-map-status').classList.add('hidden');
  ui.run('initMap(); initPickerMap();');
  const first = { style: {} }, second = { style: {} };
  layers[0].handlers.tileerror?.({ tile: first });
  expect(first.style.visibility).toBe('hidden');
  expect(ui.node('dashboard-map-status').classList.contains('hidden')).toBe(false);
  expect(ui.node('picker-map-status').classList.contains('hidden')).toBe(true);
  // Another healthy tile cannot conceal an unresolved partial failure.
  layers[0].handlers.tileload?.({ tile: { style: {} } });
  expect(ui.node('dashboard-map-status').classList.contains('hidden')).toBe(false);
  layers[0].handlers.tileload?.({ tile: first });
  expect(first.style.visibility).toBe('');
  expect(ui.node('dashboard-map-status').classList.contains('hidden')).toBe(true);
  layers[1].handlers.tileerror?.({ tile: second });
  expect(ui.node('picker-map-status').classList.contains('hidden')).toBe(false);
  layers[1].handlers.tileunload?.({ tile: second });
  expect(ui.node('picker-map-status').classList.contains('hidden')).toBe(true);
});

function tileTransport(ui) {
  const layers = mapLayers(ui), urls = [], revoked = [];
  ui.context.URL = {
    createObjectURL: () => { const url = 'blob:fixture-' + (urls.length + 1); urls.push(url); return url; },
    revokeObjectURL: url => revoked.push(url)
  };
  ui.run('initMap()');
  return { layer: layers[0], urls, revoked };
}
const flushTilePromises = () => new Promise(setImmediate);

test('HTTP 403 with a valid PNG body never becomes a displayed tile', async () => {
  const ui = loadUI(), requests = [], completed = [];
  let bodyRead = false;
  ui.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: false, status: 403, blob: async () => { bodyRead = true; return new Blob(['PNG']); } };
  };
  const { layer, urls } = tileTransport(ui);
  expect(typeof layer.createTile).toBe('function');
  const tile = layer.createTile({ z: 1, x: 0, y: 1 }, (error, result) => completed.push({ error, result }));
  await flushTilePromises();
  expect(completed).toHaveLength(1);
  expect(completed[0].error.message).toContain('403');
  expect(completed[0].result).toBe(tile);
  expect(bodyRead).toBe(false);
  expect(urls).toHaveLength(0);
  expect(tile.src).toBeUndefined();
  expect(requests[0].url).toBe('https://tile.openstreetmap.org/1/0/1.png');
  expect(requests[0].options).toMatchObject({ mode: 'cors', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
  expect(requests[0].options).not.toHaveProperty('cache');
});

test.each(['load', 'decode-error'])('tile %s completes once and releases its object URL', async outcome => {
  const ui = loadUI(), completed = [];
  ui.context.fetch = async () => ({ ok: true, blob: async () => new Blob(['PNG'], { type: 'image/png' }) });
  const { layer, urls, revoked } = tileTransport(ui);
  expect(typeof layer.createTile).toBe('function');
  const tile = layer.createTile({ z: 1, x: 0, y: 1 }, (error, result) => completed.push({ error, result }));
  await flushTilePromises();
  expect(tile.src).toBe('blob:fixture-1');
  expect(revoked).toHaveLength(0);
  if (outcome === 'load') tile.onload(); else tile.onerror();
  expect(completed).toHaveLength(1);
  expect(!!completed[0].error).toBe(outcome === 'decode-error');
  expect(completed[0].result).toBe(tile);
  expect(revoked).toEqual(urls);
  layer.handlers.tileunload({ tile });
  expect(revoked).toHaveLength(1);
});

test.each(['response', 'blob'])('unloading a tile aborts pending %s work and ignores late completion', async phase => {
  const ui = loadUI(), completed = [];
  let finish, signal;
  ui.context.fetch = (_url, options) => {
    signal = options.signal;
    if (phase === 'response') return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ ok: true, blob: () => new Promise(resolve => { finish = resolve; }) });
  };
  const { layer, urls, revoked } = tileTransport(ui);
  expect(typeof layer.createTile).toBe('function');
  const tile = layer.createTile({ z: 1, x: 0, y: 1 }, (...args) => completed.push(args));
  await flushTilePromises();
  layer.handlers.tileunload({ tile });
  expect(signal.aborted).toBe(true);
  finish(phase === 'response' ? { ok: true, blob: async () => new Blob(['PNG']) } : new Blob(['PNG']));
  await flushTilePromises();
  expect(completed).toHaveLength(0);
  expect(urls).toHaveLength(0);
  expect(revoked).toHaveLength(0);
  expect(tile.src).toBeUndefined();
});

test.each(['tileunload', 'tileabort'])('%s before decode aborts work, releases the object URL and suppresses late image completion', async event => {
  const ui = loadUI(), completed = [];
  let signal;
  ui.context.fetch = async (_url, options) => { signal = options.signal; return { ok: true, blob: async () => new Blob(['PNG']) }; };
  const { layer, urls, revoked } = tileTransport(ui);
  const tile = layer.createTile({ z: 1, x: 0, y: 1 }, (...args) => completed.push(args));
  await flushTilePromises();
  expect(tile.src).toBe('blob:fixture-1');
  const lateLoad = tile.onload;
  // Leaflet 1.9.4 replaces image handlers before firing tileabort during zoom.
  if (event === 'tileabort') tile.onload = tile.onerror = () => {};
  layer.handlers[event]?.({ tile });
  expect(signal.aborted).toBe(true);
  expect(revoked).toEqual(urls);
  expect(tile.onload).toBe(null);
  expect(tile.onerror).toBe(null);
  lateLoad();
  expect(completed).toHaveLength(0);
});

test('a CORS or network failure ends the tile request without bypass or automatic retries', async () => {
  const ui = loadUI(), completed = [];
  let requests = 0;
  ui.context.fetch = async () => { requests++; throw new TypeError('Failed to fetch'); };
  const { layer, urls } = tileTransport(ui);
  const tile = layer.createTile({ z: 1, x: 0, y: 1 }, (error, result) => completed.push({ error, result }));
  await flushTilePromises();
  expect(requests).toBe(1);
  expect(completed).toHaveLength(1);
  expect(completed[0].error).toBeInstanceOf(TypeError);
  expect(completed[0].result).toBe(tile);
  expect(tile.src).toBeUndefined();
  expect(urls).toHaveLength(0);
});
