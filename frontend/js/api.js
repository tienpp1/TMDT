const api = {
  baseUrl: '/api',

  async request(endpoint, options = {}, maybeBody = null) {
    if (typeof options === 'string') {
      options = {
        method: options,
        body: maybeBody
      };
    }
    options = options || {};
    options.credentials = 'include';
    if (options.body && typeof options.body === 'object') {
      options.body = JSON.stringify(options.body);
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    options.signal = options.signal || controller.signal;
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, options);
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/me') {
          if (typeof showLogin === 'function') showLogin();
        }
        const error = new Error(data.error?.message || 'Không thể cập nhật dữ liệu. Vui lòng thử lại.');
        error.status = res.status;
        throw error;
      }
      return data.data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },

  login(email, password) {
    return this.request('/auth/login', { method: 'POST', body: { email, password } });
  },

  logout() {
    return this.request('/auth/logout', { method: 'POST' });
  },

  getMe() {
    return this.request('/auth/me');
  },

  getSiteOverview(siteId) {
    return this.request(`/sites/${siteId}/overview`);
  },
  
  getSiteAlerts(siteId) {
    return this.request(`/alerts/site/${siteId}`);
  },

  ackAlert(alertId) {
    return this.request(`/alerts/${alertId}/ack`, { method: 'POST' });
  },

  getSiteIncidents(siteId) {
    return this.request(`/incidents/site/${siteId}`);
  },

  reportIncident(siteId, data) {
    return this.request(`/incidents/site/${siteId}/report`, { method: 'POST', body: data });
  },

  assignIncident(incidentId) {
    return this.request(`/incidents/${incidentId}/assign`, { method: 'POST' });
  },

  assignStaffToIncident(incidentId, data) {
    return this.request(`/incidents/${incidentId}/assign-staff`, { method: 'POST', body: data });
  },

  completeIncident(incidentId) {
    return this.request(`/incidents/${incidentId}/complete`, { method: 'POST' });
  },

  addIncidentNote(incidentId, note) {
    return this.request(`/incidents/${incidentId}/notes`, { method: 'POST', body: { note } });
  },

  getIncidentNotes(incidentId) {
    return this.request(`/incidents/${incidentId}/notes`);
  },

  // Admin APIs
  getDevices(siteId) {
    return this.request(`/devices/site/${siteId}`);
  },
  addDevice(siteId, data) {
    return this.request(`/devices/site/${siteId}`, { method: 'POST', body: data });
  },
  updateDevice(deviceId, data) {
    return this.request(`/devices/${deviceId}`, { method: 'PUT', body: data });
  },
  deleteDevice(deviceId) {
    return this.request(`/devices/${deviceId}`, { method: 'DELETE' });
  },
  archiveDevice(deviceId) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/archive`, { method: 'POST', body: {} });
  },
  rotateDeviceKey(deviceId) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/rotate-key`, { method: 'POST' });
  },
  getHistoryStats(siteId, hours = 24) {
    return this.request(`/devices/site/${encodeURIComponent(siteId)}/history-stats?hours=${Number(hours) || 24}`);
  },
  setDeviceOverride(deviceId, data) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/override`, { method: 'POST', body: data });
  },
  demoRainStep(siteId, data) {
    return this.request(`/devices/site/${encodeURIComponent(siteId)}/demo-rain-step`, { method: 'POST', body: data });
  },
  updateRule(deviceId, data) {
    return this.request(`/devices/${deviceId}/rule`, { method: 'PATCH', body: data });
  },
  getStaff(siteId) {
    return this.request(`/users/site/${siteId}`);
  },
  addStaff(siteId, data) {
    return this.request(`/users/site/${siteId}`, { method: 'POST', body: data });
  },
  updateStaff(userId, siteId, data) {
    return this.request(`/users/${userId}/site/${siteId}`, { method: 'PATCH', body: data });
  },
  getAuditLogs(siteId) {
    return this.request(`/audit/site/${siteId}`);
  }
};
