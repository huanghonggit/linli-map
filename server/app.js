import http from "node:http";
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  RateLimiter,
} from "./auth.js";
import { openDatabase } from "./db.js";
import { loadConfig } from "./config.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const VALID_PLACE_TYPES = new Set([
  "junction",
  "park",
  "market",
  "hospital",
  "pharmacy",
  "toilet",
  "food",
  "landmark",
  "home",
  "point",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
  ".apk": "application/vnd.android.package-archive",
};

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(Object.assign(Error("请求体过大"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(Object.assign(Error("JSON 格式无效"), { status: 400 }));
      }
    });
    req.on("error", () =>
      reject(Object.assign(Error("读取请求失败"), { status: 400 })),
    );
  });
}

function validUsername(u) {
  return typeof u === "string" && /^[a-zA-Z0-9_\u4e00-\u9fa5-]{2,24}$/.test(u.trim());
}

function validPassword(p) {
  return typeof p === "string" && p.length >= 6 && p.length <= 72;
}

function scanModelAreas(modelsDir) {
  if (!modelsDir || !existsSync(modelsDir)) return [];
  const results = [];
  for (const entry of readdirSync(modelsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(modelsDir, entry.name);
    const manifestPath = resolve(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
      let totalBytes = 0;
      for (const f of readdirSync(dir)) {
        try {
          totalBytes += statSync(resolve(dir, f)).size;
        } catch {
          /* ignore */
        }
      }
      const counts = m.counts || {};
      const buildingsTotal =
        (counts.tag || 0) +
        (counts.levels || 0) +
        (counts.raster || 0) +
        (counts.outline || 0);
      results.push({
        id: m.id || entry.name,
        name: m.name || entry.name,
        radiusKm: Math.round((m.radius || 5000) / 1000),
        lon: m.lon,
        lat: m.lat,
        lod: m.lod || 1,
        imageDate: m.imageDate || "",
        osmDate: m.osmDate || "",
        chunks: Array.isArray(m.chunks) ? m.chunks.length : 0,
        triangles: m.triangles || 0,
        buildingsTotal,
        counts,
        roofCounts: m.roofCounts || null,
        sizeMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      });
    } catch {
      /* ignore corrupt manifest */
    }
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

function serveStaticFile(req, res, staticDir, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = resolve(staticDir, "." + rel);
  if (
    !filePath.startsWith(staticDir + sep) &&
    filePath !== resolve(staticDir, "index.html")
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const target =
    existsSync(filePath) && statSync(filePath).isFile()
      ? filePath
      : resolve(staticDir, "index.html");
  if (!existsSync(target)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const ext = extname(target);
  const headers = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  };
  if (rel.startsWith("/assets/")) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (rel === "/" || rel === "/index.html" || rel === "/sw.js") {
    headers["Cache-Control"] = "no-cache";
  } else if (rel.startsWith("/models/v1/")) {
    headers["Cache-Control"] = "public, max-age=86400";
  }
  res.writeHead(200, headers);
  createReadStream(target).pipe(res);
}

export function createAppServer(overrides = {}) {
  const config = loadConfig(overrides);
  const store = openDatabase(config);
  const limiter = new RateLimiter(25, 10 * 60 * 1000);
  const startedAt = Date.now();

  function issueSession(userRow) {
    const token = signToken(
      {
        sub: Number(userRow.id),
        role: userRow.role,
        ver: Number(userRow.token_version),
      },
      config.jwtSecret,
      config.tokenTtlSec,
    );
    return {
      token,
      user: store.sanitizeUser(userRow),
      profile: store.getProfile(userRow.id),
    };
  }

  function authenticate(req) {
    const header = req.headers.authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    const payload = verifyToken(match[1], config.jwtSecret);
    if (!payload || !payload.sub) return null;
    const userRow = store.findUserById(payload.sub);
    if (!userRow) return null;
    if (userRow.status !== "active") return null;
    if (Number(userRow.token_version) !== Number(payload.ver)) return null;
    return userRow;
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Linli-Client",
    );
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("X-Content-Type-Options", "nosniff");
  }

  async function handleApi(req, res, url) {
    const method = req.method || "GET";
    const path = url.pathname;
    const ip = clientIp(req);

    // 1. Public endpoints
    if (method === "GET" && path === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "linli-map-api",
        version: "2.0.0",
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      });
    }

    if (method === "GET" && path === "/api/public/bootstrap") {
      const settings = store.getSettings();
      const announcements = store.db
        .prepare(
          "SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 5",
        )
        .all()
        .map(store.mapAnnouncement);
      const landmarks = store.db
        .prepare(
          "SELECT * FROM custom_landmarks WHERE published = 1 ORDER BY updated_at DESC LIMIT 200",
        )
        .all()
        .map(store.mapLandmark);
      return sendJson(res, 200, {
        settings: {
          imageryProvider: settings.imageryProvider,
          customTileUrl: settings.customTileUrl,
          defaultLighting: settings.defaultLighting,
          default3DBuildings: Boolean(settings.default3DBuildings),
          cesiumIonToken: settings.cesiumIonToken || "",
          requireLogin: Boolean(settings.requireLogin),
        },
        announcements,
        landmarks,
      });
    }

    if (method === "POST" && path === "/api/public/account-deletion") {
      if (!config.rateLimitDisabled && !limiter.check(`del:${ip}`)) {
        return sendJson(res, 429, { error: "操作过于频繁，请稍后再试。" });
      }
      const body = await readJsonBody(req);
      const identifier = String(body.username || body.identifier || "").trim();
      const password = String(body.password || "");
      if (!identifier || !password) {
        return sendJson(res, 400, { error: "请输入要注销的账号和登录密码。" });
      }
      const target = store.findUserByLogin(identifier);
      if (!target || !verifyPassword(password, target.password_hash)) {
        return sendJson(res, 401, { error: "账号或密码不正确，无法完成注销。" });
      }
      if (
        target.role === "admin" &&
        target.status === "active" &&
        store.countActiveAdmins() <= 1
      ) {
        return sendJson(res, 400, {
          error: "系统至少需保留一位启用中的管理员，请先指定其他管理员后再注销。",
        });
      }
      store.db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
      store.logAudit({
        actorId: null,
        actorName: target.username,
        action: "auth.delete_account_web",
        target: `user:${target.id}`,
        detail: "self-service web deletion",
        ip,
      });
      return sendJson(res, 200, {
        ok: true,
        message: "账号及关联的云端档案、常去地点和照片已永久删除。",
      });
    }

    // 2. Authentication endpoints
    if (method === "POST" && path === "/api/auth/register") {
      if (!config.rateLimitDisabled && !limiter.check(`reg:${ip}`)) {
        return sendJson(res, 429, { error: "操作过于频繁，请稍后再试。" });
      }
      const body = await readJsonBody(req);
      const username = String(body.username || "").trim();
      const displayName = String(body.displayName || username).trim().slice(0, 24);
      const phone = String(body.phone || "").trim().slice(0, 20);
      const password = String(body.password || "");
      const client = String(
        body.client || req.headers["x-linli-client"] || "web",
      ).slice(0, 32);

      if (!validUsername(username)) {
        return sendJson(res, 400, {
          error: "用户名需为 2~24 位字母、数字、中文或下划线。",
        });
      }
      if (!validPassword(password)) {
        return sendJson(res, 400, { error: "密码长度需在 6~72 位之间。" });
      }
      const dup = store.db
        .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
        .get(username);
      if (dup) {
        return sendJson(res, 409, { error: "该用户名已被注册，请换一个。" });
      }
      const now = new Date().toISOString();
      const info = store.db
        .prepare(
          `INSERT INTO users (username, display_name, phone, role, status, password_hash, last_login_at, last_client, created_at, updated_at)
           VALUES (?, ?, ?, 'user', 'active', ?, ?, ?, ?, ?)`,
        )
        .run(
          username,
          displayName || username,
          phone,
          hashPassword(password),
          now,
          client,
          now,
          now,
        );
      store.db
        .prepare(
          "INSERT INTO user_profiles (user_id, updated_at) VALUES (?, ?)",
        )
        .run(info.lastInsertRowid, now);
      const created = store.findUserById(info.lastInsertRowid);
      store.logAudit({
        actorId: created.id,
        actorName: created.username,
        action: "auth.register",
        target: `user:${created.id}`,
        detail: `client=${client}`,
        ip,
      });
      return sendJson(res, 201, issueSession(created));
    }

    if (method === "POST" && path === "/api/auth/login") {
      if (!config.rateLimitDisabled && !limiter.check(`login:${ip}`)) {
        return sendJson(res, 429, { error: "登录尝试次数过多，请稍后再试。" });
      }
      const body = await readJsonBody(req);
      const identifier = String(body.username || body.identifier || "").trim();
      const password = String(body.password || "");
      const client = String(
        body.client || req.headers["x-linli-client"] || "web",
      ).slice(0, 32);

      if (!identifier || !password) {
        return sendJson(res, 400, { error: "请输入账号和密码。" });
      }
      const userRow = store.findUserByLogin(identifier);
      if (!userRow || !verifyPassword(password, userRow.password_hash)) {
        return sendJson(res, 401, { error: "账号或密码不正确。" });
      }
      if (userRow.status !== "active") {
        return sendJson(res, 403, { error: "该账号已被管理员停用，请联系社区管理员。" });
      }
      const now = new Date().toISOString();
      store.db
        .prepare(
          "UPDATE users SET last_login_at = ?, last_client = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, client, now, userRow.id);
      const fresh = store.findUserById(userRow.id);
      store.logAudit({
        actorId: fresh.id,
        actorName: fresh.username,
        action: "auth.login",
        target: `user:${fresh.id}`,
        detail: `role=${fresh.role}, client=${client}`,
        ip,
      });
      return sendJson(res, 200, issueSession(fresh));
    }

    // Authenticated user routes
    const authUser = authenticate(req);
    if (
      path.startsWith("/api/auth/") ||
      path === "/api/profile" ||
      path.startsWith("/api/admin")
    ) {
      if (!authUser) {
        return sendJson(res, 401, { error: "请先登录账号。" });
      }
    }

    if (method === "GET" && path === "/api/auth/me") {
      return sendJson(res, 200, {
        user: store.sanitizeUser(authUser),
        profile: store.getProfile(authUser.id),
      });
    }

    if (method === "PUT" && path === "/api/auth/me") {
      const body = await readJsonBody(req);
      const displayName = String(
        body.displayName ?? authUser.display_name,
      )
        .trim()
        .slice(0, 24);
      const phone = String(body.phone ?? authUser.phone)
        .trim()
        .slice(0, 20);
      if (!displayName) {
        return sendJson(res, 400, { error: "显示名称不能为空。" });
      }
      const now = new Date().toISOString();
      store.db
        .prepare(
          "UPDATE users SET display_name = ?, phone = ?, updated_at = ? WHERE id = ?",
        )
        .run(displayName, phone, now, authUser.id);
      const fresh = store.findUserById(authUser.id);
      return sendJson(res, 200, { user: store.sanitizeUser(fresh) });
    }

    if (method === "DELETE" && path === "/api/auth/me") {
      const body = await readJsonBody(req);
      const password = String(body.password || "");
      if (!verifyPassword(password, authUser.password_hash)) {
        return sendJson(res, 400, { error: "当前密码不正确，无法注销账号。" });
      }
      if (
        authUser.role === "admin" &&
        authUser.status === "active" &&
        store.countActiveAdmins() <= 1
      ) {
        return sendJson(res, 400, {
          error: "您是系统最后一位管理员，请先新增其他管理员后再注销本账号。",
        });
      }
      store.db.prepare("DELETE FROM users WHERE id = ?").run(authUser.id);
      store.logAudit({
        actorId: null,
        actorName: authUser.username,
        action: "auth.delete_account",
        target: `user:${authUser.id}`,
        detail: "self-service in-app deletion",
        ip,
      });
      return sendJson(res, 200, {
        ok: true,
        message: "您的账号及全部云端数据已永久删除。",
      });
    }

    if (method === "POST" && path === "/api/auth/change-password") {
      const body = await readJsonBody(req);
      const oldPassword = String(body.oldPassword || "");
      const newPassword = String(body.newPassword || "");
      if (!verifyPassword(oldPassword, authUser.password_hash)) {
        return sendJson(res, 400, { error: "当前密码不正确。" });
      }
      if (!validPassword(newPassword)) {
        return sendJson(res, 400, { error: "新密码需为 6~72 位字符。" });
      }
      const now = new Date().toISOString();
      store.db
        .prepare(
          "UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0, updated_at = ? WHERE id = ?",
        )
        .run(hashPassword(newPassword), now, authUser.id);
      const fresh = store.findUserById(authUser.id);
      store.logAudit({
        actorId: fresh.id,
        actorName: fresh.username,
        action: "auth.change_password",
        target: `user:${fresh.id}`,
        ip,
      });
      return sendJson(res, 200, issueSession(fresh));
    }

    if (method === "POST" && path === "/api/auth/logout") {
      store.db
        .prepare(
          "UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), authUser.id);
      store.logAudit({
        actorId: authUser.id,
        actorName: authUser.username,
        action: "auth.logout",
        target: `user:${authUser.id}`,
        ip,
      });
      return sendJson(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/profile") {
      return sendJson(res, 200, { profile: store.getProfile(authUser.id) });
    }

    if (method === "PUT" && path === "/api/profile") {
      const body = await readJsonBody(req);
      const saved = store.saveProfile(authUser.id, body);
      return sendJson(res, 200, { profile: saved });
    }

    // 3. Admin RBAC guard
    if (path.startsWith("/api/admin")) {
      if (authUser.role !== "admin") {
        return sendJson(res, 403, { error: "需要管理员权限才能访问此功能。" });
      }

      if (method === "GET" && path === "/api/admin/overview") {
        const usersTotal = Number(
          store.db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
        );
        const usersActive = Number(
          store.db
            .prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'")
            .get().c,
        );
        const adminsTotal = store.countActiveAdmins();
        const androidUsers = Number(
          store.db
            .prepare(
              "SELECT COUNT(*) AS c FROM users WHERE last_client LIKE '%android%'",
            )
            .get().c,
        );
        const landmarksTotal = Number(
          store.db.prepare("SELECT COUNT(*) AS c FROM custom_landmarks").get().c,
        );
        const announcementsActive = Number(
          store.db
            .prepare("SELECT COUNT(*) AS c FROM announcements WHERE active = 1")
            .get().c,
        );
        const profileRows = store.db
          .prepare("SELECT saved_json, home_json FROM user_profiles")
          .all();
        let savedPlacesTotal = 0;
        let homesConfigured = 0;
        for (const r of profileRows) {
          if (r.home_json) homesConfigured++;
          try {
            const arr = JSON.parse(r.saved_json || "[]");
            if (Array.isArray(arr)) savedPlacesTotal += arr.length;
          } catch {
            /* ignore */
          }
        }
        const models = scanModelAreas(config.modelsDir);
        return sendJson(res, 200, {
          metrics: {
            usersTotal,
            usersActive,
            adminsTotal,
            androidUsers,
            homesConfigured,
            savedPlacesTotal,
            landmarksTotal,
            announcementsActive,
            modelsTotal: models.length,
          },
          models,
          settings: store.getSettings(),
        });
      }

      if (method === "GET" && path === "/api/admin/users") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const role = url.searchParams.get("role") || "";
        const status = url.searchParams.get("status") || "";
        const rows = store.db
          .prepare(
            `SELECT u.*, p.saved_json, p.home_json
             FROM users u
             LEFT JOIN user_profiles p ON p.user_id = u.id
             ORDER BY u.id DESC`,
          )
          .all();
        const list = rows
          .filter((r) => {
            if (role && r.role !== role) return false;
            if (status && r.status !== status) return false;
            if (
              q &&
              !`${r.username} ${r.display_name} ${r.phone || ""}`
                .toLowerCase()
                .includes(q)
            ) {
              return false;
            }
            return true;
          })
          .map((r) => {
            let savedCount = 0;
            try {
              const arr = JSON.parse(r.saved_json || "[]");
              if (Array.isArray(arr)) savedCount = arr.length;
            } catch {
              /* ignore */
            }
            return {
              ...store.sanitizeUser(r),
              savedCount,
              hasHome: Boolean(r.home_json),
            };
          });
        return sendJson(res, 200, { users: list });
      }

      if (method === "POST" && path === "/api/admin/users") {
        const body = await readJsonBody(req);
        const username = String(body.username || "").trim();
        const displayName = String(body.displayName || username)
          .trim()
          .slice(0, 24);
        const phone = String(body.phone || "").trim().slice(0, 20);
        const password = String(body.password || "");
        const role = body.role === "admin" ? "admin" : "user";
        if (!validUsername(username)) {
          return sendJson(res, 400, {
            error: "用户名需为 2~24 位字母、数字、中文或下划线。",
          });
        }
        if (!validPassword(password)) {
          return sendJson(res, 400, { error: "密码长度需在 6~72 位之间。" });
        }
        const dup = store.db
          .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
          .get(username);
        if (dup) {
          return sendJson(res, 409, { error: "该用户名已存在。" });
        }
        const now = new Date().toISOString();
        const info = store.db
          .prepare(
            `INSERT INTO users (username, display_name, phone, role, status, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
          )
          .run(
            username,
            displayName || username,
            phone,
            role,
            hashPassword(password),
            now,
            now,
          );
        store.db
          .prepare(
            "INSERT INTO user_profiles (user_id, updated_at) VALUES (?, ?)",
          )
          .run(info.lastInsertRowid, now);
        const created = store.findUserById(info.lastInsertRowid);
        store.logAudit({
          actorId: authUser.id,
          actorName: authUser.username,
          action: "admin.user.create",
          target: `user:${created.id}`,
          detail: `username=${created.username}, role=${role}`,
          ip,
        });
        return sendJson(res, 201, { user: store.sanitizeUser(created) });
      }

      const userMatch = /^\/api\/admin\/users\/(\d+)$/.exec(path);
      if (userMatch) {
        const targetId = Number(userMatch[1]);
        const target = store.findUserById(targetId);
        if (!target) {
          return sendJson(res, 404, { error: "未找到该用户。" });
        }
        if (method === "PATCH") {
          const body = await readJsonBody(req);
          const nextRole =
            body.role === "admin" || body.role === "user"
              ? body.role
              : target.role;
          const nextStatus =
            body.status === "active" || body.status === "disabled"
              ? body.status
              : target.status;
          const nextDisplay = String(body.displayName ?? target.display_name)
            .trim()
            .slice(0, 24);
          const nextPhone = String(body.phone ?? target.phone)
            .trim()
            .slice(0, 20);
          const wasActiveAdmin =
            target.role === "admin" && target.status === "active";
          const willBeActiveAdmin =
            nextRole === "admin" && nextStatus === "active";
          if (wasActiveAdmin && !willBeActiveAdmin && store.countActiveAdmins() <= 1) {
            return sendJson(res, 400, {
              error: "系统至少需要保留一位启用中的管理员。",
            });
          }
          const bumpToken = nextStatus !== target.status || nextRole !== target.role ? 1 : 0;
          store.db
            .prepare(
              `UPDATE users
               SET display_name = ?, phone = ?, role = ?, status = ?, token_version = token_version + ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              nextDisplay || target.display_name,
              nextPhone,
              nextRole,
              nextStatus,
              bumpToken,
              new Date().toISOString(),
              targetId,
            );
          const fresh = store.findUserById(targetId);
          store.logAudit({
            actorId: authUser.id,
            actorName: authUser.username,
            action: "admin.user.update",
            target: `user:${targetId}`,
            detail: `role=${nextRole}, status=${nextStatus}`,
            ip,
          });
          return sendJson(res, 200, { user: store.sanitizeUser(fresh) });
        }
        if (method === "DELETE") {
          if (targetId === Number(authUser.id)) {
            return sendJson(res, 400, { error: "不能删除当前正在登录的管理员账号。" });
          }
          if (
            target.role === "admin" &&
            target.status === "active" &&
            store.countActiveAdmins() <= 1
          ) {
            return sendJson(res, 400, { error: "不能删除最后一位管理员。" });
          }
          store.db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
          store.logAudit({
            actorId: authUser.id,
            actorName: authUser.username,
            action: "admin.user.delete",
            target: `user:${targetId}`,
            detail: `username=${target.username}`,
            ip,
          });
          return sendJson(res, 200, { ok: true });
        }
      }

      const resetMatch = /^\/api\/admin\/users\/(\d+)\/reset-password$/.exec(path);
      if (method === "POST" && resetMatch) {
        const targetId = Number(resetMatch[1]);
        const target = store.findUserById(targetId);
        if (!target) return sendJson(res, 404, { error: "未找到该用户。" });
        const body = await readJsonBody(req);
        const newPassword = String(body.password || "");
        if (!validPassword(newPassword)) {
          return sendJson(res, 400, { error: "新密码需为 6~72 位字符。" });
        }
        store.db
          .prepare(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 1, updated_at = ? WHERE id = ?",
          )
          .run(hashPassword(newPassword), new Date().toISOString(), targetId);
        store.logAudit({
          actorId: authUser.id,
          actorName: authUser.username,
          action: "admin.user.reset_password",
          target: `user:${targetId}`,
          detail: `username=${target.username}`,
          ip,
        });
        return sendJson(res, 200, { ok: true });
      }

      // Admin landmarks CRUD
      if (method === "GET" && path === "/api/admin/landmarks") {
        const rows = store.db
          .prepare("SELECT * FROM custom_landmarks ORDER BY updated_at DESC")
          .all()
          .map(store.mapLandmark);
        return sendJson(res, 200, { landmarks: rows });
      }
      if (method === "POST" && path === "/api/admin/landmarks") {
        const body = await readJsonBody(req);
        const name = String(body.name || "").trim().slice(0, 40);
        const type = VALID_PLACE_TYPES.has(body.type) ? body.type : "landmark";
        const lat = Number(body.lat);
        const lon = Number(body.lon);
        if (
          !name ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180
        ) {
          return sendJson(res, 400, { error: "请填写有效的地标名称和经纬度。" });
        }
        const id = `community-${randomUUID().slice(0, 12)}`;
        const now = new Date().toISOString();
        store.db
          .prepare(
            `INSERT INTO custom_landmarks (id, name, type, lat, lon, hint, address, photo, kind, published, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            name,
            type,
            lat,
            lon,
            String(body.hint || "").trim().slice(0, 80),
            String(body.address || "").trim().slice(0, 120),
            String(body.photo || ""),
            ["", "shop", "junction"].includes(body.kind) ? body.kind || "" : "",
            body.published === false ? 0 : 1,
            authUser.id,
            now,
            now,
          );
        const created = store.db
          .prepare("SELECT * FROM custom_landmarks WHERE id = ?")
          .get(id);
        store.logAudit({
          actorId: authUser.id,
          actorName: authUser.username,
          action: "admin.landmark.create",
          target: id,
          detail: name,
          ip,
        });
        return sendJson(res, 201, { landmark: store.mapLandmark(created) });
      }
      const lmMatch = /^\/api\/admin\/landmarks\/([a-zA-Z0-9:_-]+)$/.exec(path);
      if (lmMatch) {
        const lmId = lmMatch[1];
        const existing = store.db
          .prepare("SELECT * FROM custom_landmarks WHERE id = ?")
          .get(lmId);
        if (!existing) return sendJson(res, 404, { error: "未找到该地标。" });
        if (method === "PUT" || method === "PATCH") {
          const body = await readJsonBody(req);
          const name = String(body.name ?? existing.name).trim().slice(0, 40);
          const type = VALID_PLACE_TYPES.has(body.type)
            ? body.type
            : existing.type;
          const lat = body.lat !== undefined ? Number(body.lat) : existing.lat;
          const lon = body.lon !== undefined ? Number(body.lon) : existing.lon;
          const published =
            body.published !== undefined
              ? body.published
                ? 1
                : 0
              : existing.published;
          store.db
            .prepare(
              `UPDATE custom_landmarks
               SET name = ?, type = ?, lat = ?, lon = ?, hint = ?, address = ?, photo = ?, published = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              name,
              type,
              lat,
              lon,
              String(body.hint ?? existing.hint).slice(0, 80),
              String(body.address ?? existing.address).slice(0, 120),
              String(body.photo ?? existing.photo),
              published,
              new Date().toISOString(),
              lmId,
            );
          const fresh = store.db
            .prepare("SELECT * FROM custom_landmarks WHERE id = ?")
            .get(lmId);
          store.logAudit({
            actorId: authUser.id,
            actorName: authUser.username,
            action: "admin.landmark.update",
            target: lmId,
            detail: name,
            ip,
          });
          return sendJson(res, 200, { landmark: store.mapLandmark(fresh) });
        }
        if (method === "DELETE") {
          store.db
            .prepare("DELETE FROM custom_landmarks WHERE id = ?")
            .run(lmId);
          store.logAudit({
            actorId: authUser.id,
            actorName: authUser.username,
            action: "admin.landmark.delete",
            target: lmId,
            detail: existing.name,
            ip,
          });
          return sendJson(res, 200, { ok: true });
        }
      }

      // Admin announcements CRUD
      if (method === "GET" && path === "/api/admin/announcements") {
        const list = store.db
          .prepare("SELECT * FROM announcements ORDER BY id DESC")
          .all()
          .map(store.mapAnnouncement);
        return sendJson(res, 200, { announcements: list });
      }
      if (method === "POST" && path === "/api/admin/announcements") {
        const body = await readJsonBody(req);
        const title = String(body.title || "").trim().slice(0, 60);
        const content = String(body.content || "").trim().slice(0, 400);
        const level = ["info", "notice", "warning"].includes(body.level)
          ? body.level
          : "info";
        if (!title || !content) {
          return sendJson(res, 400, { error: "请填写公告标题和内容。" });
        }
        const now = new Date().toISOString();
        const info = store.db
          .prepare(
            `INSERT INTO announcements (title, content, level, active, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(title, content, level, body.active === false ? 0 : 1, authUser.id, now, now);
        const created = store.db
          .prepare("SELECT * FROM announcements WHERE id = ?")
          .get(info.lastInsertRowid);
        store.logAudit({
          actorId: authUser.id,
          actorName: authUser.username,
          action: "admin.announcement.create",
          target: `announcement:${created.id}`,
          detail: title,
          ip,
        });
        return sendJson(res, 201, {
          announcement: store.mapAnnouncement(created),
        });
      }
      const annMatch = /^\/api\/admin\/announcements\/(\d+)$/.exec(path);
      if (annMatch) {
        const annId = Number(annMatch[1]);
        const existing = store.db
          .prepare("SELECT * FROM announcements WHERE id = ?")
          .get(annId);
        if (!existing) return sendJson(res, 404, { error: "未找到该公告。" });
        if (method === "PATCH") {
          const body = await readJsonBody(req);
          store.db
            .prepare(
              `UPDATE announcements SET title = ?, content = ?, level = ?, active = ?, updated_at = ? WHERE id = ?`,
            )
            .run(
              String(body.title ?? existing.title).trim().slice(0, 60),
              String(body.content ?? existing.content).trim().slice(0, 400),
              ["info", "notice", "warning"].includes(body.level)
                ? body.level
                : existing.level,
              body.active !== undefined
                ? body.active
                  ? 1
                  : 0
                : existing.active,
              new Date().toISOString(),
              annId,
            );
          const fresh = store.db
            .prepare("SELECT * FROM announcements WHERE id = ?")
            .get(annId);
          return sendJson(res, 200, {
            announcement: store.mapAnnouncement(fresh),
          });
        }
        if (method === "DELETE") {
          store.db
            .prepare("DELETE FROM announcements WHERE id = ?")
            .run(annId);
          return sendJson(res, 200, { ok: true });
        }
      }

      // Admin map & system settings
      if (method === "GET" && path === "/api/admin/settings") {
        return sendJson(res, 200, { settings: store.getSettings() });
      }
      if (method === "PUT" && path === "/api/admin/settings") {
        const body = await readJsonBody(req);
        const updated = store.updateSettings({
          ...(body.imageryProvider &&
          ["esri", "wayback", "custom"].includes(body.imageryProvider)
            ? { imageryProvider: body.imageryProvider }
            : {}),
          ...(body.customTileUrl !== undefined
            ? { customTileUrl: String(body.customTileUrl || "").trim().slice(0, 300) }
            : {}),
          ...(body.defaultLighting &&
          ["day", "golden", "clear"].includes(body.defaultLighting)
            ? { defaultLighting: body.defaultLighting }
            : {}),
          ...(body.default3DBuildings !== undefined
            ? { default3DBuildings: Boolean(body.default3DBuildings) }
            : {}),
          ...(body.cesiumIonToken !== undefined
            ? { cesiumIonToken: String(body.cesiumIonToken || "").trim().slice(0, 512) }
            : {}),
          ...(body.requireLogin !== undefined
            ? { requireLogin: Boolean(body.requireLogin) }
            : {}),
        });
        store.logAudit({
          actorId: authUser.id,
          actorName: authUser.username,
          action: "admin.settings.update",
          target: "system_settings",
          detail: `imagery=${updated.imageryProvider}, lighting=${updated.defaultLighting}, requireLogin=${updated.requireLogin}`,
          ip,
        });
        return sendJson(res, 200, { settings: updated });
      }

      if (method === "GET" && path === "/api/admin/models") {
        return sendJson(res, 200, { models: scanModelAreas(config.modelsDir) });
      }

      if (method === "GET" && path === "/api/admin/audit-logs") {
        const limit = Math.min(
          200,
          Math.max(10, Number(url.searchParams.get("limit")) || 60),
        );
        const logs = store.db
          .prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?")
          .all(limit)
          .map((r) => ({
            id: Number(r.id),
            actorId: r.actor_id ? Number(r.actor_id) : null,
            actorName: r.actor_name,
            action: r.action,
            target: r.target,
            detail: r.detail,
            ip: r.ip,
            createdAt: r.created_at,
          }));
        return sendJson(res, 200, { logs });
      }
    }

    return sendJson(res, 404, { error: "接口不存在。" });
  }

  const server = http.createServer(async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, url);
      } catch (err) {
        const status = err?.status || 500;
        sendJson(res, status, {
          error: status >= 500 ? "服务器内部错误，请稍后再试。" : err.message,
        });
      }
      return;
    }
    if (config.staticDir) {
      serveStaticFile(req, res, config.staticDir, url.pathname);
      return;
    }
    sendJson(res, 404, { error: "Not Found" });
  });

  return {
    server,
    store,
    config,
    close() {
      return new Promise((resolveClose) => {
        server.close(() => {
          store.close();
          resolveClose();
        });
      });
    },
  };
}
