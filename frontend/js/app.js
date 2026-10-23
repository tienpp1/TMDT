let currentUser = null;
let currentSiteId = null;
let pollInterval = null;
let chartInstance = null;
let leafletMap = null;
let mapMarkers = {};
let mapZoomed = false;
let regionLayers = [];
let refreshInFlight = false;
let sessionGeneration = 0;
let demoTimer = null;
let demoInFlight = false;
let historyPage = 1;
let adminDevicesCache = [];

// Every substitution in HTML templates is text unless explicitly trusted UI markup.
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function html(strings, ...values) {
  return strings.reduce((result, text, index) => result + text + (index < values.length ? (values[index]?.trustedHTML ?? escapeHTML(values[index])) : ''), '');
}
function trusted(markup) { return { trustedHTML: markup }; }
function isSiteManager() {
  return !!currentUser?.sites?.some(site => site.id === currentSiteId && site.role === 'manager');
}
function formatTime(value) {
  if (!value) return 'Chưa có';
  const normalized = /^\d{4}-\d{2}-\d{2} \d/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 'Không xác định' : date.toLocaleString('vi-VN');
}
function readingLevel(reading) {
  return reading.quality === 'ok' && reading.level_cm !== null && reading.level_cm !== undefined && Number.isFinite(Number(reading.level_cm)) ? Number(reading.level_cm) : null;
}
function setConnectionState(ok, message) {
  const status = document.getElementById('connection-status');
  const banner = document.getElementById('connection-error');
  if (status) status.classList.toggle('online', ok);
  if (banner) {
    banner.textContent = ok ? '' : (message || 'Không thể cập nhật. Số liệu đang hiển thị là dữ liệu cũ.');
    banner.classList.toggle('hidden', ok);
  }
}
function updatePermissions() {
  const manager = isSiteManager();
  elements.userRole.textContent = manager ? 'Quản lý' : 'Nhân viên';
  document.querySelectorAll('.manager-only').forEach(el => el.classList.toggle('hidden', !manager));
}
function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
  document.getElementById('sidebar-backdrop')?.classList.add('hidden');
}
function navigate(pageId) {
  if ((pageId === 'settings' || pageId === 'water-levels') && !isSiteManager()) pageId = 'dashboard';
  elements.navItems.forEach(item => item.classList.toggle('active', item.getAttribute('data-page') === pageId));
  elements.pages.forEach(page => page.classList.toggle('hidden', page.id !== `page-${pageId}`));
  closeSidebar();
  if (pageId === 'dashboard') setTimeout(() => leafletMap?.invalidateSize(), 100);
  if (currentSiteId) pollData();
}

const elements = {
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  userName: document.getElementById('user-name'),
  userRole: document.getElementById('user-role'),
  logoutBtn: document.getElementById('logout-btn'),
  siteSelector: document.getElementById('site-selector'),
  lastUpdated: document.getElementById('last-updated-time'),
  notificationBtn: document.getElementById('notification-btn'),
  notificationBadge: document.getElementById('notification-badge'),
  
  // Dashboard
  kpiTotalDevices: document.getElementById('kpi-total-devices'),
  kpiActiveAlerts: document.getElementById('kpi-active-alerts'),
  kpiActiveIncidents: document.getElementById('kpi-active-incidents'),
  kpiOfflineDevices: document.getElementById('kpi-offline-devices'),
  priorityBanner: document.getElementById('priority-banner'),
  dashboardDevicesGrid: document.getElementById('dashboard-devices-grid'),
  
  // Tabs
  navItems: document.querySelectorAll('.nav-item'),
  pages: document.querySelectorAll('.page'),
  
  // Alerts
  alertsTbody: document.getElementById('alerts-tbody'),
  // Incidents
  incidentsTbody: document.getElementById('incidents-tbody'),
  
  // Maps
  mapPoint1: document.getElementById('map-point-1'),
  mapPoint2: document.getElementById('map-point-2'),
  mapPoint3: document.getElementById('map-point-3'),
};

async function init() {
  try {
    currentUser = await api.getMe();
    showApp();
    loadSites();
  } catch (err) {
    showLogin();
  }
}

function showLogin() {
  sessionGeneration++;
  currentUser = null;
  currentSiteId = null;
  latestDevicesList = [];
  historyStatsCache = [];
  adminDevicesCache = [];
  window.devicesCache = [];
  if (window.evtSource) window.evtSource.close();
  window.evtSource = null;
  stopDemo(false);
  elements.loginView.classList.remove('hidden');
  elements.appView.classList.add('hidden');
  elements.siteSelector.innerHTML = '';
  elements.lastUpdated.textContent = 'Cập nhật: --:--:--';
  [elements.kpiTotalDevices, elements.kpiActiveAlerts, elements.kpiActiveIncidents, elements.kpiOfflineDevices].forEach(element => { element.textContent = '0'; });
  elements.priorityBanner.textContent = '';
  elements.priorityBanner.classList.add('hidden');
  elements.notificationBadge.style.display = 'none';
  setConnectionState(true);
  document.getElementById('connection-status').classList.remove('online');
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
  document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.remove('active'));
  ['dashboard-devices-grid', 'alerts-tbody', 'incidents-tbody', 'admin-devices-tbody', 'admin-users-tbody', 'admin-audit-tbody', 'history-readings-tbody', 'reports-devices-tbody', 'water-levels-devices-grid'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = '';
  });
  const key = document.getElementById('provisioning-key');
  if (key) key.value = '';
  document.getElementById('staff-password').value = '';
  document.getElementById('provisioning-device').value = '';
  document.getElementById('password').value = '';
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (historyChartInstance) { historyChartInstance.destroy(); historyChartInstance = null; }
  mapMarkers = {};
  regionLayers = [];
  mapZoomed = false;
  lastRegionFingerprint = '';
  closeSidebar();
  elements.pages.forEach(page => page.classList.toggle('hidden', page.id !== 'page-dashboard'));
  elements.navItems.forEach(item => item.classList.toggle('active', item.getAttribute('data-page') === 'dashboard'));
}

function showApp() {
  elements.loginView.classList.add('hidden');
  elements.appView.classList.remove('hidden');
  elements.userName.textContent = currentUser.display_name;
  elements.lastUpdated.textContent = 'Đang tải dữ liệu…';
  
  updatePermissions();
}

elements.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  elements.loginError.textContent = '';
  
  try {
    currentUser = await api.login(email, password);
    document.getElementById('password').value = '';
    showApp();
    await loadSites();
  } catch (err) {
    elements.loginError.textContent = err.message;
  }
});

elements.logoutBtn.addEventListener('click', async () => {
  try {
    await api.logout();
    currentUser = null;
    showLogin();
  } catch (err) {
    console.error('Lỗi đăng xuất', err);
  }
});

// Navigation
elements.navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(item.getAttribute('data-page'));
  });
});

elements.siteSelector.addEventListener('change', (e) => {
  stopDemo(false);
  sessionGeneration++;
  currentSiteId = e.target.value;
  latestDevicesList = [];
  historyStatsCache = [];
  adminDevicesCache = [];
  mapZoomed = false;
  lastRegionFingerprint = '';
  updatePermissions();
  if (!isSiteManager()) navigate('dashboard');
  pollData();
});
document.getElementById('menu-toggle')?.addEventListener('click', () => {
  const open = document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', String(open));
  document.getElementById('sidebar-backdrop').classList.toggle('hidden', !open);
});
document.getElementById('sidebar-backdrop')?.addEventListener('click', closeSidebar);
elements.notificationBtn.addEventListener('click', () => navigate('alerts'));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(modal => closeModal(modal.id));
    closeSidebar();
  }
});

// Setup Server-Sent Events (SSE)
function setupSSE() {
  if (window.evtSource) {
    window.evtSource.close();
  }
  
  if (!currentUser || typeof EventSource === 'undefined') return;
  window.evtSource = new EventSource('/api/events');
  window.evtSource.onmessage = function(event) {
    try {
      if (JSON.parse(event.data).type === 'update' && currentSiteId) pollData();
    } catch (_) { /* Malformed events do not interrupt the polling fallback. */ }
  };
  
  window.evtSource.onerror = function(err) {
    // Native EventSource reconnects; the five-second polling fallback continues.
  };
}

