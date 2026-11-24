import {
  getClientPlatform,
  isNativeApp,
  prefGet,
  prefRemove,
  prefSet,
} from "../platform/native.js";

const TOKEN_KEY = "linli-auth:token";
const SERVER_KEY = "linli-auth:server";
const DEFAULT_NATIVE_SERVER =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  "https://111.228.54.20";

let memoryToken = "";
let memoryServer = "";

function normalizeBaseUrl(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `http://${s}`;
}

export function getServerUrl() {
  if (memoryServer) return memoryServer;
  try {
    const stored = localStorage.getItem(SERVER_KEY);
    if (stored !== null) {
      memoryServer = normalizeBaseUrl(stored);
      return memoryServer;
    }
  } catch {
    /* ignore */
  }
  if (isNativeApp()) {
    memoryServer = normalizeBaseUrl(DEFAULT_NATIVE_SERVER);
    return memoryServer;
  }
  return "";
}

export async function hydrateClientState() {
  const [savedToken, savedServer] = await Promise.all([
    prefGet(TOKEN_KEY),
    prefGet(SERVER_KEY),
  ]);
  if (savedToken) memoryToken = savedToken;
  if (savedServer !== null && savedServer !== undefined) {
    memoryServer = normalizeBaseUrl(savedServer);
  }
  return { token: memoryToken, serverUrl: getServerUrl() };
}

export async function setServerUrl(url) {
  memoryServer = normalizeBaseUrl(url);
  await prefSet(SERVER_KEY, memoryServer);
  return memoryServer;
}

export function getToken() {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    memoryToken = "";
  }
  return memoryToken;
}

export async function setToken(token) {
  memoryToken = token || "";
  if (memoryToken) await prefSet(TOKEN_KEY, memoryToken);
  else await prefRemove(TOKEN_KEY);
}

function apiUrl(path, overrideBase = null) {
  const base =
    overrideBase !== null ? normalizeBaseUrl(overrideBase) : getServerUrl();
  return `${base}${path}`;
}

async function apiFetch(path, { method = "GET", body, signal, timeoutMs = 12000, base = null } = {}) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(onAbort, timeoutMs);
  const headers = {
    "X-Linli-Client": getClientPlatform(),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(apiUrl(path, base), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const err = new Error(data.error || `请求失败 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw Object.assign(new Error("连接服务器超时，请检查网络或服务器地址。"), {
        status: 0,
      });
    }
    if (typeof err?.status === "number") throw err;
    throw Object.assign(new Error("无法连接到服务器，请确认后端服务已启动。"), {
      status: 0,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// Public & Health
export const checkServerHealth = (overrideBase = null) =>
  apiFetch("/api/health", { timeoutMs: 5000, base: overrideBase });

export const fetchBootstrap = (signal) =>
  apiFetch("/api/public/bootstrap", { signal, timeoutMs: 5000 });

// Auth & User Profile
export async function authRegister({ username, displayName, phone, password }) {
  const data = await apiFetch("/api/auth/register", {
    method: "POST",
    body: {
      username,
      displayName,
      phone,
      password,
      client: getClientPlatform(),
    },
  });
  await setToken(data.token);
  return data;
}

export async function authLogin({ username, password }) {
  const data = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { username, password, client: getClientPlatform() },
  });
  await setToken(data.token);
  return data;
}

export const authMe = () => apiFetch("/api/auth/me", { timeoutMs: 6000 });

export const authUpdateMe = (patch) =>
  apiFetch("/api/auth/me", { method: "PUT", body: patch });

export async function authChangePassword({ oldPassword, newPassword }) {
  const data = await apiFetch("/api/auth/change-password", {
    method: "POST",
    body: { oldPassword, newPassword },
  });
  if (data.token) await setToken(data.token);
  return data;
}

export async function authLogout() {
  try {
    if (getToken()) await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* always clear local token */
  } finally {
    await setToken("");
  }
}

export async function authDeleteAccount(password) {
  const data = await apiFetch("/api/auth/me", {
    method: "DELETE",
    body: { password },
  });
  await setToken("");
  return data;
}

export const syncProfile = (profile) =>
  apiFetch("/api/profile", { method: "PUT", body: profile });

// Admin APIs
export const adminOverview = () => apiFetch("/api/admin/overview");

export const adminListUsers = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.role) qs.set("role", params.role);
  if (params.status) qs.set("status", params.status);
  const tail = qs.toString() ? `?${qs}` : "";
  return apiFetch(`/api/admin/users${tail}`);
};

export const adminCreateUser = (payload) =>
  apiFetch("/api/admin/users", { method: "POST", body: payload });

export const adminUpdateUser = (id, patch) =>
  apiFetch(`/api/admin/users/${id}`, { method: "PATCH", body: patch });

export const adminResetPassword = (id, password) =>
  apiFetch(`/api/admin/users/${id}/reset-password`, {
    method: "POST",
    body: { password },
  });

export const adminDeleteUser = (id) =>
  apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });

export const adminListLandmarks = () => apiFetch("/api/admin/landmarks");

export const adminCreateLandmark = (payload) =>
  apiFetch("/api/admin/landmarks", { method: "POST", body: payload });

export const adminUpdateLandmark = (id, payload) =>
  apiFetch(`/api/admin/landmarks/${id}`, { method: "PUT", body: payload });

export const adminDeleteLandmark = (id) =>
  apiFetch(`/api/admin/landmarks/${id}`, { method: "DELETE" });

export const adminListAnnouncements = () =>
  apiFetch("/api/admin/announcements");

export const adminCreateAnnouncement = (payload) =>
  apiFetch("/api/admin/announcements", { method: "POST", body: payload });

export const adminUpdateAnnouncement = (id, patch) =>
  apiFetch(`/api/admin/announcements/${id}`, { method: "PATCH", body: patch });

export const adminDeleteAnnouncement = (id) =>
  apiFetch(`/api/admin/announcements/${id}`, { method: "DELETE" });

export const adminGetSettings = () => apiFetch("/api/admin/settings");

export const adminUpdateSettings = (patch) =>
  apiFetch("/api/admin/settings", { method: "PUT", body: patch });

export const adminAuditLogs = (limit = 80) =>
  apiFetch(`/api/admin/audit-logs?limit=${limit}`);
