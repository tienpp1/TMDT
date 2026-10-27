CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    location TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_users (
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('manager', 'staff')),
    PRIMARY KEY (site_id, user_id)
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    point_label TEXT,
    is_active INTEGER DEFAULT 1,
    key_hash TEXT NOT NULL,
    deleted_at TEXT,
    last_seen TEXT,
    last_fresh_received_at TEXT,
    latest_measured_at TEXT,
    latest_quality TEXT,
    latest_level_cm NUMERIC,
    warning_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    clear_count INTEGER DEFAULT 0,
    current_alert_level TEXT DEFAULT 'normal',
    active_episode_id TEXT,
    demo_override_level NUMERIC,
    lat REAL,
    lng REAL,
    zone_radius_km REAL DEFAULT 1.5,
    risk_level INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    measured_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    level_cm NUMERIC,
    quality TEXT NOT NULL,
    history_only INTEGER DEFAULT 0,
    warning_cm_snapshot NUMERIC,
    critical_cm_snapshot NUMERIC,
    rule_version_snapshot INTEGER,
    UNIQUE (device_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings(device_id, measured_at);

CREATE TABLE IF NOT EXISTS alert_rules (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    warning_cm NUMERIC NOT NULL,
    critical_cm NUMERIC NOT NULL,
    clear_cm NUMERIC NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 3 CHECK (sample_count > 0 AND sample_count <= 60),
    version INTEGER DEFAULT 1,
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    CHECK (clear_cm < warning_cm AND warning_cm < critical_cm)
);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    episode_id TEXT NOT NULL,
    device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    trigger_reading_id TEXT REFERENCES readings(id),
    rule_version INTEGER NOT NULL,
    ack_by TEXT REFERENCES users(id),
    ack_at TEXT,
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_device_time ON alerts(device_id, opened_at);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    site_id TEXT REFERENCES sites(id),
    actor_user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_values TEXT,
    new_values TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    episode_id TEXT UNIQUE NOT NULL,
    site_id TEXT REFERENCES sites(id),
    device_id TEXT REFERENCES devices(id),
    title TEXT,
    reported_by TEXT REFERENCES users(id),
    manager_note TEXT,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed')),
    assignee_id TEXT REFERENCES users(id),
    assigned_at TEXT,
    completed_at TEXT,
    checklist TEXT, -- JSON string for checklist
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incident_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id),
    note TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'outcome' CHECK (kind IN ('report', 'assignment', 'outcome')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