async function loadSites() {
  try {
    const sites = currentUser.sites || []; // From /me
    elements.siteSelector.innerHTML = '';
    sites.forEach(site => {
      const option = document.createElement('option');
      option.value = site.id;
      option.textContent = site.name;
      elements.siteSelector.appendChild(option);
    });
    
    if (sites.length > 0) {
      currentSiteId = sites[0].id;
      updatePermissions();
      initMap();
      await pollData();
      setupSSE();
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(pollData, 5000);
    } else {
      setConnectionState(false, 'Tài khoản chưa được phân quyền vào cơ sở. Liên hệ quản lý.');
    }
  } catch (err) {
    setConnectionState(false, 'Không thể tải cơ sở. Vui lòng thử lại.');
  }
}

let latestDevicesList = [];

async function pollData() {
  if (!currentSiteId || refreshInFlight) return;
  refreshInFlight = true;
  const siteId = currentSiteId;
  const generation = sessionGeneration;
  try {
    const [overview, alerts, incidents] = await Promise.all([
      api.getSiteOverview(siteId), api.getSiteAlerts(siteId), api.getSiteIncidents(siteId)
    ]);
    if (generation !== sessionGeneration || siteId !== currentSiteId || !currentUser) return;
    
    latestDevicesList = overview.devices || [];
    window.devicesCache = latestDevicesList;

    renderDashboard(overview.devices, alerts, incidents);
    renderAlerts(alerts);
    renderIncidents(incidents);
    updateRegionLayers(latestDevicesList);
    
    // Admin polling if page is active
    if (!document.getElementById('page-settings').classList.contains('hidden')) {
      await loadAdminData();
    }
    
    if (!document.getElementById('page-devices').classList.contains('hidden')) {
      await loadHistoryPage();
    }

    if (!document.getElementById('page-reports').classList.contains('hidden')) {
      await loadReportsData();
    }
    
    if (!document.getElementById('page-water-levels').classList.contains('hidden')) {
      renderWaterLevelsPage();
    }
    
    elements.lastUpdated.textContent = `Cập nhật: ${new Date().toLocaleTimeString('vi-VN')}`;
    setConnectionState(true);
  } catch (err) {
    if (generation === sessionGeneration) setConnectionState(false, 'Mất kết nối cập nhật. Giữ số liệu cũ; không thể kết luận mực nước hiện tại.');
  } finally {
    refreshInFlight = false;
    if (generation !== sessionGeneration && currentUser && currentSiteId) pollData();
  }
}

let lastRegionFingerprint = '';

function updateRegionLayers(devices, force = false) {
  if (!leafletMap) return;

  const validDevices = (devices || []).filter(d => d.lat !== null && d.lng !== null && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)));
  const fingerprint = validDevices.map(d => `${d.id}-${d.lat}-${d.lng}-${d.zone_radius_km}-${d.risk_level}`).join('|');

  const toggleCheckbox = document.getElementById('toggle-regions');
  const showRegions = toggleCheckbox ? toggleCheckbox.checked : true;

  if (!showRegions) {
    if (regionLayers.length > 0) {
      regionLayers.forEach(layer => leafletMap.removeLayer(layer));
      regionLayers = [];
      lastRegionFingerprint = 'hidden';
    }
    return;
  }

  if (fingerprint === lastRegionFingerprint && !force && regionLayers.length > 0) {
    return; // Keep existing circles without flickering
  }
  lastRegionFingerprint = fingerprint;

  // Remove old layers
  regionLayers.forEach(layer => leafletMap.removeLayer(layer));
  regionLayers = [];

  validDevices.forEach(d => {
    const radiusMeters = (parseFloat(d.zone_radius_km) || 1.5) * 1000;
    const risk = Number(d.risk_level) || 1;

    let color = '#22c55e';
    let riskText = 'Xanh (Mức 1 - Thoát nhanh)';
    if (risk === 5) {
      color = '#ef4444';
      riskText = 'Đỏ (Mức 5 - Trũng thấp/Ngập nhanh)';
    } else if (risk === 3) {
      color = '#fbbf24';
      riskText = 'Vàng (Mức 3 - Ngập vừa)';
    }

    const circle = L.circle([d.lat, d.lng], {
      color: color,
      fillColor: color,
      fillOpacity: 0.22,
      radius: radiusMeters,
      weight: 2
    }).addTo(leafletMap);

    circle.bindTooltip(html`<strong>${d.name}</strong><br/>Vùng minh họa ${riskText}<br/>Bán kính: ${(parseFloat(d.zone_radius_km) || 1.5).toFixed(1)} km`, { 
      direction: 'top',
      sticky: true
    });

    regionLayers.push(circle);
  });
}

function addMapTiles(map, statusId, message) {
  const status = document.getElementById(statusId);
  const failedTiles = new Set();
  const pendingTiles = new WeakMap();
  const updateStatus = () => {
    if (!status) return;
    status.textContent = failedTiles.size ? message : '';
    status.classList.toggle('hidden', !failedTiles.size);
  };
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    referrerPolicy: 'strict-origin-when-cross-origin'
  });
  // A 403 response can contain a decodable PNG. Check HTTP status before showing it.
  tiles.createTile = function(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    tile.referrerPolicy = 'strict-origin-when-cross-origin';
    const controller = new AbortController();
    let disposed = false, completed = false, objectURL = null;
    const releaseURL = () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = null;
    };
    const complete = error => {
      if (disposed || completed) return;
      completed = true;
      tile.onload = tile.onerror = null;
      releaseURL();
      pendingTiles.delete(tile);
      done(error, tile);
    };
    pendingTiles.set(tile, () => {
      disposed = true;
      controller.abort();
      tile.onload = tile.onerror = null;
      releaseURL();
    });
    Promise.resolve().then(async () => {
      if (disposed) return;
      const response = await fetch(this.getTileUrl(coords), {
        mode: 'cors', credentials: 'omit',
        referrerPolicy: 'strict-origin-when-cross-origin', signal: controller.signal
      });
      if (disposed) return;
      if (!response.ok) throw new Error(`Không tải được nền bản đồ (HTTP ${response.status})`);
      const blob = await response.blob();
      if (disposed) return;
      objectURL = URL.createObjectURL(blob);
      tile.onload = () => complete(null);
      tile.onerror = () => complete(new Error('Không đọc được ảnh nền bản đồ'));
      tile.src = objectURL;
    }).catch(error => {
      if (!disposed && error.name !== 'AbortError') complete(error);
    });
    return tile;
  };
  tiles.on('tileerror', event => {
    // Hide provider error images; measurement markers belong to separate layers.
    event.tile.style.visibility = 'hidden';
    failedTiles.add(event.tile);
    updateStatus();
  });
  tiles.on('tileload', event => {
    event.tile.style.visibility = '';
    failedTiles.delete(event.tile);
    updateStatus();
  });
  tiles.on('tileunload tileabort', event => {
    pendingTiles.get(event.tile)?.();
    pendingTiles.delete(event.tile);
    failedTiles.delete(event.tile);
    updateStatus();
  });
  return tiles.addTo(map);
}

