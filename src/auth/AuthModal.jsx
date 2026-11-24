import React, { useState } from "react";
import {
  User,
  ShieldCheck,
  LogOut,
  KeyRound,
  Cloud,
  Server,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
  FileText,
} from "lucide-react";
import {
  authLogin,
  authRegister,
  authUpdateMe,
  authChangePassword,
  authDeleteAccount,
  checkServerHealth,
  getServerUrl,
  setServerUrl,
} from "../api/client.js";
import { isNativeApp } from "../platform/native.js";

const isStoreRelease = import.meta.env?.VITE_STORE_RELEASE === "true";

function ServerConfigBox({ onServerChanged }) {
  const [url, setUrl] = useState(() => getServerUrl());
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);

  async function saveAndTest() {
    setTesting(true);
    setStatus("");
    try {
      const normalized = await setServerUrl(url);
      setUrl(normalized);
      const res = await checkServerHealth(normalized);
      setStatus(`连接成功（服务版本 ${res.version || "2.0"}）`);
      onServerChanged?.(normalized);
    } catch (err) {
      setStatus(`连接失败：${err.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <details className="server-box" open={isNativeApp()}>
      <summary>
        <Server size={16} />
        服务器地址设置{isNativeApp() ? "（安卓端）" : ""}
      </summary>
      <p className="fine">
        Web 浏览器默认留空连接当前站点；安卓 App 请填写局域网或公网后端地址（例如{" "}
        <code>http://192.168.1.10:8787</code> 或 <code>https://你的域名</code>）。
      </p>
      <div className="server-row">
        <input
          type="url"
          value={url}
          placeholder="留空使用同源接口，或填 http://IP:8787"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={testing}
          onClick={saveAndTest}
        >
          {testing ? "检测中…" : "保存并测速"}
        </button>
      </div>
      {isNativeApp() && (
        <div className="name-chips" style={{ marginTop: "6px" }}>
          {import.meta.env?.VITE_API_BASE_URL && (
            <button
              type="button"
              onClick={() => setUrl(import.meta.env.VITE_API_BASE_URL)}
            >
              默认预设服务器
            </button>
          )}
          <button
            type="button"
            onClick={() => setUrl("https://111.228.54.20")}
          >
            公网演示服
          </button>
        </div>
      )}
      {status && <p className="fine">{status}</p>}
    </details>
  );
}

export default function AuthModal({
  user,
  syncState,
  onAuthenticated,
  onUserUpdated,
  onLogout,
  onAccountDeleted,
  onSyncNow,
  onOpenAdmin,
  onOpenPrivacy,
  onServerChanged,
  requireLogin = false,
}) {
  const [tab, setTab] = useState("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Account edit & password change state when logged in
  const [editName, setEditName] = useState(user?.displayName || "");
  const [editPhone, setEditPhone] = useState(user?.phone || "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  async function handleDeleteAccount(e) {
    e.preventDefault();
    if (
      !window.confirm(
        "确定永久注销此账号？您的云端“我的家”、常去地点与照片将被立即永久删除，且无法恢复。",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await authDeleteAccount(deletePassword);
      setDeletePassword("");
      onAccountDeleted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const data =
        tab === "login"
          ? await authLogin({ username, password })
          : await authRegister({ username, displayName, phone, password });
      onAuthenticated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileSave(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await authUpdateMe({
        displayName: editName,
        phone: editPhone,
      });
      onUserUpdated(res.user);
      setInfo("个人资料已更新。");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSave(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await authChangePassword({ oldPassword, newPassword });
      setOldPassword("");
      setNewPassword("");
      onUserUpdated(res.user);
      setInfo("密码已修改，登录状态已更新。");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="auth-panel">
        <div className="account-card">
          <div className="account-avatar">
            {user.role === "admin" ? <ShieldCheck size={28} /> : <User size={28} />}
          </div>
          <div className="account-meta">
            <strong>{user.displayName}</strong>
            <span>
              账号：{user.username} ·{" "}
              <em className={"role-tag " + user.role}>
                {user.role === "admin" ? "管理员" : "普通用户"}
              </em>
            </span>
          </div>
        </div>

        {user.mustChangePassword && (
          <p role="alert" className="error">
            检测到当前账号正在使用初始密码，建议立即在下方修改为新密码。
          </p>
        )}

        <div className="sync-bar">
          <div>
            <Cloud size={18} />
            <span>
              云端同步：
              {syncState === "syncing"
                ? "正在同步…"
                : syncState === "synced"
                  ? "已与云端保持一致"
                  : syncState === "error"
                    ? "暂未连通（已保存在本机）"
                    : "就绪"}
            </span>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={onSyncNow}
            disabled={syncState === "syncing"}
          >
            <RefreshCw size={16} />
            立即同步
          </button>
        </div>

        {user.role === "admin" && (
          <button
            type="button"
            className="primary wide"
            onClick={onOpenAdmin}
          >
            <ShieldCheck size={20} />
            进入管理员控制台
          </button>
        )}

        <form className="auth-form" onSubmit={handleProfileSave}>
          <h3>个人资料</h3>
          <label className="field-label" htmlFor="acct-name">
            称呼 / 昵称
          </label>
          <input
            id="acct-name"
            value={editName}
            maxLength={24}
            onChange={(e) => setEditName(e.target.value)}
          />
          <label className="field-label" htmlFor="acct-phone">
            联系电话（可选，支持手机号登录）
          </label>
          <input
            id="acct-phone"
            value={editPhone}
            maxLength={20}
            onChange={(e) => setEditPhone(e.target.value)}
          />
          <button className="secondary wide" type="submit" disabled={busy}>
            保存资料
          </button>
        </form>

        <form className="auth-form" onSubmit={handlePasswordSave}>
          <h3>
            <KeyRound size={17} /> 修改登录密码
          </h3>
          <input
            type="password"
            placeholder="当前密码"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
          <input
            type="password"
            placeholder="新密码（至少 6 位）"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button
            className="secondary wide"
            type="submit"
            disabled={busy || !oldPassword || newPassword.length < 6}
          >
            确认修改密码
          </button>
        </form>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="success-note">
            <CheckCircle2 size={16} /> {info}
          </p>
        )}

        {!isStoreRelease && <ServerConfigBox onServerChanged={onServerChanged} />}

        <button
          type="button"
          className="danger-btn wide"
          onClick={onLogout}
        >
          <LogOut size={18} />
          退出当前账号
        </button>

        <details className="server-box danger-zone">
          <summary>
            <Trash2 size={16} />
            永久注销账号与云端数据
          </summary>
          <p className="fine">
            注销后将立即永久删除您的账号、云端“我的家”、常去地点及已同步照片，操作不可撤销。
          </p>
          <form className="auth-form" onSubmit={handleDeleteAccount}>
            <input
              type="password"
              required
              placeholder="输入当前登录密码确认注销"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
            <button
              type="submit"
              className="danger-btn wide"
              disabled={busy || !deletePassword}
            >
              <Trash2 size={16} />
              确认永久注销账号
            </button>
          </form>
        </details>

        {onOpenPrivacy && (
          <button
            type="button"
            className="text-btn"
            onClick={onOpenPrivacy}
          >
            <FileText size={16} />
            查看隐私政策与数据安全说明
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <p className="intro">
        {requireLogin
          ? "管理员已开启账号登录模式，请登录或注册后使用邻里地图。"
          : "登录后，您的家、常去地点、门面照片和大字偏好会自动云端备份，在网页和安卓 App 之间无缝同步。"}
      </p>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "login"}
          className={tab === "login" ? "active" : ""}
          onClick={() => {
            setTab("login");
            setError("");
          }}
        >
          账号登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          className={tab === "register" ? "active" : ""}
          onClick={() => {
            setTab("register");
            setError("");
          }}
        >
          注册新账号
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="auth-username">
          {tab === "login" ? "用户名或手机号" : "用户名（2~24 位）"}
        </label>
        <input
          id="auth-username"
          autoComplete="username"
          required
          value={username}
          placeholder={tab === "login" ? "输入用户名或手机号" : "例如：wang_grandpa"}
          onChange={(e) => setUsername(e.target.value)}
        />

        {tab === "register" && (
          <>
            <label className="field-label" htmlFor="auth-display">
              您的称呼（选填）
            </label>
            <input
              id="auth-display"
              value={displayName}
              maxLength={24}
              placeholder="例如：王爷爷"
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <label className="field-label" htmlFor="auth-phone">
              手机号（选填，方便子女协助找回）
            </label>
            <input
              id="auth-phone"
              type="tel"
              value={phone}
              maxLength={20}
              placeholder="选填"
              onChange={(e) => setPhone(e.target.value)}
            />
          </>
        )}

        <label className="field-label" htmlFor="auth-password">
          登录密码
        </label>
        <div className="password-wrap">
          <input
            id="auth-password"
            type={showPwd ? "text" : "password"}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            placeholder="至少 6 位字符"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="pwd-toggle"
            aria-label={showPwd ? "隐藏密码" : "显示密码"}
            onClick={() => setShowPwd(!showPwd)}
          >
            {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}

        <button className="primary wide" type="submit" disabled={busy}>
          {busy
            ? "正在提交…"
            : tab === "login"
              ? "立即登录"
              : "注册并自动登录"}
        </button>
        {onOpenPrivacy && (
          <p className="fine">
            登录或注册即表示您已知晓并同意{" "}
            <button
              type="button"
              className="inline-link-btn"
              onClick={onOpenPrivacy}
            >
              《邻里地图隐私政策》
            </button>
            ，您可随时在账号设置内永久注销账号。
          </p>
        )}
      </form>

      {!isStoreRelease && <ServerConfigBox onServerChanged={onServerChanged} />}
    </div>
  );
}
