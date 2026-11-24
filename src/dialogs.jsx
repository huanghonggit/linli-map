import { ruiheCenter, ruiheRanges } from "./modelAreas.js";
import React, { useEffect, useRef, useState } from "react";
import {
  X,
  ArrowLeft,
  ChevronRight,
  MapPin,
  Bookmark,
  LocateFixed,
  House,
  MousePointer2,
  Check,
  MapPinned,
  ImagePlus,
  Map,
  Navigation,
  Grid3X3,
} from "lucide-react";
import { CenterSearch, SavedCenters } from "./CenterPicker.jsx";
import { types } from "./data.js";
import { meters, distanceText, zoneName, areaFor } from "./geo.js";
import { locate, smallPhoto } from "./services.js";
import { isNativeApp } from "./platform/native.js";
export function Modal({
  title,
  back,
  close,
  wide = false,
  closable = true,
  children,
}) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current,
      prior = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    el.querySelector(".dialog-body").scrollTop = 0;
    el.querySelector("h2").focus({ preventScroll: true });
  }, [title]);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide-dialog" : ""}
      onCancel={(e) => {
        e.preventDefault();
        if (closable) close();
      }}
      onClick={(e) => {
        if (closable && e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-head">
        {back && (
          <button className="icon-btn" aria-label="返回上一步" onClick={back}>
            <ArrowLeft />
          </button>
        )}
        <h2 tabIndex={-1} id="dialog-title">
          {title}
        </h2>
        {closable && (
          <button
            className="icon-btn close"
            aria-label="关闭窗口"
            onClick={close}
          >
            <X />
          </button>
        )}
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function PlaceList({ places, center, radius, onSelect, grid = false }) {
  return (
    <div className="place-list">
      {places.map((p) => {
        const meta = types[p.type] || types.point;
        return (
          <button key={p.id} onClick={() => onSelect(p)}>
            {p.photo ? (
              <img alt="" src={p.photo} />
            ) : (
              <span className={"tile-icon " + meta.color}>
                <meta.Icon />
              </span>
            )}
            <span className="row-copy">
              <strong>{p.name}</strong>
              <small>
                {grid
                  ? `${zoneName(areaFor(p, center, radius * 1000))}区 · `
                  : ""}
                距中心 {distanceText(meters(center, p))}
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
        );
      })}
    </div>
  );
}
export function Setup({
  purpose,
  settings,
  onPick,
  onCandidate,
  onSwitchCenter,
  onRange,
  onFull,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    gpsRequest = useRef(null);
  const [locatingPrecisely, setLocatingPrecisely] = useState(false);
  useEffect(
    () => () => {
      alive.current = false;
      gpsRequest.current?.abort();
    },
    [],
  );
  async function gps() {
    setBusy(true);
    setError("");
    try {
      gpsRequest.current = new AbortController();
      setLocatingPrecisely(false);
      const p = await locate({
        forCenter: true,
        signal: gpsRequest.current.signal,
        onApproximate: () => setLocatingPrecisely(true),
      });
      if (!alive.current) return;
      if (p.accuracy > 65)
        throw Error(
          `定位误差约 ${Math.round(p.accuracy)} 米。可以在地图上点选准确的位置。`,
        );
      onCandidate({
        ...p,
        name: "当前位置",
        type: "point",
        id: "gps-" + Date.now(),
      });
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      {purpose === "center" ? (
        <CenterSearch onSelect={onCandidate} saved={settings.centers} />
      ) : (
        <p className="intro">
          {purpose === "home"
            ? "选好家的位置，下次点“一键回家”就能出发。"
            : "在地图上点选地点，或把您现在的位置存下来。"}
        </p>
      )}
      <div className="choices">
        <button onClick={gps} disabled={busy}>
          <LocateFixed />
          <span>
            {busy
              ? locatingPrecisely
                ? "正在提高定位精度…"
                : "正在定位…"
              : "使用当前位置"}
          </span>
          <ChevronRight />
        </button>
        <button onClick={onPick}>
          <MousePointer2 />
          <span>在地图上点选</span>
          <ChevronRight />
        </button>
        {purpose === "center" && settings.home && (
          <button onClick={() => onCandidate(settings.home)}>
            <House />
            <span>以家为中心</span>
            <ChevronRight />
          </button>
        )}
        {purpose === "home" && !settings.center.example && (
          <button onClick={() => onCandidate(settings.center)}>
            <MapPinned />
            <span>使用当前地图中心</span>
            <ChevronRight />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {purpose === "center" && (
        <>
          <SavedCenters
            centers={settings.centers}
            current={settings.center}
            onSwitch={onSwitchCenter}
          />
          <h3>周边范围</h3>
          <div className="radius-row">
            {(meters(settings.center, ruiheCenter) < 2
              ? ruiheRanges
              : [1, 3, 5, 8, 10]
            ).map((n) => (
              <button
                aria-pressed={n === settings.radius}
                key={n}
                onClick={() => onRange(n)}
              >
                {n} 公里
              </button>
            ))}
          </div>
          <button className="text-btn" onClick={onFull}>
            <Map size={17} />
            查看整个范围
          </button>
        </>
      )}
      {!!settings.saved.length && (
        <>
          <h3>从常去地点选择</h3>
          <PlaceList
            places={settings.saved}
            center={settings.center}
            radius={settings.radius}
            onSelect={onCandidate}
          />
        </>
      )}
    </>
  );
}
export function ConfirmPoint({ p, purpose, onConfirm, center, navigating }) {
  const [name, setName] = useState(purpose === "home" ? "我的家" : p.name),
    [also, setAlso] = useState(false),
    [photo, setPhoto] = useState(p.photo || ""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const friendly =
    purpose === "save"
      ? ["买菜的地方", "散步的地方", "家人住处", "常去的医院"]
      : ["家附近", "家人住处", "散步的地方"];
  async function takePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setWorking(true);
    try {
      setPhoto(await smallPhoto(file));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }
  function confirm(onlySave = false) {
    onConfirm(
      { ...p, name: name.trim(), ...(photo ? { photo } : {}), example: false },
      also,
      onlySave,
    );
  }
  return (
    <>
      <div className="point-summary">
        <MapPin />
        <div>
          <strong>{p.name}</strong>
          {p.hint && <small>{p.hint}</small>}
          <small>距原地图中心 {distanceText(meters(center, p))}</small>
        </div>
      </div>
      {purpose !== "home" && (
        <>
          <label className="field-label" htmlFor="place-name">
            地点名称
          </label>
          <input
            id="place-name"
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="name-chips">
            {friendly.map((n) => (
              <button key={n} onClick={() => setName(n)}>
                {n}
              </button>
            ))}
          </div>
        </>
      )}
      {purpose === "save" && (
        <label className="upload">
          {photo ? <img src={photo} alt="已选地点照片" /> : <ImagePlus />}
          {photo ? "更换地点照片" : "加一张认路的照片"}
          <input type="file" accept="image/*" onChange={takePhoto} />
        </label>
      )}
      {purpose === "center" && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={also}
            onChange={(e) => setAlso(e.target.checked)}
          />
          这里也是我的家
        </label>
      )}
      {purpose === "home" && (
        <p className="intro">保存后，地图会以家为中心。</p>
      )}
      {error && <p className="error">{error}</p>}
      <button
        className="primary wide"
        disabled={working || !name.trim()}
        onClick={() => confirm()}
      >
        <Check />
        {purpose === "home"
          ? "确认家的位置"
          : purpose === "center"
            ? navigating
              ? "结束导航并切换中心"
              : "设为地图中心"
            : "保存到常去地点"}
      </button>
      {purpose === "center" && !also && (
        <button
          className="secondary wide"
          disabled={!name.trim()}
          onClick={() => confirm(true)}
        >
          只保存中心点
        </button>
      )}
    </>
  );
}
export function Help({ onCredits, onPrivacy }) {
  const native = isNativeApp();
  return (
    <>
      <div className="help-item">
        <span className="tile-icon green">
          <MapPin />
        </span>
        <div>
          <h3>换城市、设家的位置</h3>
          <p>
            点“设置中心”，输入城市或地标，也可以用当前位置。保存后在“我的中心点”里点名字就能切换。要设家时，勾选“这里也是我的家”。
          </p>
        </div>
      </div>
      <div className="help-item">
        <span className="tile-icon orange">
          <Bookmark />
        </span>
        <div>
          <h3>认图标、认照片</h3>
          <p>
            点菜篮找购物点，点树找公园。地点详情里可以收藏，给常去的地方放一张自己拍的照片。
          </p>
        </div>
      </div>
      <div className="help-item">
        <span className="tile-icon teal">
          <Navigation />
        </span>
        <div>
          <h3>跟着指针走</h3>
          <p>
            选步行或骑行，允许定位后开始。保持屏幕常亮。定位不准时，页面会提示您等一等。过街请以信号灯和现场路况为准。
          </p>
        </div>
      </div>
      <div className="help-item">
        <span className="tile-icon blue">
          <Grid3X3 />
        </span>
        <div>
          <h3>家在哪个方向？</h3>
          <p>
            {native
              ? "打开地图下方的九宫格，可以按东南西北认区域。家的位置和收藏保存在本机，登录账号后会自动云端同步。"
              : "打开地图下方的九宫格，可以按东南西北认区域。家的位置和收藏默认保存在本机，登录账号后可跨设备云端同步。"}
          </p>
        </div>
      </div>
      <p className="fine">
        在线搜索会发送输入的地名。查附近地点会发送查询中心，规划路线会发送起点和终点。
      </p>
      {onPrivacy && (
        <button className="text-btn" onClick={onPrivacy}>
          隐私政策与数据安全说明
          <ChevronRight size={16} />
        </button>
      )}
      <button className="text-btn" onClick={onCredits}>
        查看地图与照片来源
        <ChevronRight size={16} />
      </button>
    </>
  );
}

export function PrivacyPolicy() {
  return (
    <div className="credit-copy">
      <h3>信息收集与用途</h3>
      <p>
        邻里地图支持免注册直接使用。仅在您主动注册/登录账号时，保存您的用户名、称呼、可选手机号与不可逆加密密码，用于同步“我的家”、常去地点与认路照片。
      </p>
      <h3>定位与相册权限</h3>
      <p>
        仅当您点击“使用当前位置”“一键回家”或开启步行/骑行导航时才在前台获取位置，结束导航立即停止监听，不进行任何后台静默追踪；相册权限仅在您主动为地点添加照片时使用。
      </p>
      <h3>广告、追踪与数据删除</h3>
      <p>
        本应用不含任何广告或跨应用追踪。您可随时在“账号中心 → 永久注销账号”中一键永久删除账号及所有云端数据，或通过网页端{" "}
        <a href="/account-deletion.html" target="_blank" rel="noreferrer">
          自助删除页面
        </a>{" "}
        提交删除。
      </p>
      <p>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          打开完整隐私政策网页版
        </a>
      </p>
    </div>
  );
}