function initMap() {
  if (leafletMap) return;
  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl) return;
  if (typeof L === 'undefined') {
    mapEl.textContent = 'Không tải được bản đồ. Các số đo và cảnh báo vẫn có thể theo dõi trong danh sách.';
    return;
  }

  leafletMap = L.map('leaflet-map', {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView([10.770, 106.675], 11);
  
  addMapTiles(leafletMap, 'dashboard-map-status', 'Không tải được nền bản đồ. Điểm đo và số liệu vẫn được giữ.');

  // Multiple invalidateSize ticks to ensure container dimensions are tracked across layout passes
  [50, 200, 600, 1500].forEach(delay => {
    setTimeout(() => {
      if (leafletMap) {
        leafletMap.invalidateSize();
      }
    }, delay);
  });
}


window.app = {
  toggleRegions: function() {
    lastRegionFingerprint = '';
    updateRegionLayers(latestDevicesList, true);
  }
};
async function sendDemoSample() {
  if (!isSiteManager() || demoInFlight || !currentSiteId) return;
  const generation = sessionGeneration;
  const scenario = document.getElementById('demo-scenario').value;
  const deviceId = document.getElementById('demo-device').value;
  const payload = { scenario };
  if (deviceId && deviceId !== 'all') payload.device_id = deviceId;
  if (scenario === 'custom') {
    payload.level_cm = Number(document.getElementById('demo-level').value);
    if (!Number.isFinite(payload.level_cm) || payload.level_cm < 0 || payload.level_cm > 90) {
      showToast('Mực nước phải nằm trong khoảng 0–90 cm.', 'error');
      return;
    }
  }
  demoInFlight = true;
  try {
    await api.sendDemoSample(currentSiteId, payload);
    if (generation !== sessionGeneration) return;
    document.getElementById('demo-status').textContent = 'Đã gửi một mẫu lúc ' + new Date().toLocaleTimeString('vi-VN') + (demoTimer ? ' · Đang chạy mỗi 5 giây.' : ' · Đang dừng.');
    await pollData();
  } catch (error) {
    if (generation === sessionGeneration) {
      stopDemo(false);
      document.getElementById('demo-status').textContent = 'Đã dừng do không gửi được dữ liệu.';
      showToast(error.message, 'error');
    }
  } finally {
    demoInFlight = false;
  }
}
function startDemo() {
  if (!isSiteManager()) return;
  stopDemo(false);
  demoTimer = setInterval(sendDemoSample, 5000);
  document.getElementById('demo-start').disabled = true;
  sendDemoSample();
}
function stopDemo(showStatus = true) {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = null;
  const button = document.getElementById('demo-start');
  if (button) button.disabled = false;
  if (showStatus) document.getElementById('demo-status').textContent = 'Đã dừng gửi. Điểm đo sẽ mất kết nối sau 30 giây nếu không có nguồn dữ liệu khác.';
}



function renderDashboard(devices = [], alerts = [], incidents = []) {
  window.devicesCache = devices;
  const activeAlerts = alerts.filter(alert => !alert.resolved_at);
  const unackedAlerts = activeAlerts.filter(alert => !alert.ack_at);
  elements.kpiTotalDevices.textContent = devices.filter(device => device.is_active !== 0).length;
  elements.kpiActiveAlerts.textContent = activeAlerts.length;
  elements.kpiActiveIncidents.textContent = incidents.filter(incident => incident.status !== 'completed').length;
  elements.kpiOfflineDevices.textContent = devices.filter(device => ['offline', 'no_data', 'stale', 'sensor_error'].includes(device.data_status)).length;
  elements.priorityBanner.classList.toggle('hidden', !unackedAlerts.length);
  elements.priorityBanner.textContent = 'Cảnh báo ưu tiên: Có ' + unackedAlerts.length + ' cảnh báo chưa xác nhận.';
  elements.notificationBadge.style.display = unackedAlerts.length ? 'block' : 'none';
  elements.notificationBadge.textContent = unackedAlerts.length;

  elements.dashboardDevicesGrid.innerHTML = '';
  if (!devices.length) elements.dashboardDevicesGrid.textContent = 'Chưa có điểm đo trong cơ sở.';
  const template = document.getElementById('device-card-template');
  const ids = new Set(devices.map(device => device.id));
  Object.keys(mapMarkers).forEach(id => {
    if (!ids.has(id)) {
      if (leafletMap) leafletMap.removeLayer(mapMarkers[id]);
      delete mapMarkers[id];
    }
  });
  const labels = [], levels = [];
  devices.forEach(device => {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.device-card');
    clone.querySelector('.device-name').textContent = device.point_label || device.name;
    const hasFreshLevel = device.data_status === 'online' && device.latest_quality === 'ok' && device.latest_level_cm !== null && device.latest_level_cm !== undefined;
    const alertLevel = ['warning', 'critical'].includes(device.current_alert_level) ? device.current_alert_level : 'normal';
    const statusClass = device.data_status !== 'online' ? 'status-offline' : 'status-' + alertLevel;
    card.classList.add(statusClass);
    const alertLabel = alertLevel === 'critical' ? 'NGUY HIỂM' : (alertLevel === 'warning' ? 'CẢNH BÁO' : 'Chưa vượt ngưỡng');
    clone.querySelector('.device-badge').textContent = device.data_status === 'online' ? alertLabel : getStatusLabel(device.data_status) + (alertLevel !== 'normal' ? ' · ' + alertLabel : '');
    clone.querySelector('.level-value').textContent = hasFreshLevel ? device.latest_level_cm : '--';
    clone.querySelector('.quality-indicator').classList.add(hasFreshLevel ? 'ok' : 'error');
    clone.querySelector('.quality-text').textContent = hasFreshLevel ? 'Tín hiệu tốt' : getStatusLabel(device.data_status);
    clone.querySelector('.time').textContent = formatTime(device.latest_measured_at);
    clone.querySelector('.time').title = 'Máy chủ nhận: ' + formatTime(device.latest_received_at);
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'btn btn-sm btn-outline';
    details.textContent = 'Xem lịch sử';
    details.addEventListener('click', () => {
      navigate('devices');
      const select = document.getElementById('history-device-select');
      select.value = device.id;
      loadHistoryPage(device.id);
    });
    card.appendChild(details);
    elements.dashboardDevicesGrid.appendChild(clone);
    labels.push(device.point_label || device.name);
    levels.push(hasFreshLevel ? Number(device.latest_level_cm) : null);

    if (leafletMap && device.lat !== null && device.lng !== null && Number.isFinite(Number(device.lat)) && Number.isFinite(Number(device.lng))) {
      const color = !hasFreshLevel ? '#6b7280' : (alertLevel === 'critical' ? '#ef4444' : (alertLevel === 'warning' ? '#f59e0b' : '#10b981'));
      const icon = L.divIcon({ html: html`<div style="width:20px;height:20px;background:${color};border:2px solid white;border-radius:50%"></div>`, className: '', iconSize: [24,24], iconAnchor: [12,12] });
      if (mapMarkers[device.id]) {
        mapMarkers[device.id].setLatLng([device.lat, device.lng]).setIcon(icon);
      } else {
        mapMarkers[device.id] = L.marker([device.lat, device.lng], { icon }).addTo(leafletMap);
      }
      mapMarkers[device.id].bindPopup(html`<strong>${device.name}</strong><br>Mực nước: ${hasFreshLevel ? device.latest_level_cm : '--'} cm<br>${getStatusLabel(device.data_status)} · ${alertLabel}<br>Đo lúc: ${formatTime(device.latest_measured_at)}`);
    }
  });
  if (leafletMap && Object.keys(mapMarkers).length && !mapZoomed) {
    leafletMap.fitBounds(new L.featureGroup(Object.values(mapMarkers)).getBounds().pad(0.15));
    mapZoomed = true;
  }
  updateChart(labels, levels);
}

function renderAlerts(alerts) {
  elements.alertsTbody.innerHTML = '';
  if (alerts.length === 0) {
    elements.alertsTbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Không có dữ liệu</td></tr>';
    return;
  }
  
  alerts.forEach(alert => {
    const isAcked = !!alert.ack_at;
    const isResolved = !!alert.resolved_at;
    let statusText = (isResolved ? 'Đã kết thúc' : 'Đang diễn ra') + ' · ' + (isAcked ? 'Đã xác nhận' : 'Chưa xác nhận');
    
    const tr = document.createElement('tr');
    tr.innerHTML = html`
      <td>${formatTime(alert.opened_at)}</td>
      <td><span class="badge-level badge-${alert.level}">${alert.level === 'warning' ? 'CẢNH BÁO' : 'NGUY HIỂM'}</span></td>
      <td>${alert.device_name}</td>
      <td><span class="badge-status" style="color: ${isResolved ? 'var(--success)' : (isAcked ? 'var(--warning)' : 'var(--danger)')}">${statusText}</span></td>
      <td>${alert.ack_at ? (alert.ack_by_name || alert.ack_name || alert.ack_by || 'Đã xác nhận') + ' · ' + formatTime(alert.ack_at) : '--'}</td>
      <td>
        ${trusted(!isAcked && !isResolved ? html`<button class="btn btn-sm btn-outline" data-action="ack-alert" data-id="${alert.id}">Xác nhận</button>` : '')}
      </td>
    `;
    elements.alertsTbody.appendChild(tr);
  });
}

// Toast Notification System
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  let icon = 'check-circle';
  if (type === 'error') icon = 'exclamation-circle';
  else if (type === 'info') icon = 'info-circle';
  toast.innerHTML = html`<i aria-hidden="true" class="fas fa-${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('active');
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('active');
  if (modalId === 'modal-provisioning') document.getElementById('provisioning-key').value = '';
  if (modalId === 'modal-staff') document.getElementById('staff-password').value = '';
}

// Close modal when clicking outside dialog
document.querySelectorAll('.modal-overlay').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal.id);
    }
  });
});

function renderIncidents(incidents) {
  elements.incidentsTbody.innerHTML = '';
  if (!incidents || incidents.length === 0) {
    elements.incidentsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Chưa có sự cố nào được ghi nhận</td></tr>';
    return;
  }
  
  const isManager = isSiteManager();

  incidents.forEach(incident => {
    let statusBadge = '<span class="badge-status" style="color:var(--warning); background:rgba(245,158,11,0.1); padding:2px 8px; border-radius:4px;">Chờ xử lý</span>';
    if (incident.status === 'in_progress') {
      statusBadge = '<span class="badge-status" style="color:var(--info); background:rgba(59,130,246,0.1); padding:2px 8px; border-radius:4px;">Đang xử lý</span>';
    } else if (incident.status === 'completed') {
      statusBadge = '<span class="badge-status" style="color:var(--success); background:rgba(16,185,129,0.1); padding:2px 8px; border-radius:4px;">Đã hoàn tất</span>';
    }

    const deviceName = incident.device_name ? `${incident.device_name}` : (incident.device_point_label || '--');
    const title = incident.title || (incident.episode_id ? `Cảnh báo ngập (${incident.episode_id.slice(0, 8)})` : 'Sự cố ngập nước');
    const reporter = incident.reporter_name || 'Hệ thống tự động';
    const assignee = incident.assignee_name || 'Chưa phân công';

    const tr = document.createElement('tr');
    tr.innerHTML = html`
      <td style="font-size:0.75rem; font-family:monospace;">${incident.id ? incident.id.slice(0, 8) : '--'}</td>
      <td><strong>${deviceName}</strong></td>
      <td>${title}</td>
      <td>${trusted(statusBadge)}</td>
      <td>${reporter}</td>
      <td>${assignee}</td>
      <td>${formatTime(incident.created_at)}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-outline" data-action="incident-notes" data-id="${incident.id}" title="Xem chi tiết & Ghi chú"><i aria-hidden="true" class="fas fa-eye"></i> Chi tiết</button>
          ${trusted(isManager && incident.status !== 'completed' ? html`<button class="btn btn-sm btn-primary" data-action="assign-staff" data-id="${incident.id}" title="Phân công nhân sự"><i aria-hidden="true" class="fas fa-user-check"></i> Phân công</button>` : '')}
          ${trusted(!isManager && !incident.assignee_id && incident.status !== 'completed' ? html`<button class="btn btn-sm btn-outline" data-action="take-incident" data-id="${incident.id}">Nhận việc</button>` : '')}
        </div>
      </td>
    `;
    elements.incidentsTbody.appendChild(tr);
  });
}

window.ackAlert = async function(alertId) {
  try {
    await api.ackAlert(alertId);
    showToast('Đã xác nhận cảnh báo!');
    pollData();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
};

window.assignIncident = async function(incidentId) {
  try {
    await api.assignIncident(incidentId);
    showToast('Đã nhận xử lý sự cố thành công!');
    pollData();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
};

// Map Picker for Device Modal
let pickerMap = null;
let pickerMarker = null;
let pickerCircle = null;

function initPickerMap(lat = 10.770, lng = 106.675, radiusKm = 1.5, risk = 1) {
  document.getElementById('dev-modal-lat').value = lat;
  document.getElementById('dev-modal-lng').value = lng;
  document.getElementById('dev-modal-coords-label').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (typeof L === 'undefined') {
    document.getElementById('dev-modal-map').textContent = 'Không tải được bản đồ. Có thể nhập tọa độ bên dưới.';
    return;
  }
  const container = document.getElementById('dev-modal-map');
  if (!container) return;

  if (!pickerMap) {
    pickerMap = L.map('dev-modal-map').setView([lat, lng], 13);
    addMapTiles(pickerMap, 'picker-map-status', 'Không tải được nền bản đồ. Có thể tiếp tục nhập tọa độ bên dưới.');

    pickerMap.on('click', (e) => {
      setPickerLocation(e.latlng.lat, e.latlng.lng);
    });
  }

  setTimeout(() => {
    pickerMap.invalidateSize();
    pickerMap.setView([lat, lng], 13);
    setPickerLocation(lat, lng, radiusKm, risk);
  }, 200);
}

function setPickerLocation(lat, lng, radiusKm = null, risk = null) {
  const curRadius = radiusKm !== null ? radiusKm : (parseFloat(document.getElementById('dev-modal-radius-slider')?.value) || 1.5);
  const curRisk = risk !== null ? risk : (parseInt(document.getElementById('dev-modal-risk')?.value) || 1);

  document.getElementById('dev-modal-lat').value = lat.toFixed(6);
  document.getElementById('dev-modal-lng').value = lng.toFixed(6);
  document.getElementById('dev-modal-coords-label').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  let color = '#22c55e';
  if (curRisk === 5) color = '#ef4444';
  else if (curRisk === 3) color = '#fbbf24';

  if (!pickerMarker) {
    pickerMarker = L.marker([lat, lng], { draggable: true }).addTo(pickerMap);
    pickerMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setPickerLocation(pos.lat, pos.lng);
    });
  } else {
    pickerMarker.setLatLng([lat, lng]);
  }

  if (!pickerCircle) {
    pickerCircle = L.circle([lat, lng], {
      radius: curRadius * 1000,
      color: color,
      fillColor: color,
      fillOpacity: 0.25,
      weight: 2
    }).addTo(pickerMap);
  } else {
    pickerCircle.setLatLng([lat, lng]);
    pickerCircle.setRadius(curRadius * 1000);
    pickerCircle.setStyle({ color: color, fillColor: color });
  }
}

window.updateDeviceModalRadius = function(val) {
  document.getElementById('dev-modal-radius-val').textContent = `${parseFloat(val).toFixed(1)} km`;
  if (pickerCircle) {
    pickerCircle.setRadius(parseFloat(val) * 1000);
  }
};

window.selectRiskLevel = function(risk) {
  document.getElementById('dev-modal-risk').value = risk;
  document.querySelectorAll('.risk-option').forEach(el => el.classList.remove('selected'));
  const selectedEl = document.getElementById(`risk-opt-${risk}`);
  if (selectedEl) selectedEl.classList.add('selected');

  let color = '#22c55e';
  if (risk === 5) color = '#ef4444';
  else if (risk === 3) color = '#fbbf24';

  if (pickerCircle) {
    pickerCircle.setStyle({ color: color, fillColor: color });
  }
};

window.openAddDeviceModal = function() {
  if (!isSiteManager()) return;
  document.getElementById('device-modal-title').textContent = 'Thêm điểm đo mới';
  document.getElementById('dev-modal-id').value = '';
  document.getElementById('dev-modal-name').value = '';
  document.getElementById('dev-modal-point').value = '';
  document.getElementById('dev-modal-radius-slider').value = '1.5';
  document.getElementById('dev-modal-radius-val').textContent = '1.5 km';
  document.getElementById('dev-modal-warn').value = '10';
  document.getElementById('dev-modal-crit').value = '20';
  document.getElementById('dev-modal-clr').value = '7';
  document.getElementById('dev-modal-samples').value = '3';
  document.getElementById('dev-modal-rule-version').value = '';
  selectRiskLevel(1);

  openModal('modal-device');
  initPickerMap(10.775, 106.685, 1.5, 1);
};

window.openEditDeviceModal = function(deviceId) {
  if (!isSiteManager()) return;
  const dev = adminDevicesCache.find(d => d.id === deviceId) || latestDevicesList.find(d => d.id === deviceId);
  if (!dev) return;

  document.getElementById('device-modal-title').textContent = `Tùy chỉnh Thông số: ${dev.name}`;
  document.getElementById('dev-modal-id').value = dev.id;
  document.getElementById('dev-modal-name').value = dev.name;
  document.getElementById('dev-modal-point').value = dev.point_label || '';
  const radius = parseFloat(dev.zone_radius_km) || 1.5;
  document.getElementById('dev-modal-radius-slider').value = radius;
  document.getElementById('dev-modal-radius-val').textContent = `${radius.toFixed(1)} km`;
  document.getElementById('dev-modal-warn').value = dev.warning_cm ?? 10;
  document.getElementById('dev-modal-crit').value = dev.critical_cm ?? 20;
  document.getElementById('dev-modal-clr').value = dev.clear_cm ?? 7;
  document.getElementById('dev-modal-samples').value = dev.sample_count ?? 3;
  document.getElementById('dev-modal-rule-version').value = dev.rule_version ?? dev.version ?? 1;
  selectRiskLevel(Number(dev.risk_level) || 1);

  openModal('modal-device');
  initPickerMap(dev.lat || 10.775, dev.lng || 106.685, radius, Number(dev.risk_level) || 1);
};

window.submitDeviceModal = async function() {
  if (!isSiteManager()) return;
  const generation = sessionGeneration;
  const id = document.getElementById('dev-modal-id').value;
  const name = document.getElementById('dev-modal-name').value.trim();
  const point_label = document.getElementById('dev-modal-point').value.trim();
  const lat = parseFloat(document.getElementById('dev-modal-lat').value);
  const lng = parseFloat(document.getElementById('dev-modal-lng').value);
  const zone_radius_km = parseFloat(document.getElementById('dev-modal-radius-slider').value);
  const risk_level = parseInt(document.getElementById('dev-modal-risk').value);
  const warning_cm = parseFloat(document.getElementById('dev-modal-warn').value);
  const critical_cm = parseFloat(document.getElementById('dev-modal-crit').value);
  const clear_cm = parseFloat(document.getElementById('dev-modal-clr').value);
  const sample_count = Number(document.getElementById('dev-modal-samples').value);
  const expected_version = Number(document.getElementById('dev-modal-rule-version').value);

  if (!name) {
    showToast('Vui lòng nhập tên bãi xe!', 'error');
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showToast('Vĩ độ phải từ -90 đến 90, kinh độ từ -180 đến 180.', 'error');
    return;
  }
  if (![clear_cm, warning_cm, critical_cm].every(Number.isFinite) || clear_cm < 0 || clear_cm >= warning_cm || warning_cm >= critical_cm || critical_cm > 90 || !Number.isInteger(sample_count) || sample_count < 1 || sample_count > 60) {
    showToast('Cần 0 ≤ ngưỡng kết thúc < cảnh báo Vàng < nguy hiểm Đỏ ≤ 90 cm và 1–60 mẫu liên tiếp.', 'error');
    return;
  }

  try {
    const payload = {
      name,
      point_label,
      lat,
      lng,
      zone_radius_km,
      risk_level
    };

    if (id) {
      const previous = adminDevicesCache.find(device => device.id === id) || latestDevicesList.find(device => device.id === id);
      const ruleChanged = !previous || warning_cm !== Number(previous.warning_cm) || critical_cm !== Number(previous.critical_cm) || clear_cm !== Number(previous.clear_cm) || sample_count !== Number(previous.sample_count);
      if (ruleChanged) await api.updateRule(id, { warning_cm, critical_cm, clear_cm, sample_count, expected_version });
      if (generation !== sessionGeneration) return;
      await api.updateDevice(id, payload);
      if (generation !== sessionGeneration) return;
      showToast(`Đã cập nhật điểm đo "${name}".`);
    } else {
      const result = await api.addDevice(currentSiteId, { ...payload, warning_cm, critical_cm, clear_cm, sample_count });
      if (generation !== sessionGeneration) return;
      document.getElementById('provisioning-device').value = result.id;
      document.getElementById('provisioning-key').value = result.key;
      openModal('modal-provisioning');
      showToast(`Đã thêm điểm đo "${name}". Lưu khóa kết nối trước khi đóng cửa sổ.`);
    }

    closeModal('modal-device');
    loadAdminData();
    pollData();
  } catch (err) {
    if (generation !== sessionGeneration) return;
    showToast('Lỗi: ' + err.message, 'error');
    if (err.status === 409) {
      await loadAdminData();
      showToast('Cấu hình đã được người khác thay đổi. Mở lại form để dùng phiên bản mới.', 'info');
    }
  }
};

window.openDeleteDeviceModal = function(deviceId, deviceName) {
  if (!isSiteManager()) return;
  document.getElementById('delete-device-id').value = deviceId;
  document.getElementById('delete-device-name').textContent = deviceName;
  openModal('modal-delete-device');
};

window.confirmDeleteDevice = async function() {
  if (!isSiteManager()) return;
  const id = document.getElementById('delete-device-id').value;
  try {
    await api.deleteDevice(id);
    showToast('Đã vô hiệu hóa điểm đo. Lịch sử được giữ lại.');
    closeModal('modal-delete-device');
    loadAdminData();
    pollData();
  } catch (err) {
    showToast('Lỗi khi xóa: ' + err.message, 'error');
  }
};

window.toggleDeviceStatus = async function(deviceId) {
  if (!isSiteManager()) return;
  try {
    await api.updateDevice(deviceId, { is_active: 1 });
    showToast('Đã kích hoạt lại điểm đo.');
    await loadAdminData();
    pollData();
  } catch (error) { showToast(error.message, 'error'); }
};

// Incidents Report & Assignment Logic
window.openReportIncidentModal = function() {
  const select = document.getElementById('report-modal-device');
  select.innerHTML = '';
  (latestDevicesList || []).filter(d => d.is_active).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.point_label || ''})`;
    select.appendChild(opt);
  });

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('report-modal-time').value = now.toISOString().slice(0, 16);
  document.getElementById('report-modal-author').value = `${currentUser?.display_name || 'Nhân viên'} (${currentUser?.email || ''})`;
  document.getElementById('report-modal-title').value = '';
  document.getElementById('report-modal-note').value = '';

  openModal('modal-report-incident');
};

