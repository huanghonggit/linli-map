import React, { useEffect, useState } from "react";
import {
  Users,
  MapPin,
  Settings,
  Megaphone,
  FileText,
  BarChart3,
  Plus,
  Trash2,
  KeyRound,
  Shield,
  RefreshCw,
  ImagePlus,
  CheckCircle2,
} from "lucide-react";
import {
  adminOverview,
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  adminResetPassword,
  adminDeleteUser,
  adminListLandmarks,
  adminCreateLandmark,
  adminUpdateLandmark,
  adminDeleteLandmark,
  adminListAnnouncements,
  adminCreateAnnouncement,
  adminUpdateAnnouncement,
  adminDeleteAnnouncement,
  adminGetSettings,
  adminUpdateSettings,
  adminAuditLogs,
} from "../api/client.js";
import { types } from "../data.js";
import { gcj02ToWgs84 } from "../geo.js";
import { smallPhoto } from "../services.js";

const TABS = [
  ["overview", "运行总览", BarChart3],
  ["users", "用户管理", Users],
  ["landmarks", "地标实景", MapPin],
  ["settings", "地图与公告", Settings],
  ["logs", "审计日志", FileText],
];

export default function AdminDashboard({
  currentUser,
  currentCenter,
  onRefreshPublic,
  notify,
}) {
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Overview state
  const [overview, setOverview] = useState(null);

  // Users state
  const [users, setUsers] = useState([]);
  const [userQuery, setUserQuery] = useState("");
  const [newUser, setNewUser] = useState({
    username: "",
    displayName: "",
    phone: "",
    password: "",
    role: "user",
  });

  // Landmarks state
  const [landmarks, setLandmarks] = useState([]);
  const [newLm, setNewLm] = useState({
    name: "",
    type: "landmark",
    lat: currentCenter?.lat ? currentCenter.lat.toFixed(6) : "30.251860",
    lon: currentCenter?.lon ? currentCenter.lon.toFixed(6) : "120.155700",
    hint: "",
    address: "",
    photo: "",
    isGcj02: false,
  });

  // Settings & Announcements state
  const [settings, setSettings] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [newAnn, setNewAnn] = useState({
    title: "",
    content: "",
    level: "info",
  });

  // Logs state
  const [logs, setLogs] = useState([]);

  function flash(msg) {
    setNotice(msg);
    setError("");
    notify?.(msg);
  }

  async function loadTab(targetTab = tab) {
    setLoading(true);
    setError("");
    try {
      if (targetTab === "overview") {
        setOverview(await adminOverview());
      } else if (targetTab === "users") {
        const res = await adminListUsers({ q: userQuery });
        setUsers(res.users || []);
      } else if (targetTab === "landmarks") {
        const res = await adminListLandmarks();
        setLandmarks(res.landmarks || []);
      } else if (targetTab === "settings") {
        const [sRes, aRes] = await Promise.all([
          adminGetSettings(),
          adminListAnnouncements(),
        ]);
        setSettings(sRes.settings);
        setAnnouncements(aRes.announcements || []);
      } else if (targetTab === "logs") {
        const res = await adminAuditLogs(80);
        setLogs(res.logs || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setNotice("");
    void loadTab(tab);
  }, [tab]);

  // --- User actions ---
  async function handleCreateUser(e) {
    e.preventDefault();
    setError("");
    try {
      await adminCreateUser(newUser);
      setNewUser({
        username: "",
        displayName: "",
        phone: "",
        password: "",
        role: "user",
      });
      flash("新用户账号已创建");
      await loadTab("users");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleUserStatus(u) {
    try {
      const next = u.status === "active" ? "disabled" : "active";
      await adminUpdateUser(u.id, { status: next });
      flash(`账号 ${u.username} 已${next === "active" ? "启用" : "停用"}`);
      await loadTab("users");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleUserRole(u) {
    try {
      const next = u.role === "admin" ? "user" : "admin";
      await adminUpdateUser(u.id, { role: next });
      flash(`账号 ${u.username} 角色已设为${next === "admin" ? "管理员" : "普通用户"}`);
      await loadTab("users");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetPwd(u) {
    const pwd = window.prompt(`为用户“${u.displayName} (${u.username})”设置新密码（至少 6 位）：`);
    if (!pwd) return;
    try {
      await adminResetPassword(u.id, pwd);
      flash(`已重置 ${u.username} 的密码`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteUser(u) {
    if (!window.confirm(`确定永久删除账号“${u.displayName} (${u.username})”吗？其云端收藏也将一并清除。`)) {
      return;
    }
    try {
      await adminDeleteUser(u.id);
      flash(`账号 ${u.username} 已删除`);
      await loadTab("users");
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Landmark actions ---
  async function handleLandmarkPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await smallPhoto(file);
      setNewLm((prev) => ({ ...prev, photo: dataUrl }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateLandmark(e) {
    e.preventDefault();
    setError("");
    let lat = Number(newLm.lat);
    let lon = Number(newLm.lon);
    if (newLm.isGcj02 && Number.isFinite(lat) && Number.isFinite(lon)) {
      const converted = gcj02ToWgs84({ lat, lon });
      lat = Number(converted.lat.toFixed(7));
      lon = Number(converted.lon.toFixed(7));
    }
    try {
      await adminCreateLandmark({
        name: newLm.name,
        type: newLm.type,
        lat,
        lon,
        hint: newLm.hint,
        address: newLm.address,
        photo: newLm.photo,
      });
      setNewLm((prev) => ({
        ...prev,
        name: "",
        hint: "",
        address: "",
        photo: "",
      }));
      flash("公共地标已发布到所有客户端");
      await loadTab("landmarks");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleLandmarkPublish(lm) {
    try {
      await adminUpdateLandmark(lm.id, { published: !lm.published });
      flash(lm.published ? "地标已下架" : "地标已上线");
      await loadTab("landmarks");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteLandmark(lm) {
    if (!window.confirm(`确定删除公共地标“${lm.name}”吗？`)) return;
    try {
      await adminDeleteLandmark(lm.id);
      flash("公共地标已删除");
      await loadTab("landmarks");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Settings & Announcements ---
  async function handleSaveSettings(e) {
    e.preventDefault();
    setError("");
    try {
      const res = await adminUpdateSettings(settings);
      setSettings(res.settings);
      flash("地图与系统配置已保存并生效");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateAnnouncement(e) {
    e.preventDefault();
    setError("");
    try {
      await adminCreateAnnouncement(newAnn);
      setNewAnn({ title: "", content: "", level: "info" });
      flash("社区公告已发布");
      await loadTab("settings");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAnnouncement(ann) {
    try {
      await adminUpdateAnnouncement(ann.id, { active: !ann.active });
      flash(ann.active ? "公告已停用" : "公告已重新上线");
      await loadTab("settings");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteAnnouncement(ann) {
    try {
      await adminDeleteAnnouncement(ann.id);
      flash("公告已删除");
      await loadTab("settings");
      onRefreshPublic?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="admin-console">
      <div className="admin-tabs" role="tablist" aria-label="管理员菜单">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          className="admin-refresh"
          title="刷新当前面板"
          onClick={() => loadTab(tab)}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-note">
          <CheckCircle2 size={16} /> {notice}
        </p>
      )}

      {tab === "overview" && overview && (
        <div className="admin-section">
          <div className="metric-grid">
            <div className="metric-card">
              <span>总注册用户</span>
              <strong>{overview.metrics.usersTotal}</strong>
              <small>启用中 {overview.metrics.usersActive} · 管理员 {overview.metrics.adminsTotal}</small>
            </div>
            <div className="metric-card">
              <span>安卓 App 活跃</span>
              <strong>{overview.metrics.androidUsers}</strong>
              <small>已设家 {overview.metrics.homesConfigured} 户</small>
            </div>
            <div className="metric-card">
              <span>云端常去收藏</span>
              <strong>{overview.metrics.savedPlacesTotal}</strong>
              <small>公共地标 {overview.metrics.landmarksTotal} 处</small>
            </div>
            <div className="metric-card">
              <span>三维建模区域</span>
              <strong>{overview.metrics.modelsTotal}</strong>
              <small>在线公告 {overview.metrics.announcementsActive} 条</small>
            </div>
          </div>

          <h3>已部署三维街区模型资产</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>区域</th>
                  <th>半径</th>
                  <th>LoD</th>
                  <th>建筑数</th>
                  <th>三角面</th>
                  <th>影像日期</th>
                  <th>体积</th>
                </tr>
              </thead>
              <tbody>
                {overview.models.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small className="cell-sub">{m.id}</small>
                    </td>
                    <td>{m.radiusKm} km</td>
                    <td>LoD{m.lod}</td>
                    <td>{m.buildingsTotal.toLocaleString()}</td>
                    <td>{m.triangles.toLocaleString()}</td>
                    <td>{m.imageDate || "-"}</td>
                    <td>{m.sizeMB} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="admin-section">
          <form className="admin-inline-search" onSubmit={(e) => { e.preventDefault(); loadTab("users"); }}>
            <input
              placeholder="搜索用户名、昵称或手机号…"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
            <button type="submit" className="secondary">
              查询
            </button>
          </form>

          <details className="admin-collapsible">
            <summary>
              <Plus size={16} /> 新增用户 / 管理员账号
            </summary>
            <form className="admin-form-grid" onSubmit={handleCreateUser}>
              <input
                required
                placeholder="用户名（2~24位）"
                value={newUser.username}
                onChange={(e) =>
                  setNewUser({ ...newUser, username: e.target.value })
                }
              />
              <input
                placeholder="称呼/昵称（如李阿姨）"
                value={newUser.displayName}
                onChange={(e) =>
                  setNewUser({ ...newUser, displayName: e.target.value })
                }
              />
              <input
                placeholder="手机号（选填）"
                value={newUser.phone}
                onChange={(e) =>
                  setNewUser({ ...newUser, phone: e.target.value })
                }
              />
              <input
                required
                minLength={6}
                type="password"
                placeholder="初始密码（≥6位）"
                value={newUser.password}
                onChange={(e) =>
                  setNewUser({ ...newUser, password: e.target.value })
                }
              />
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser({ ...newUser, role: e.target.value })
                }
              >
                <option value="user">普通用户</option>
                <option value="admin">系统管理员</option>
              </select>
              <button type="submit" className="primary">
                创建账号
              </button>
            </form>
          </details>

          <div className="admin-list">
            {users.map((u) => (
              <div key={u.id} className="admin-row-card">
                <div className="admin-row-main">
                  <strong>
                    {u.displayName}{" "}
                    <span className={"role-tag " + u.role}>
                      {u.role === "admin" ? "管理员" : "用户"}
                    </span>{" "}
                    <span className={"status-tag " + u.status}>
                      {u.status === "active" ? "正常" : "已停用"}
                    </span>
                  </strong>
                  <small>
                    账号：{u.username}
                    {u.phone ? ` · 手机：${u.phone}` : ""} · 常去地点 {u.savedCount} 处
                    {u.hasHome ? " · 已设家" : ""}
                    {u.lastClient ? ` · 客户端：${u.lastClient}` : ""}
                  </small>
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => toggleUserRole(u)}
                    title="切换角色"
                  >
                    <Shield size={15} />
                    {u.role === "admin" ? "降为用户" : "设为管理"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => toggleUserStatus(u)}
                  >
                    {u.status === "active" ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleResetPwd(u)}
                  >
                    <KeyRound size={15} />
                    改密
                  </button>
                  {u.id !== currentUser?.id && (
                    <button
                      type="button"
                      className="danger-btn"
                      aria-label={`删除 ${u.username}`}
                      onClick={() => handleDeleteUser(u)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "landmarks" && (
        <div className="admin-section">
          <form className="admin-form-grid" onSubmit={handleCreateLandmark}>
            <input
              required
              placeholder="地标或店铺名称（如：社区助老食堂）"
              value={newLm.name}
              onChange={(e) => setNewLm({ ...newLm, name: e.target.value })}
            />
            <select
              value={newLm.type}
              onChange={(e) => setNewLm({ ...newLm, type: e.target.value })}
            >
              {Object.entries(types).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>
            <input
              required
              type="number"
              step="0.000001"
              placeholder="纬度 lat"
              value={newLm.lat}
              onChange={(e) => setNewLm({ ...newLm, lat: e.target.value })}
            />
            <input
              required
              type="number"
              step="0.000001"
              placeholder="经度 lon"
              value={newLm.lon}
              onChange={(e) => setNewLm({ ...newLm, lon: e.target.value })}
            />
            <input
              placeholder="位置提示（如：瑞和路东门旁）"
              value={newLm.hint}
              onChange={(e) => setNewLm({ ...newLm, hint: e.target.value })}
            />
            <input
              placeholder="详细地址（选填）"
              value={newLm.address}
              onChange={(e) => setNewLm({ ...newLm, address: e.target.value })}
            />
            <label className="check-row compact-check">
              <input
                type="checkbox"
                checked={newLm.isGcj02}
                onChange={(e) =>
                  setNewLm({ ...newLm, isGcj02: e.target.checked })
                }
              />
              高德/腾讯坐标自动纠偏为 WGS-84 卫星坐标
            </label>
            <div className="admin-row-actions">
              {currentCenter && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setNewLm((prev) => ({
                      ...prev,
                      lat: currentCenter.lat.toFixed(6),
                      lon: currentCenter.lon.toFixed(6),
                      isGcj02: false,
                    }))
                  }
                >
                  填入当前地图中心
                </button>
              )}
              <label className="secondary file-chip">
                <ImagePlus size={16} />
                {newLm.photo ? "已选实拍图" : "上传实拍图"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleLandmarkPhoto}
                />
              </label>
              <button type="submit" className="primary">
                <Plus size={16} /> 发布公共地标
              </button>
            </div>
          </form>

          <div className="admin-list">
            {!landmarks.length && (
              <p className="fine">暂无管理员新增的社区公共地标。</p>
            )}
            {landmarks.map((lm) => (
              <div key={lm.id} className="admin-row-card">
                <div className="admin-row-main">
                  <strong>
                    {lm.name}{" "}
                    <span className={"status-tag " + (lm.published ? "active" : "disabled")}>
                      {lm.published ? "已上线" : "已下架"}
                    </span>
                  </strong>
                  <small>
                    {types[lm.type]?.short || lm.type} · ({lm.lat.toFixed(5)}, {lm.lon.toFixed(5)})
                    {lm.hint ? ` · ${lm.hint}` : ""}
                  </small>
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => toggleLandmarkPublish(lm)}
                  >
                    {lm.published ? "下架" : "上线"}
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => handleDeleteLandmark(lm)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "settings" && settings && (
        <div className="admin-section">
          <form className="auth-form" onSubmit={handleSaveSettings}>
            <h3>三维地图与全局访问策略</h3>
            <label className="field-label" htmlFor="cfg-imagery">
              高清卫星影像源
            </label>
            <select
              id="cfg-imagery"
              value={settings.imageryProvider}
              onChange={(e) =>
                setSettings({ ...settings, imageryProvider: e.target.value })
              }
            >
              <option value="esri">Esri World Imagery（最新高清，推荐）</option>
              <option value="wayback">Esri Wayback 存档影像（稳定低延迟）</option>
              <option value="custom">自定义高清瓦片源 URL 模板</option>
            </select>

            {settings.imageryProvider === "custom" && (
              <>
                <label className="field-label" htmlFor="cfg-tile-url">
                  自定义瓦片 URL 模板（含 {"{z}/{y}/{x}"}）
                </label>
                <input
                  id="cfg-tile-url"
                  placeholder="https://example.com/tiles/{z}/{y}/{x}.jpg"
                  value={settings.customTileUrl || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, customTileUrl: e.target.value })
                  }
                />
              </>
            )}

            <label className="field-label" htmlFor="cfg-lighting">
              默认三维写实光影
            </label>
            <select
              id="cfg-lighting"
              value={settings.defaultLighting}
              onChange={(e) =>
                setSettings({ ...settings, defaultLighting: e.target.value })
              }
            >
              <option value="day">晴日实景（最真实清晰）</option>
              <option value="golden">暖阳黄昏（立体光影强）</option>
              <option value="clear">柔和清晰（强光下易读）</option>
            </select>

            <label className="field-label" htmlFor="cfg-cesium">
              Cesium Ion Token（可选，启用摄影测量 3D 城市）
            </label>
            <input
              id="cfg-cesium"
              placeholder="留空使用内置高清地形与卫星模型"
              value={settings.cesiumIonToken || ""}
              onChange={(e) =>
                setSettings({ ...settings, cesiumIonToken: e.target.value })
              }
            />

            <label className="check-row compact-check">
              <input
                type="checkbox"
                checked={Boolean(settings.default3DBuildings)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    default3DBuildings: e.target.checked,
                  })
                }
              />
              默认显示立体建筑外立面
            </label>

            <label className="check-row compact-check">
              <input
                type="checkbox"
                checked={Boolean(settings.requireLogin)}
                onChange={(e) =>
                  setSettings({ ...settings, requireLogin: e.target.checked })
                }
              />
              强制用户先登录再访问地图（适合封闭社区/养老院部署）
            </label>

            <button type="submit" className="primary wide">
              保存地图与系统设置
            </button>
          </form>

          <form className="auth-form" onSubmit={handleCreateAnnouncement}>
            <h3>
              <Megaphone size={17} /> 发布社区出行公告
            </h3>
            <input
              required
              placeholder="公告标题（如：本周三西湖断桥周边施工绕行提醒）"
              value={newAnn.title}
              onChange={(e) => setNewAnn({ ...newAnn, title: e.target.value })}
            />
            <textarea
              required
              rows={3}
              placeholder="填写简短易懂的提醒内容，支持首页长辈一键语音收听…"
              value={newAnn.content}
              onChange={(e) =>
                setNewAnn({ ...newAnn, content: e.target.value })
              }
            />
            <div className="admin-row-actions">
              <select
                value={newAnn.level}
                onChange={(e) =>
                  setNewAnn({ ...newAnn, level: e.target.value })
                }
              >
                <option value="info">普通提示</option>
                <option value="notice">重要提醒</option>
                <option value="warning">紧急通知</option>
              </select>
              <button type="submit" className="primary">
                发布公告
              </button>
            </div>
          </form>

          <div className="admin-list">
            {announcements.map((a) => (
              <div key={a.id} className="admin-row-card">
                <div className="admin-row-main">
                  <strong>
                    {a.title}{" "}
                    <span className={"status-tag " + (a.active ? "active" : "disabled")}>
                      {a.active ? "展示中" : "已停用"}
                    </span>
                  </strong>
                  <small>{a.content}</small>
                </div>
                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => toggleAnnouncement(a)}
                  >
                    {a.active ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => handleDeleteAnnouncement(a)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="admin-section">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>动作</th>
                  <th>目标</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.createdAt.replace("T", " ").slice(0, 19)}</td>
                    <td>{l.actorName}</td>
                    <td><code>{l.action}</code></td>
                    <td>{l.target}</td>
                    <td>{l.detail || l.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
