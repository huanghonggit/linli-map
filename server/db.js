import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.js";

const DEFAULT_SYSTEM_SETTINGS = {
  imageryProvider: "esri",
  customTileUrl: "",
  defaultLighting: "day",
  default3DBuildings: true,
  cesiumIonToken: "",
  requireLogin: false,
};

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function openDatabase(config) {
  if (config.dbPath !== ":memory:") {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  const db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      last_client TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      home_json TEXT,
      center_json TEXT,
      centers_json TEXT NOT NULL DEFAULT '[]',
      saved_json TEXT NOT NULL DEFAULT '[]',
      radius INTEGER NOT NULL DEFAULT 5,
      large INTEGER NOT NULL DEFAULT 0,
      voice INTEGER NOT NULL DEFAULT 1,
      lighting TEXT NOT NULL DEFAULT 'day',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_landmarks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'landmark',
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      hint TEXT DEFAULT '',
      address TEXT DEFAULT '',
      photo TEXT DEFAULT '',
      kind TEXT DEFAULT '',
      published INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'notice', 'warning')),
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landmarks_pub ON custom_landmarks(published, updated_at DESC);
  `);

  const now = new Date().toISOString();
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();
  if (!existingAdmin) {
    const info = db
      .prepare(
        `INSERT INTO users (username, display_name, phone, role, status, password_hash, must_change_password, created_at, updated_at)
         VALUES (?, ?, '', 'admin', 'active', ?, 1, ?, ?)`,
      )
      .run(
        config.defaultAdminUsername,
        "系统管理员",
        hashPassword(config.defaultAdminPassword),
        now,
        now,
      );
    db.prepare(
      `INSERT OR IGNORE INTO user_profiles (user_id, updated_at) VALUES (?, ?)`,
    ).run(info.lastInsertRowid, now);
  }

  for (const [key, val] of Object.entries(DEFAULT_SYSTEM_SETTINGS)) {
    db.prepare(
      `INSERT OR IGNORE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
    ).run(key, JSON.stringify(val), now);
  }

  function sanitizeUser(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      phone: row.phone || "",
      role: row.role,
      status: row.status,
      mustChangePassword: Boolean(row.must_change_password),
      lastLoginAt: row.last_login_at || null,
      lastClient: row.last_client || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function getProfile(userId) {
    const row = db
      .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
      .get(userId);
    if (!row) {
      return {
        home: null,
        center: null,
        centers: [],
        saved: [],
        radius: 5,
        large: false,
        voice: true,
        lighting: "day",
        updatedAt: null,
      };
    }
    return {
      home: safeJsonParse(row.home_json, null),
      center: safeJsonParse(row.center_json, null),
      centers: safeJsonParse(row.centers_json, []),
      saved: safeJsonParse(row.saved_json, []),
      radius: Number(row.radius) || 5,
      large: Boolean(row.large),
      voice: row.voice !== 0,
      lighting: row.lighting || "day",
      updatedAt: row.updated_at,
    };
  }

  function saveProfile(userId, patch) {
    const current = getProfile(userId);
    const next = {
      home: patch.home !== undefined ? patch.home : current.home,
      center: patch.center !== undefined ? patch.center : current.center,
      centers: Array.isArray(patch.centers) ? patch.centers : current.centers,
      saved: Array.isArray(patch.saved) ? patch.saved : current.saved,
      radius: [1, 3, 5, 8, 10].includes(Number(patch.radius))
        ? Number(patch.radius)
        : current.radius,
      large: patch.large !== undefined ? Boolean(patch.large) : current.large,
      voice: patch.voice !== undefined ? Boolean(patch.voice) : current.voice,
      lighting: ["day", "golden", "clear"].includes(patch.lighting)
        ? patch.lighting
        : current.lighting,
    };
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO user_profiles (user_id, home_json, center_json, centers_json, saved_json, radius, large, voice, lighting, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         home_json = excluded.home_json,
         center_json = excluded.center_json,
         centers_json = excluded.centers_json,
         saved_json = excluded.saved_json,
         radius = excluded.radius,
         large = excluded.large,
         voice = excluded.voice,
         lighting = excluded.lighting,
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      next.home ? JSON.stringify(next.home) : null,
      next.center ? JSON.stringify(next.center) : null,
      JSON.stringify(next.centers.slice(0, 24)),
      JSON.stringify(next.saved.slice(0, 60)),
      next.radius,
      next.large ? 1 : 0,
      next.voice ? 1 : 0,
      next.lighting,
      ts,
    );
    return { ...next, updatedAt: ts };
  }

  function getSettings() {
    const rows = db.prepare("SELECT key, value_json FROM system_settings").all();
    const out = { ...DEFAULT_SYSTEM_SETTINGS };
    for (const row of rows) {
      out[row.key] = safeJsonParse(row.value_json, out[row.key]);
    }
    return out;
  }

  function updateSettings(patch) {
    const ts = new Date().toISOString();
    const allowed = Object.keys(DEFAULT_SYSTEM_SETTINGS);
    const stmt = db.prepare(
      `INSERT INTO system_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    );
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        stmt.run(key, JSON.stringify(patch[key]), ts);
      }
    }
    return getSettings();
  }

  function logAudit({ actorId = null, actorName = "system", action, target = "", detail = "", ip = "" }) {
    db.prepare(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(actorId, actorName, action, target, detail, ip, new Date().toISOString());
  }

  function mapLandmark(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      lat: Number(row.lat),
      lon: Number(row.lon),
      hint: row.hint || "",
      address: row.address || "",
      photo: row.photo || "",
      kind: row.kind || "",
      published: Boolean(row.published),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapAnnouncement(row) {
    return {
      id: Number(row.id),
      title: row.title,
      content: row.content,
      level: row.level,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    db,
    close: () => db.close(),
    sanitizeUser,
    getProfile,
    saveProfile,
    getSettings,
    updateSettings,
    logAudit,
    mapLandmark,
    mapAnnouncement,
    findUserById: (id) =>
      db.prepare("SELECT * FROM users WHERE id = ?").get(id),
    findUserByLogin: (identifier) =>
      db
        .prepare(
          "SELECT * FROM users WHERE username = ? COLLATE NOCASE OR (phone != '' AND phone = ?) LIMIT 1",
        )
        .get(identifier, identifier),
    countActiveAdmins: () =>
      Number(
        db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'",
          )
          .get().cnt,
      ),
  };
}