window.submitReportIncident = async function() {
  const device_id = document.getElementById('report-modal-device').value;
  const title = document.getElementById('report-modal-title').value.trim();
  const reported_at = document.getElementById('report-modal-time').value;
  const note = document.getElementById('report-modal-note').value.trim();

  if (!title) {
    showToast('Vui lòng nhập tiêu đề sự cố!', 'error');
    return;
  }

  try {
    await api.reportIncident(currentSiteId, {
      device_id,
      title,
      reported_at: reported_at ? new Date(reported_at).toISOString() : new Date().toISOString(),
      note
    });

    showToast('Đã gửi báo cáo sự cố thành công!');
    closeModal('modal-report-incident');
    pollData();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
};

window.openAssignStaffModal = async function(preselectedIncidentId = null) {
  if (!isSiteManager()) return;
  const generation = sessionGeneration;
  try {
    const incidents = await api.getSiteIncidents(currentSiteId);
    if (generation !== sessionGeneration) return;
    const pendingIncidents = incidents.filter(i => i.status !== 'completed');

    const incSelect = document.getElementById('assign-modal-incident');
    incSelect.innerHTML = '';
    if (pendingIncidents.length === 0) {
      incSelect.innerHTML = '<option value="">Không có sự cố nào đang chờ xử lý</option>';
    } else {
      pendingIncidents.forEach(inc => {
        const opt = document.createElement('option');
        opt.value = inc.id;
        const devName = inc.device_name || inc.device_point_label || 'Bãi xe';
        opt.textContent = `[${devName}] ${inc.title || inc.episode_id.slice(0, 8)} (${inc.status === 'in_progress' ? 'Đang làm' : 'Mới'})`;
        incSelect.appendChild(opt);
      });
      if (preselectedIncidentId) {
        incSelect.value = preselectedIncidentId;
      }
    }

    const staff = await api.getStaff(currentSiteId);
    if (generation !== sessionGeneration) return;
    const staffSelect = document.getElementById('assign-modal-staff');
    staffSelect.innerHTML = '';
    staff.filter(u => u.is_active && u.role === 'staff').forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.display_name} (${u.role === 'manager' ? 'Quản lý' : 'Nhân viên'}) - ${u.email}`;
      staffSelect.appendChild(opt);
    });

    document.getElementById('assign-modal-note').value = '';
    openModal('modal-assign-staff');
  } catch (err) {
    showToast('Lỗi tải dữ liệu: ' + err.message, 'error');
  }
};

window.submitAssignStaff = async function() {
  if (!isSiteManager()) return;
  const incidentId = document.getElementById('assign-modal-incident').value;
  const assignee_id = document.getElementById('assign-modal-staff').value;
  const manager_note = document.getElementById('assign-modal-note').value.trim();

  if (!incidentId) {
    showToast('Vui lòng chọn sự cố cần phân công!', 'error');
    return;
  }
  if (!assignee_id) {
    showToast('Vui lòng chọn nhân viên!', 'error');
    return;
  }

  try {
    await api.assignStaffToIncident(incidentId, { assignee_id, manager_note });
    showToast('Đã phân công nhân sự giải quyết sự cố!');
    closeModal('modal-assign-staff');
    pollData();
  } catch (err) {
    showToast('Lỗi phân công: ' + err.message, 'error');
  }
};

window.openIncidentNotesModal = async function(incidentId) {
  const generation = sessionGeneration;
  try {
    document.getElementById('incident-notes-id').value = incidentId;
    const incidents = await api.getSiteIncidents(currentSiteId);
    if (generation !== sessionGeneration) return;
    const inc = incidents.find(x => x.id === incidentId);
    if (inc) {
      document.getElementById('incident-notes-title').textContent = `Mã: ${inc.id.slice(0, 8)} | Bãi: ${inc.device_name || '--'} | Tiêu đề: ${inc.title || '--'}`;
      const completeBtn = document.getElementById('incident-complete-btn');
      if (completeBtn) {
        completeBtn.style.display = inc.status === 'completed' || (!isSiteManager() && inc.assignee_id !== currentUser?.id) ? 'none' : 'inline-block';
      }
    }

    const notes = await api.getIncidentNotes(incidentId);
    if (generation !== sessionGeneration) return;
    const listEl = document.getElementById('incident-notes-list');
    listEl.innerHTML = '';
    if (!notes || notes.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:0.5rem;">Chưa có ghi chú nào.</div>';
    } else {
      notes.forEach(n => {
        listEl.innerHTML += html`
          <div class="note-item">
            <div class="note-header">
              <strong style="color:var(--primary);">${n.author_name || 'Hệ thống'}</strong>
              <span>${formatTime(n.created_at)}</span>
            </div>
            <div>${n.note}</div>
          </div>
        `;
      });
    }

    document.getElementById('incident-new-note').value = '';
    openModal('modal-incident-notes');
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
};

window.submitIncidentNote = async function() {
  const incidentId = document.getElementById('incident-notes-id').value;
  const note = document.getElementById('incident-new-note').value.trim();
  if (!note) {
    showToast('Vui lòng nhập nội dung ghi chú!', 'error');
    return;
  }

  try {
    await api.addIncidentNote(incidentId, `[${currentUser?.display_name || 'Nhân viên'}]: ${note}`);
    showToast('Đã thêm ghi chú mới!');
    openIncidentNotesModal(incidentId);
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
};

window.completeIncidentFromModal = async function() {
  const incidentId = document.getElementById('incident-notes-id').value;
  try {
    await api.completeIncident(incidentId);
    showToast('Đã hoàn tất sự cố ngập nước thành công!');
    closeModal('modal-incident-notes');
    pollData();
  } catch (err) {
    showToast('Không thể hoàn tất: ' + err.message, 'error');
  }
};

// History Page Logic (Điểm đo & Lịch sử)
let historyChartInstance = null;
let historyStatsCache = [];


window.loadHistoryPage = async function(preselectedDeviceId = null) {
  if (!currentSiteId) return;
  const siteId = currentSiteId, generation = sessionGeneration;
  const hours = Number(document.getElementById('history-time-range').value) || 24;
  try {
    const result = await api.getHistoryStats(siteId, hours);
    if (generation !== sessionGeneration || siteId !== currentSiteId || hours !== Number(document.getElementById('history-time-range').value || 24)) return;
    historyStatsCache = result || [];
    const select = document.getElementById('history-device-select');
    const selected = preselectedDeviceId || select.value;
    select.innerHTML = '<option value="all">Tất cả điểm đo</option>' + historyStatsCache.map(device => html`<option value="${device.id}">${device.name} (${device.point_label || 'Điểm đo'})</option>`).join('');
    select.value = historyStatsCache.some(device => device.id === selected) ? selected : 'all';
    filterHistoryDisplay();
  } catch (_) {
    document.getElementById('history-readings-tbody').innerHTML = '<tr><td colspan="6">Không tải được lịch sử. Vui lòng thử lại.</td></tr>';
    return false;
  }
};
function filteredHistoryDevices() {
  const hours = Number(document.getElementById('history-time-range')?.value) || 24;
  const cutoff = Date.now() - hours * 3600000;
  return historyStatsCache.map(device => ({
    ...device,
    readings: (device.readings || []).filter(reading => new Date(reading.measured_at).getTime() >= cutoff).sort((a,b) => new Date(a.measured_at) - new Date(b.measured_at))
  }));
}
window.filterHistoryDisplay = function() {
  const selectedId = document.getElementById('history-device-select')?.value || 'all';
  const devices = filteredHistoryDevices().filter(device => selectedId === 'all' || device.id === selectedId);
  const readings = devices.flatMap(device => device.readings.map(reading => ({ ...reading, device_id: device.id, device_name: device.name, warning_cm: device.warning_cm, critical_cm: device.critical_cm }))).sort((a,b) => new Date(b.measured_at) - new Date(a.measured_at));
  const goodLevels = readings.map(readingLevel).filter(level => level !== null);
  const latest = devices.map(device => {
    const live = latestDevicesList.find(item => item.id === device.id);
    if (live) return live.data_status === 'online' && live.latest_quality === 'ok' ? live.latest_level_cm : null;
    return device.current_level;
  }).filter(level => level !== null && level !== undefined && Number.isFinite(Number(level))).map(Number);
  document.getElementById('history-chart-device-name').textContent = selectedId === 'all' ? 'Tất cả điểm đo' : (devices[0]?.name || 'Điểm đo');
  document.getElementById('hist-current-level').textContent = latest.length ? Math.max(...latest).toFixed(1) + ' cm' : '-- cm';
  const peaks = devices.map(device => device.peak_level).filter(value => value !== null && value !== undefined).map(Number);
  const totalGood = devices.reduce((sum,device) => sum + Number(device.quality_count || 0), 0);
  const peak = peaks.length ? Math.max(...peaks) : (goodLevels.length ? Math.max(...goodLevels) : null);
  const average = totalGood ? devices.reduce((sum,device) => sum + Number(device.avg_level || 0) * Number(device.quality_count || 0), 0) / totalGood : (goodLevels.length ? goodLevels.reduce((sum,level) => sum + level, 0) / goodLevels.length : null);
  document.getElementById('hist-peak-level').textContent = peak === null ? '-- cm' : peak.toFixed(1) + ' cm';
  document.getElementById('hist-avg-level').textContent = average === null ? '-- cm' : average.toFixed(1) + ' cm';
  document.getElementById('hist-alerts-count').textContent = devices.reduce((sum,device) => sum + Number(device.alert_count || 0), 0);
  renderHistoryChart(devices, selectedId !== 'all');
  const pageCount = Math.max(1, Math.ceil(readings.length / 50));
  historyPage = Math.max(1, Math.min(historyPage, pageCount));
  const limited = devices.some(device => device.readings_limited);
  document.getElementById('history-page-label').textContent = 'Trang ' + historyPage + '/' + pageCount + ' · ' + readings.length + ' bản ghi' + (limited ? ' · Biểu đồ/bảng/CSV lấy tối đa 2.000 bản gần nhất mỗi điểm; chỉ số tính toàn khoảng.' : '');
  document.getElementById('history-prev').disabled = historyPage === 1;
  document.getElementById('history-next').disabled = historyPage === pageCount;
  const tbody = document.getElementById('history-readings-tbody');
  tbody.innerHTML = readings.length ? '' : '<tr><td colspan="6">Chưa có số đo trong khoảng thời gian đã chọn.</td></tr>';
  const start = (historyPage - 1) * 50;
  readings.slice(start, start + 50).forEach((reading, index) => {
    const level = readingLevel(reading);
    const status = level === null ? 'Không có số đo hợp lệ' : (level >= (reading.critical_cm ?? 20) ? 'NGUY HIỂM ĐỎ' : (level >= (reading.warning_cm ?? 10) ? 'CẢNH BÁO VÀNG' : 'Chưa vượt ngưỡng'));
    const previous = readings.slice(start + index + 1).find(item => item.device_id === reading.device_id);
    const previousLevel = previous ? readingLevel(previous) : null;
    const trend = level === null || previousLevel === null ? '--' : (level > previousLevel ? '↗ Dâng lên' : (level < previousLevel ? '↘ Rút xuống' : '→ Ổn định'));
    const quality = reading.quality === 'sensor_error' ? 'Lỗi cảm biến' : (reading.history_only ? 'Dữ liệu lịch sử' : 'Tốt');
    tbody.innerHTML += html`<tr><td>${formatTime(reading.measured_at)}</td><td><strong>${reading.device_name}</strong></td><td>${level === null ? '--' : level.toFixed(1)}</td><td>${status}</td><td>${quality}</td><td>${trend}</td></tr>`;
  });
};
window.changeHistoryPage = function(delta) { historyPage += delta; filterHistoryDisplay(); };
function renderHistoryChart(devices, single = false) {
  const canvas = document.getElementById('history-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const timestamps = [...new Set(devices.flatMap(device => device.readings.map(reading => new Date(reading.measured_at).getTime())))].sort((a,b) => a - b);
  const datasets = devices.map((device, index) => {
    const color = ['#3b82f6','#f59e0b','#10b981','#a78bfa'][index % 4];
    const points = device.readings.map(reading => ({ x: new Date(reading.measured_at).getTime(), y: readingLevel(reading) })).sort((a,b) => a.x - b.x);
    return { label: device.name, data: points, borderColor: color, backgroundColor: color + '22', spanGaps: false, tension: 0.15, pointRadius: 2 };
  });
  if (single && devices[0]) {
    [['warning_cm', 'Vàng', '#f59e0b', 10], ['critical_cm', 'Đỏ', '#ef4444', 20]].forEach(([field,label,color,fallback]) => datasets.push({
      label: 'Ngưỡng hiện tại ' + label + ' (' + (devices[0][field] ?? fallback) + ' cm)',
      data: timestamps.length ? [timestamps[0], timestamps[timestamps.length - 1]].map(time => ({ x: time, y: devices[0][field] ?? fallback })) : [], borderColor: color, borderDash: [5,5], pointRadius: 0
    }));
  }
  if (historyChartInstance) historyChartInstance.destroy();
  historyChartInstance = new Chart(canvas, { type: 'line', data: { datasets }, options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: {
      x: { type: 'linear', bounds: 'data', ticks: { maxTicksLimit: 5, callback: value => formatTime(new Date(value).toISOString()) } },
      y: { beginAtZero: true, title: { display: true, text: 'cm' } }
    },
    plugins: {
      legend: { labels: { color: '#cbd5e1' } },
      tooltip: { callbacks: { title: items => items.length ? formatTime(new Date(items[0].parsed.x).toISOString()) : '', label: item => item.dataset.label + ': ' + (item.parsed.y ?? '--') + ' cm' } }
    }
  } });
}
window.exportHistoryCSV = function() {
  const selectedId = document.getElementById('history-device-select')?.value || 'all';
  const quote = value => {
    let text = String(value ?? '');
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = [['Thời gian đo', 'Điểm đo', 'Mực nước (cm)', 'Chất lượng', 'Chỉ lịch sử']];
  filteredHistoryDevices().filter(device => selectedId === 'all' || device.id === selectedId).forEach(device => device.readings.forEach(reading => rows.push([
    formatTime(reading.measured_at), device.name, readingLevel(reading) ?? '', reading.quality === 'sensor_error' ? 'Lỗi cảm biến' : 'Tốt', reading.history_only ? 'Có' : 'Không'
  ])));
  if (rows.length === 1) { showToast('Chưa có dữ liệu để xuất.', 'info'); return; }
  const content = '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lich_su_diem_do_' + Date.now() + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(filteredHistoryDevices().some(device => device.readings_limited) ? 'Đã xuất CSV tối đa 2.000 bản gần nhất mỗi điểm trong khoảng đã chọn.' : 'Đã xuất CSV cho khoảng thời gian đã chọn.');
};

function getStatusLabel(status) {
  switch(status) {
    case 'online': return 'Trực tuyến';
    case 'offline': return 'Mất kết nối';
    case 'sensor_error': return 'Lỗi cảm biến';
    case 'stale': return 'Dữ liệu cũ';
    case 'no_data': return 'Chưa có dữ liệu';
    case 'disabled': return 'Vô hiệu hóa';
    default: return 'Không xác định';
  }
}

function updateChart(labels, data) {
  const ctx = document.getElementById('dashboard-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  
  if (!chartInstance) {
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Mực nước hiện tại (cm)',
          data: data,
          backgroundColor: 'rgba(67, 97, 238, 0.5)',
          borderColor: 'rgba(67, 97, 238, 1)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8' }
          }
        },
        plugins: {
          legend: { labels: { color: '#f8fafc' } }
        }
      }
    });
  } else {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.update();
  }
}

// Admin Panel Logic
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(tab.getAttribute('data-target')).classList.remove('hidden');
    loadAdminData();
  });
});

async function loadAdminData() {
  if (!currentSiteId || !isSiteManager()) return;
  const generation = sessionGeneration;
  try {
    const [devices, staff, audit] = await Promise.all([
      api.getDevices(currentSiteId), api.getStaff(currentSiteId), api.getAuditLogs(currentSiteId)
    ]);
    if (generation !== sessionGeneration) return;
    adminDevicesCache = devices;
    renderAdminDevices(devices);
    renderAdminStaff(staff);
    renderAdminAudit(audit);
  } catch (err) {
    if (generation !== sessionGeneration) return;
    ['admin-devices-tbody', 'admin-users-tbody', 'admin-audit-tbody'].forEach(id => {
      document.getElementById(id).innerHTML = '<tr><td colspan="8">Không tải được dữ liệu quản trị. Vui lòng thử lại.</td></tr>';
    });
  }
}

function renderAdminDevices(devices) {
  const tbody = document.getElementById('admin-devices-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  devices.forEach(d => {
    let riskBadge = '<span class="badge-status" style="color:#22c55e;">🟢 Xanh (Mức 1)</span>';
    if (d.risk_level === 5) {
      riskBadge = '<span class="badge-status" style="color:#ef4444; font-weight:bold;">🔴 Đỏ (Mức 5)</span>';
    } else if (d.risk_level === 3) {
      riskBadge = '<span class="badge-status" style="color:#fbbf24; font-weight:bold;">🟡 Vàng (Mức 3)</span>';
    }

    tbody.innerHTML += html`
      <tr>
        <td style="font-size:0.75rem; font-family:monospace;">${d.id.slice(0, 8)}...</td>
        <td><strong>${d.name}</strong><br>${d.is_active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</td>
        <td>${d.point_label || '--'}</td>
        <td><span style="background:rgba(59,130,246,0.15); color:var(--primary); padding:2px 8px; border-radius:12px; font-weight:bold;">${(parseFloat(d.zone_radius_km) || 1.5).toFixed(1)} km</span></td>
        <td>${trusted(riskBadge)}</td>
        <td>${d.warning_cm ?? 10}</td>
        <td>${d.critical_cm ?? 20}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-outline" data-action="edit-device" data-id="${d.id}" title="Chỉnh sửa thông số điểm đo"><i aria-hidden="true" class="fas fa-edit"></i> Sửa</button>
            <button class="btn btn-sm btn-outline" data-action="rotate-key" data-id="${d.id}">Đổi khóa</button>
            ${trusted(d.is_active ? html`<button class="btn btn-sm btn-outline" data-action="delete-device" data-id="${d.id}">Vô hiệu hóa</button>` : html`<button class="btn btn-sm btn-outline" data-action="toggle-device" data-id="${d.id}">Kích hoạt lại</button>`)}
          </div>
        </td>
      </tr>
    `;
  });
}

function renderAdminStaff(staff) {
  const tbody = document.getElementById('admin-users-tbody');
  tbody.innerHTML = '';
  staff.forEach(u => {
    tbody.innerHTML += html`
      <tr>
        <td>${u.display_name}</td>
        <td>${u.email}</td>
        <td>${u.role}</td>
        <td><span class="badge-status" style="color: ${u.is_active ? 'var(--success)' : 'var(--danger)'}">${u.is_active ? 'Đang hoạt động' : 'Đã khoá'}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" data-action="toggle-user" data-id="${u.id}" data-active="${u.is_active ? 1 : 0}">${u.is_active ? 'Khoá' : 'Mở khoá'}</button>
        </td>
      </tr>
    `;
  });
}

function renderAdminAudit(logs) {
  const tbody = document.getElementById('admin-audit-tbody');
  tbody.innerHTML = '';
  logs.forEach(l => {
    tbody.innerHTML += html`
      <tr>
        <td>${formatTime(l.created_at)}</td>
        <td>${l.actor_name || 'System'}</td>
        <td>${l.action}</td>
        <td>${l.entity_type}</td>
        <td style="font-size:0.75rem; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title='${l.new_values}'>${l.new_values}</td>
      </tr>
    `;
  });
}

window.showAddUserModal = async function() {
  if (!isSiteManager()) return;
  document.getElementById('staff-form').reset();
  openModal('modal-staff');
};
window.submitStaff = async function(event) {
  event.preventDefault();
  if (!isSiteManager()) return;
  const email = document.getElementById('staff-email').value.trim();
  const name = document.getElementById('staff-name').value.trim();
  const password = document.getElementById('staff-password').value;
  try {
    await api.addStaff(currentSiteId, { email, display_name: name, password, role: 'staff' });
    showToast("Đã tạo nhân sự mới thành công!");
    closeModal('modal-staff');
    document.getElementById('staff-password').value = '';
    loadAdminData();
  } catch(err) {
    showToast(err.message, 'error');
  }
};

window.toggleUserStatus = async function(userId, currentStatus) {
  if (!isSiteManager()) return;
  try {
    await api.updateStaff(userId, currentSiteId, { is_active: currentStatus ? 0 : 1 });
    showToast(`Đã ${currentStatus ? 'khoá' : 'mở khoá'} tài khoản!`);
    loadAdminData();
  } catch(err) {
    showToast(err.message, 'error');
  }
};

// Reports Logic
async function loadReportsData() {
  if (!currentSiteId) return;
  const generation = sessionGeneration;
  try {
    const [kpi, overview] = await Promise.all([
      api.request(`/reports/site/${encodeURIComponent(currentSiteId)}/kpi`), api.getSiteOverview(currentSiteId)
    ]);
    if (generation !== sessionGeneration) return;
    document.getElementById('kpi-avg-resolution').textContent = Math.round(kpi.avg_resolution_minutes) || 0;
    const devices = overview.devices || [];
    const tbody = document.getElementById('reports-devices-tbody');
    tbody.innerHTML = '';
    devices.forEach(d => {
      tbody.innerHTML += html`
        <tr>
          <td>${d.name} (${d.point_label})</td>
          <td>
            <a href="/api/reports/site/${encodeURIComponent(currentSiteId)}/device/${encodeURIComponent(d.id)}/csv" class="btn btn-sm btn-outline">Tải CSV</a>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    document.getElementById('reports-devices-tbody').innerHTML = '<tr><td colspan="2">Không tải được báo cáo. Vui lòng thử lại.</td></tr>';
  }
}


function renderWaterLevelsPage() {
  const select = document.getElementById('demo-device');
  const selected = select.value;
  const devices = window.devicesCache || [];
  select.innerHTML = '<option value="all">Tất cả điểm đo</option>' + devices.filter(d => d.is_active).map(d => html`<option value="${d.id}">${d.point_label || d.name}</option>`).join('');
  if (devices.some(d => d.id === selected)) select.value = selected;
  const grid = document.getElementById('water-levels-devices-grid');
  grid.innerHTML = devices.map(d => html`<div class="device-card"><h3>${d.point_label || d.name}</h3><p>${d.data_status === 'online' && d.latest_level_cm !== null ? d.latest_level_cm + ' cm' : '-- cm'} · ${getStatusLabel(d.data_status)}</p><p class="text-muted">Vàng ≥ ${d.warning_cm ?? 10} cm · Đỏ ≥ ${d.critical_cm ?? 20} cm · Kết thúc &lt; ${d.clear_cm ?? 7} cm · ${d.sample_count ?? 3} mẫu liên tiếp</p></div>`).join('');
}
window.copyProvisioningKey = async function() {
  const input = document.getElementById('provisioning-key');
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Đã sao chép khóa. Lưu vào cấu hình thiết bị.');
  } catch (_) {
    input.select();
    showToast('Chọn khóa rồi nhấn Ctrl+C để sao chép.', 'info');
  }
};
window.openRotateKeyModal = function(deviceId) {
  if (!isSiteManager()) return;
  const device = adminDevicesCache.find(item => item.id === deviceId);
  if (!device) return;
  document.getElementById('rotate-key-device-id').value = deviceId;
  document.getElementById('rotate-key-device-name').textContent = device.name;
  openModal('modal-rotate-key');
};
window.confirmRotateKey = async function() {
  if (!isSiteManager()) return;
  const generation = sessionGeneration;
  try {
    const result = await api.rotateDeviceKey(document.getElementById('rotate-key-device-id').value);
    if (generation !== sessionGeneration) return;
    document.getElementById('provisioning-device').value = result.id;
    document.getElementById('provisioning-key').value = result.key;
    closeModal('modal-rotate-key');
    openModal('modal-provisioning');
    loadAdminData();
  } catch (error) {
    if (generation === sessionGeneration) showToast(error.message, 'error');
  }
};
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const handlers = {
    'ack-alert': () => window.ackAlert(id),
    'incident-notes': () => window.openIncidentNotesModal(id),
    'assign-staff': () => window.openAssignStaffModal(id),
    'take-incident': () => window.assignIncident(id),
    'edit-device': () => window.openEditDeviceModal(id),
    'rotate-key': () => window.openRotateKeyModal(id),
    'delete-device': () => {
      const device = adminDevicesCache.find(d => d.id === id);
      if (device) window.openDeleteDeviceModal(id, device.name);
    },
    'toggle-device': () => window.toggleDeviceStatus(id),
    'toggle-user': () => window.toggleUserStatus(id, Number(button.dataset.active))
  };
  handlers[button.dataset.action]?.();
});


window.addEventListener('resize', () => {
  if (leafletMap) leafletMap.invalidateSize();
  if (pickerMap) pickerMap.invalidateSize();
});

init();
