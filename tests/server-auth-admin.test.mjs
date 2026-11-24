import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/app.js";

async function startTestServer() {
  const app = createAppServer({
    dbPath: ":memory:",
    port: 0,
    rateLimitDisabled: true,
    defaultAdminUsername: "admin",
    defaultAdminPassword: "AdminTestPassword123",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  const base = `http://127.0.0.1:${port}`;
  async function req(path, { method = "GET", token, body, headers = {} } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
  return { app, req };
}

test("full auth, cloud profile sync, RBAC admin management, landmarks, announcements, and audit logs", async () => {
  const { app, req } = await startTestServer();
  try {
    // 1. Health & bootstrap
    const health = await req("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);

    // 2. Register standard user from Android client
    const reg = await req("/api/auth/register", {
      method: "POST",
      headers: { "X-Linli-Client": "android-app" },
      body: {
        username: "grandpa_li",
        displayName: "李爷爷",
        phone: "13800138000",
        password: "password123",
      },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.user.role, "user");
    const userToken = reg.json.token;

    // 3. Regular user cannot access admin endpoints (403)
    const forbidden = await req("/api/admin/overview", { token: userToken });
    assert.equal(forbidden.status, 403);

    // 4. Sync user cloud profile (home, saved places, large font)
    const home = { id: "my-home", name: "我的家", type: "home", lat: 31.0879, lon: 121.5844 };
    const savedPut = await req("/api/profile", {
      method: "PUT",
      token: userToken,
      body: {
        home,
        saved: [{ id: "market-1", name: "早市菜场", type: "market", lat: 31.089, lon: 121.585 }],
        radius: 8,
        large: true,
        voice: true,
      },
    });
    assert.equal(savedPut.status, 200);
    assert.equal(savedPut.json.profile.home.name, "我的家");
    assert.equal(savedPut.json.profile.radius, 8);
    assert.equal(savedPut.json.profile.large, true);

    const me = await req("/api/auth/me", { token: userToken });
    assert.equal(me.status, 200);
    assert.equal(me.json.profile.saved.length, 1);

    // 5. Login with phone number
    const phoneLogin = await req("/api/auth/login", {
      method: "POST",
      body: { username: "13800138000", password: "password123" },
    });
    assert.equal(phoneLogin.status, 200);
    assert.equal(phoneLogin.json.user.username, "grandpa_li");

    // 6. Admin login
    const adminLogin = await req("/api/auth/login", {
      method: "POST",
      body: { username: "admin", password: "AdminTestPassword123" },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.json.user.role, "admin");
    assert.equal(adminLogin.json.user.mustChangePassword, true);
    const adminToken = adminLogin.json.token;

    // 7. Admin overview & user list
    const overview = await req("/api/admin/overview", { token: adminToken });
    assert.equal(overview.status, 200);
    assert.equal(overview.json.metrics.usersTotal, 2);
    assert.equal(overview.json.metrics.homesConfigured, 1);
    assert.ok(overview.json.models.length >= 1);

    // Cannot disable the last active admin
    const badDisable = await req(`/api/admin/users/${adminLogin.json.user.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });
    assert.equal(badDisable.status, 400);

    // 8. Admin creates community landmark & announcement -> visible in public bootstrap
    const lm = await req("/api/admin/landmarks", {
      method: "POST",
      token: adminToken,
      body: {
        name: "社区助老食堂",
        type: "food",
        lat: 31.0882,
        lon: 121.5849,
        hint: "小区东门步行3分钟",
      },
    });
    assert.equal(lm.status, 201);

    const ann = await req("/api/admin/announcements", {
      method: "POST",
      token: adminToken,
      body: {
        title: "雨天防滑提醒",
        content: "今日有小雨，外出散步请穿防滑鞋。",
        level: "notice",
      },
    });
    assert.equal(ann.status, 201);

    const settingsPut = await req("/api/admin/settings", {
      method: "PUT",
      token: adminToken,
      body: { defaultLighting: "golden", imageryProvider: "esri" },
    });
    assert.equal(settingsPut.status, 200);
    assert.equal(settingsPut.json.settings.defaultLighting, "golden");

    const boot = await req("/api/public/bootstrap");
    assert.equal(boot.status, 200);
    assert.equal(boot.json.landmarks.length, 1);
    assert.equal(boot.json.landmarks[0].name, "社区助老食堂");
    assert.equal(boot.json.announcements.length, 1);
    assert.equal(boot.json.settings.defaultLighting, "golden");

    // 9. Admin disables user -> user's existing JWT is immediately rejected
    const disableRes = await req(`/api/admin/users/${reg.json.user.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });
    assert.equal(disableRes.status, 200);

    const revoked = await req("/api/auth/me", { token: userToken });
    assert.equal(revoked.status, 401);

    // 10. Audit logs capture key operations
    const logs = await req("/api/admin/audit-logs", { token: adminToken });
    assert.equal(logs.status, 200);
    assert.ok(logs.json.logs.some((l) => l.action === "admin.landmark.create"));
    assert.ok(logs.json.logs.some((l) => l.action === "admin.user.update"));

    // 11. Self-service account deletion (in-app DELETE /api/auth/me + web POST /api/public/account-deletion)
    // Last active admin cannot self-delete
    const adminSelfDel = await req("/api/auth/me", {
      method: "DELETE",
      token: adminToken,
      body: { password: "AdminTestPassword123" },
    });
    assert.equal(adminSelfDel.status, 400);

    // Register two test users -> delete one in-app, delete one via public web endpoint
    const u1 = await req("/api/auth/register", {
      method: "POST",
      body: { username: "del_app_user", password: "deletePass1" },
    });
    assert.equal(u1.status, 201);
    const delAppRes = await req("/api/auth/me", {
      method: "DELETE",
      token: u1.json.token,
      body: { password: "deletePass1" },
    });
    assert.equal(delAppRes.status, 200);
    assert.equal((await req("/api/auth/me", { token: u1.json.token })).status, 401);

    const u2 = await req("/api/auth/register", {
      method: "POST",
      body: { username: "del_web_user", password: "deletePass2" },
    });
    assert.equal(u2.status, 201);
    const delWebRes = await req("/api/public/account-deletion", {
      method: "POST",
      body: { username: "del_web_user", password: "deletePass2" },
    });
    assert.equal(delWebRes.status, 200);
    assert.equal(
      (await req("/api/auth/login", { method: "POST", body: { username: "del_web_user", password: "deletePass2" } })).status,
      401,
    );
  } finally {
    await app.close();
  }
});
