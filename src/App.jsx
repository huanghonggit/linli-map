import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapIcon,
  Bookmark,
  CircleHelp,
  Volume2,
  VolumeX,
  Type,
  MapPin,
  LocateFixed,
  SlidersHorizontal,
  ChevronRight,
  ArrowRight,
  House,
  Navigation,
  Signpost,
  Images,
  Plus,
  ScanLine,
  LoaderCircle,
  RotateCw,
  Compass,
  ImagePlus,
  User,
  ShieldCheck,
  Megaphone,
  X,
} from "lucide-react";
import { ruiheCenter, ruiheLinkSettings, ruiheRanges } from "./modelAreas.js";
import { featured, inRange, readIndex } from "./recognition/places.js";
import {
  RecognitionList,
  RecognitionDetail,
  PhotoView,
  StreetScene,
} from "./recognition/Recognition.jsx";
import NeighborhoodMap from "./NeighborhoodMap.jsx";
import RoutePanel from "./RoutePanel.jsx";
import { Modal, Setup, ConfirmPoint, PlaceList, Help, PrivacyPolicy } from "./dialogs.jsx";
import AuthModal from "./auth/AuthModal.jsx";
import AdminDashboard from "./admin/AdminDashboard.jsx";
import {
  authLogout,
  authMe,
  fetchBootstrap,
  getToken,
  hydrateClientState,
  syncProfile,
} from "./api/client.js";
import { setMapRuntimeConfig } from "./map/runtimeConfig.js";
import { initNativeShell } from "./platform/native.js";
import { types, categories, sample, landmarks, defaultPins } from "./data.js";
import { meters, distanceText, zoneName, areaFor } from "./geo.js";
import {
  loadSettings,
  storeSettings,
  findNearby,
  speak,
  quiet,
  enableAudio,
} from "./services.js";
import { rememberCenter } from "./centers.js";
import { useNavigation } from "./useNavigation.js";

function Nearby({ type, settings, grid, onSelect, onResults }) {
  const local = useMemo(
    () =>
      sample
        .filter(
          (p) =>
            p.type === type &&
            meters(p, settings.center) <= settings.radius * 1000,
        )
        .sort(
          (a, b) => meters(a, settings.center) - meters(b, settings.center),
        ),
    [type, settings.center, settings.radius],
  );
  const [found, setFound] = useState(local),
    [status, setStatus] = useState("idle"),
    [error, setError] = useState("");
  const ctl = useRef(null);
  async function update() {
    ctl.current?.abort();
    const req = new AbortController();
    ctl.current = req;
    setStatus("busy");
    setError("");
    try {
      const list = await findNearby(
        settings.center,
        settings.radius,
        type,
        req.signal,
      );
      if (req.signal.aborted) return;
      const byId = new Map([...local, ...list].map((p) => [p.id, p]));
      const items = [...byId.values()].sort(
        (a, b) => meters(a, settings.center) - meters(b, settings.center),
      );
      setFound(items);
      onResults(items);
      setStatus("done");
    } catch (e) {
      if (!req.signal.aborted) {
        setError(e.message);
        setStatus("failed");
      }
    }
  }
  useEffect(() => {
    onResults(local);
    if (!local.length) update();
    return () => ctl.current?.abort();
  }, [local]);
  return (
    <>
      <p className="intro">
        方圆 {settings.radius} 公里，按离地图中心的距离排列。
      </p>
      <PlaceList
        places={found}
        center={settings.center}
        radius={settings.radius}
        grid={grid}
        onSelect={onSelect}
      />
      {!found.length && status === "done" && (
        <p className="empty">
          这个范围内还没有收录此类地点。可以扩大范围，也可以直接在地图上选点。
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
          {found.length ? " 已保留可用的地点。" : ""}
        </p>
      )}
      <button
        className="secondary wide"
        disabled={status === "busy"}
        onClick={update}
      >
        {status === "busy" ? (
          <LoaderCircle className="spin" />
        ) : (
          <RotateCw size={18} />
        )}{" "}
        {status === "busy"
          ? "正在查询附近地点…"
          : found.length
            ? "更新附近地点"
            : "重新查询"}
      </button>
    </>
  );
}
function Credits() {
  return (
    <div className="credit-copy">
      <h3>地图与路线</h3>
      <p>
        卫星影像来自{" "}
        <a
          href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9"
          target="_blank"
          rel="noreferrer"
        >
          Esri World Imagery
        </a>{" "}
        及贡献者。西湖底图使用 2016 Sentinel‑2 cloudless，含修改后的 Copernicus
        Sentinel 数据，由 EOX 制作（CC BY 4.0）。地形来自 Mapzen / AWS Terrain
        Tiles 和 Esri World Elevation。
      </p>
      <p>
        道路和地点数据 ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap contributors
        </a>
        （ODbL）。路线由 FOSSGIS 的 OSRM 步行和骑行服务提供。在线地点通过 Photon
        和 Overpass 查询。地名搜索使用 Photon，启用三维城市模型时通过 Cesium ion
        使用 Google Maps 搜索。地图资料有误时，可向 OpenStreetMap{" "}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
        >
          报告问题
        </a>
        。
      </p>
      <h3>瑞和苑街面实拍</h3>
      <p>
        门面照片来自高德地图地点页。周东南路和周建路的街面照片由 Mapillary 用户
        pLyMiEwGpWDLryMacQzo 拍摄于 2019 年 7 月，采用 CC BY-SA 4.0 许可。
        <a href="/recognition/SOURCES.txt" target="_blank" rel="noreferrer">
          查看照片原页与资料来源
        </a>
      </p>
      <h3>地标照片</h3>
      <p>
        白堤照片由钉钉拍摄，雷峰塔照片由 Yinweichen 拍摄，这两张照片按 CC BY-SA
        4.0 授权。曲院风荷照片由 zhiyin586 拍摄，按 CC BY 3.0
        授权。三张照片均来自 Wikimedia Commons，已缩小并转换为 WebP。
      </p>
      <p>
        <a
          target="_blank"
          rel="noreferrer"
          href="https://commons.wikimedia.org/wiki/File:Bai_Causeway.jpg"
        >
          白堤原图
        </a>{" "}
        ·{" "}
        <a
          target="_blank"
          rel="noreferrer"
          href="https://commons.wikimedia.org/wiki/File:Leifeng_Pagoda_at_Dusk.jpg"
        >
          雷峰塔原图
        </a>{" "}
        ·{" "}
        <a
          target="_blank"
          rel="noreferrer"
          href="https://commons.wikimedia.org/wiki/File:杭州._曲院风荷（荷花展）_-_panoramio_(8).jpg"
        >
          曲院风荷原图
        </a>{" "}
        ·{" "}
        <a
          target="_blank"
          rel="noreferrer"
          href="https://creativecommons.org/licenses/by-sa/4.0/"
        >
          CC BY-SA 4.0
        </a>{" "}
        ·{" "}
        <a
          target="_blank"
          rel="noreferrer"
          href="https://creativecommons.org/licenses/by/3.0/"
        >
          CC BY 3.0
        </a>
      </p>
    </div>
  );
}
export default function App() {
  const [cfg, setCfg] = useState(() => ({
      ...loadSettings(),
      ...ruiheLinkSettings(window.location.search),
    })),
    cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (cfg.center.id === ruiheCenter.id && ruiheRanges.includes(cfg.radius)) {
      url.searchParams.set("map", "ruiheyuan");
      url.searchParams.set("radius", String(cfg.radius));
    } else if (url.searchParams.get("map") === "ruiheyuan") {
      url.searchParams.delete("map");
      url.searchParams.delete("radius");
      url.searchParams.delete("look");
    }
    if (url.href !== window.location.href)
      window.history.replaceState(window.history.state, "", url);
  }, [cfg.center.id, cfg.radius]);
  const [modal, setModal] = useState(() => {
      const kind = new URLSearchParams(window.location.search).get("look");
      return ["junction", "shop"].includes(kind) &&
        meters(cfg.center, ruiheCenter) < 10000
        ? { kind: "recognize-list", listKind: kind }
        : null;
    }),
    [grid, setGrid] = useState(false),
    [picking, setPicking] = useState(null),
    [selected, setSelected] = useState(null),
    [extra, setExtra] = useState([]);
  const [toast, setToast] = useState(""),
    [user, setUser] = useState(null),
    [syncState, setSyncState] = useState("idle"),
    [requireLogin, setRequireLogin] = useState(false),
    [announcements, setAnnouncements] = useState([]),
    [dismissedAnn, setDismissedAnn] = useState(new Set()),
    [communityLandmarks, setCommunityLandmarks] = useState([]),
    timer = useRef(null),
    syncTimer = useRef(null),
    userRef = useRef(null),
    modalRef = useRef(null),
    mapRef = useRef(null),
    sideRef = useRef(null);
  userRef.current = user;
  modalRef.current = modal;

  function notify(msg) {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4100);
  }

  function mergeCloudProfile(localCfg, cloud) {
    if (!cloud) return localCfg;
    const mergedSaved = [
      ...new Map(
        [...(localCfg.saved || []), ...(cloud.saved || [])].map((p) => [p.id, p]),
      ).values(),
    ];
    let mergedCenters = [...(localCfg.centers || [])];
    for (const c of cloud.centers || []) {
      mergedCenters = rememberCenter(mergedCenters, c);
    }
    const center =
      cloud.center && !localCfg.center?.example
        ? localCfg.center
        : cloud.center || localCfg.center;
    return {
      ...localCfg,
      home: cloud.home || localCfg.home,
      center,
      centers: mergedCenters,
      saved: mergedSaved,
      radius: [1, 3, 5, 8, 10].includes(cloud.radius)
        ? cloud.radius
        : localCfg.radius,
      large: cloud.large ?? localCfg.large,
      voice: cloud.voice ?? localCfg.voice,
    };
  }

  async function pushProfileToCloud(snapshot = cfgRef.current) {
    if (!userRef.current) return;
    setSyncState("syncing");
    try {
      await syncProfile({
        home: snapshot.home,
        center: snapshot.center,
        centers: snapshot.centers,
        saved: snapshot.saved,
        radius: snapshot.radius,
        large: snapshot.large,
        voice: snapshot.voice,
      });
      setSyncState("synced");
    } catch {
      setSyncState("error");
    }
  }

  function scheduleCloudSync(snapshot) {
    if (!userRef.current) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void pushProfileToCloud(snapshot);
    }, 650);
  }

  async function refreshPublicData() {
    try {
      const data = await fetchBootstrap();
      if (data?.settings) {
        setMapRuntimeConfig(data.settings);
        setRequireLogin(Boolean(data.settings.requireLogin));
      }
      if (Array.isArray(data?.announcements)) {
        setAnnouncements(data.announcements);
      }
      if (Array.isArray(data?.landmarks)) {
        setCommunityLandmarks(data.landmarks);
      }
    } catch {
      /* offline or static-only mode works seamlessly without backend */
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      await hydrateClientState();
      void refreshPublicData();
      if (getToken()) {
        try {
          const data = await authMe();
          if (!active) return;
          setUser(data.user);
          const merged = mergeCloudProfile(cfgRef.current, data.profile);
          try {
            storeSettings(merged);
          } catch {
            /* ignore */
          }
          cfgRef.current = merged;
          setCfg(merged);
          setSyncState("synced");
        } catch {
          /* token expired or offline */
        }
      }
    })();
    const disposeNative = initNativeShell({
      onBackButton: () => {
        if (modalRef.current) {
          setModal(null);
          return true;
        }
        return false;
      },
    });
    return () => {
      active = false;
      clearTimeout(syncTimer.current);
      disposeNative();
    };
  }, []);

  function save(patch) {
    const next = { ...cfgRef.current, ...patch };
    try {
      storeSettings(next);
      cfgRef.current = next;
      setCfg(next);
      scheduleCloudSync(next);
      return true;
    } catch {
      notify("浏览器未能保存，请检查储存空间或隐私设置。");
      return false;
    }
  }

  function handleAuthenticated(session) {
    setUser(session.user);
    const merged = mergeCloudProfile(cfgRef.current, session.profile);
    try {
      storeSettings(merged);
    } catch {
      /* ignore */
    }
    cfgRef.current = merged;
    setCfg(merged);
    void pushProfileToCloud(merged);
    setModal(null);
    notify(
      `欢迎回来，${session.user.displayName}${session.user.role === "admin" ? "（管理员）" : ""}`,
    );
  }

  async function handleLogout() {
    await authLogout();
    setUser(null);
    setSyncState("idle");
    setModal(null);
    notify("已退出登录，本机数据仍保留。");
  }

  function handleAccountDeleted() {
    setUser(null);
    setSyncState("idle");
    setModal(null);
    notify("您的账号及全部云端数据已永久删除。");
  }
  const nav = useNavigation(cfg.center, cfg.voice, mapRef);
  const navigating = ["running", "locating", "routing"].includes(nav.phase);
  function editLocked() {
    if (navigating) {
      notify("请先结束当前导航。");
      return true;
    }
    return false;
  }
  useEffect(() => {
    document.documentElement.dataset.large = String(cfg.large);
  }, [cfg.large]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hasStreetGuide = meters(cfg.center, ruiheCenter) <= 10000;
  const [streetIndex, setStreetIndex] = useState(null),
    [streetError, setStreetError] = useState(false);
  const accessStreetList = modal?.kind === "recognize-list";
  useEffect(() => {
    if (!hasStreetGuide || !accessStreetList || streetIndex) return;
    const controller = new AbortController();
    setStreetError(false);
    fetch("/recognition/ruihe-index.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((raw) => {
        if (!controller.signal.aborted) setStreetIndex(readIndex(raw));
      })
      .catch(() => {
        if (!controller.signal.aborted) setStreetError(true);
      });
    return () => controller.abort();
  }, [hasStreetGuide, accessStreetList, streetIndex]);
  const streetPlaces = useMemo(
    () =>
      hasStreetGuide
        ? inRange(streetIndex || featured, cfg.center, cfg.radius)
        : [],
    [hasStreetGuide, streetIndex, cfg.center, cfg.radius],
  );
  const streetPins = useMemo(
    () => (hasStreetGuide ? inRange(featured, cfg.center, cfg.radius) : []),
    [hasStreetGuide, cfg.center, cfg.radius],
  );
  function recognition(kind) {
    if (editLocked()) return;
    setPicking(null);
    setModal({ kind: "recognize-list", listKind: kind });
  }
  function showOnMap(p) {
    setSelected(p);
    setModal(null);
    mapRef.current?.focus(p, 300);
    document.querySelector(".map-card")?.scrollIntoView({ block: "center" });
  }
  const nearbyLandmarks = useMemo(
    () =>
      [...communityLandmarks, ...landmarks].filter(
        (p) => meters(p, cfg.center) <= cfg.radius * 1000,
      ),
    [communityLandmarks, cfg.center, cfg.radius],
  );
  const shelf = useMemo(
    () =>
      [
        ...new Map(
          [
            ...cfg.saved.filter(
              (p) => meters(p, cfg.center) <= cfg.radius * 1000,
            ),
            ...nearbyLandmarks,
          ].map((p) => [p.id, p]),
        ).values(),
      ].slice(0, 3),
    [cfg.saved, cfg.center, cfg.radius, nearbyLandmarks],
  );
  const pins = useMemo(
    () =>
      [
        ...new Map(
          [
            ...(selected ? [selected] : []),
            ...communityLandmarks,
            ...streetPins,
            ...cfg.saved,
            ...extra.slice(0, 10),
            ...defaultPins.map((id) => sample.find((p) => p.id === id)),
          ]
            .filter((p) => p && meters(p, cfg.center) <= cfg.radius * 1000)
            .map((p) => [p.id, p]),
        ).values(),
      ].slice(0, 20),
    [
      selected,
      communityLandmarks,
      streetPins,
      cfg.saved,
      extra,
      cfg.center,
      cfg.radius,
    ],
  );
  function detail(p, from = null) {
    if (editLocked()) return;
    const known = streetPlaces.find((x) => x.id === p.id);
    if (known) p = { ...known, ...p };
    setSelected(p);
    setModal({ kind: p.kind ? "recognize-point" : "detail", p, from });
  }
  function setup(purpose, from = null) {
    if (purpose !== "center" && editLocked()) return;
    setPicking(null);
    setModal({ kind: "setup", purpose, from });
  }
  function candidate(p, purpose, from) {
    setModal({ kind: "confirm", p, purpose, from });
  }
  function changeRadius(radius) {
    if (save({ radius })) {
      setExtra([]);
      notify(`范围已设为 ${radius} 公里`);
    }
  }
  function applyCenter(
    p,
    { setHome = false, onlySave = false, returnHome = false } = {},
  ) {
    const centers = rememberCenter(cfgRef.current.centers, p);
    if (onlySave) {
      if (!save({ centers })) return;
      setModal({ kind: "setup", purpose: "center" });
      notify(`已保存中心点“${centers[0].name}”`);
      return;
    }
    const center = setHome
      ? { ...centers[0], id: "my-home", type: "home", name: "我的家" }
      : centers[0];
    const radius =
      meters(center, ruiheCenter) < 2 &&
      !ruiheRanges.includes(cfgRef.current.radius)
        ? 5
        : cfgRef.current.radius;
    if (
      !save({ centers, center, radius, ...(setHome ? { home: center } : {}) })
    )
      return;
    nav.end();
    setGrid(false);
    setExtra([]);
    setSelected(null);
    setPicking(null);
    setModal(null);
    notify(setHome ? "家的位置已保存" : `地图中心已切换到${center.name}`);
    if (returnHome) nav.start(center, "foot");
  }
  function switchSavedCenter(p) {
    if (navigating)
      candidate(p, "center", { kind: "setup", purpose: "center" });
    else applyCenter(p);
  }
  function commit(p, also, onlySave = false) {
    const { purpose, from } = modal;
    // Persist the chosen place only. A one-time GPS fix may also include time, heading and accuracy.
    p = {
      id: p.id,
      name: p.name,
      type: p.type,
      lat: p.lat,
      lon: p.lon,
      ...(p.photo ? { photo: p.photo } : {}),
      ...(p.hint ? { hint: p.hint } : {}),
    };
    if (purpose === "home" || purpose === "center") {
      applyCenter(p, {
        setHome: purpose === "home" || also,
        onlySave,
        returnHome: purpose === "home" && from === "returnHome",
      });
    } else {
      const list = [p, ...cfg.saved.filter((x) => x.id !== p.id)];
      if (!save({ saved: list })) return;
      setModal({ kind: "saved" });
      notify("已存到常去地点");
    }
  }
  function pick(p) {
    if (!picking) return;
    const target = {
      id: `point-${p.lat.toFixed(6)}-${p.lon.toFixed(6)}`,
      type: "point",
      name: "地图上的位置",
      lat: p.lat,
      lon: p.lon,
    };
    const state = picking;
    setPicking(null);
    candidate(target, state.purpose, state.from);
  }
  function chooseCategory(type) {
    if (editLocked()) return;
    setPicking(null);
    setModal({ kind: "category", type });
  }
  function plan(p) {
    if (editLocked()) return;
    setPicking(null);
    setModal(null);
    setSelected(p);
    mapRef.current?.exitExpanded();
    nav.plan(p);
    setTimeout(() => {
      if (matchMedia("(max-width:800px)").matches)
        sideRef.current?.scrollIntoView({
          behavior: "instant",
          block: "start",
        });
    }, 20);
  }
  function home() {
    if (editLocked()) return;
    if (cfg.home) {
      close();
      setSelected(cfg.home);
      nav.start(cfg.home, "foot");
      if (matchMedia("(max-width:800px)").matches)
        sideRef.current?.scrollIntoView({ block: "start" });
    } else setup("home", "returnHome");
  }
  function endNav() {
    nav.end();
    setSelected(null);
    mapRef.current?.showNeighborhood();
  }
  function close() {
    setModal(null);
  }
  const title =
    modal &&
    {
      auth: user ? "我的账号与云同步" : "登录 / 注册账号",
      admin: "管理员控制台",
      privacy: "隐私政策与数据安全",
      saved: "我的常去地点",
      help: "使用帮助",
      credits: "数据与照片来源",
      "recognize-list": modal.listKind === "shop" ? "认店铺" : "认路口",
      "recognize-point":
        modal.p?.kind === "shop" ? "看门面认店铺" : "看路牌认路口",
      "street-photo": "实拍大图",
      "street-pano": "看街面实景",
      landmarks: "认地标找路",
      detail: modal.p?.name,
      category: types[modal.type]?.name,
      setup:
        modal.purpose === "home"
          ? "设置我的家"
          : modal.purpose === "save"
            ? "添加常去地点"
            : "设置地图中心",
      confirm:
        modal.purpose === "home"
          ? "确认家的位置"
          : modal.purpose === "save"
            ? "保存常去地点"
            : "确认地图中心",
      end: "结束这次导航？",
      remove: "移出常去地点？",
    }[modal.kind];
  const backup =
    modal?.from && typeof modal.from === "object"
      ? () => setModal(modal.from)
      : undefined;
  const activeTab =
    modal?.kind === "saved"
      ? "saved"
      : modal?.kind === "help"
        ? "help"
        : modal?.kind === "auth"
          ? "auth"
          : modal?.kind === "admin"
            ? "admin"
            : "map";
  const visibleAnnouncements = announcements.filter(
    (a) => !dismissedAnn.has(a.id),
  );
  const effectiveModal =
    requireLogin && !user ? { kind: "auth" } : modal;
  const effectiveTitle =
    requireLogin && !user ? "登录 / 注册账号" : title;
  return (
    <>
      <a href="#main" className="skip">
        跳到周边地图
      </a>
      <header className="topbar">
        <div className="top-inner">
          <button
            className="brand"
            onClick={() => {
              close();
              window.scrollTo({ top: 0, behavior: "instant" });
            }}
            aria-label="邻里地图首页"
          >
            <img alt="" src="/mark.svg" />
            <b>邻里地图</b>
            <span>长辈版</span>
          </button>
          <nav aria-label="主导航">
            {[
              ["map", "周边地图", MapIcon],
              ["saved", "常去地点", Bookmark],
              ["help", "使用帮助", CircleHelp],
              [
                "auth",
                user ? user.displayName.slice(0, 6) : "账号登录",
                user?.role === "admin" ? ShieldCheck : User,
              ],
              ...(user?.role === "admin"
                ? [["admin", "管理后台", ShieldCheck]]
                : []),
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                className={
                  (activeTab === key ? "active " : "") +
                  (key === "admin" ? "admin-nav-btn" : "")
                }
                onClick={() =>
                  key === "map"
                    ? (close(),
                      window.scrollTo({ top: 0, behavior: "instant" }))
                    : setModal({ kind: key })
                }
              >
                <Icon size={19} />
                {label}
              </button>
            ))}
          </nav>
          <div className="prefs">
            <button
              aria-pressed={cfg.voice}
              aria-label={cfg.voice ? "关闭语音播报" : "开启语音播报"}
              onClick={() => {
                enableAudio();
                const val = !cfg.voice;
                if (save({ voice: val })) {
                  if (val) speak("语音播报已开启");
                  else quiet();
                  notify(val ? "已开启语音播报" : "已关闭语音播报");
                }
              }}
            >
              {cfg.voice ? <Volume2 /> : <VolumeX />}
              <span>语音{cfg.voice ? "开" : "关"}</span>
            </button>
            <button
              aria-pressed={cfg.large}
              onClick={() => {
                if (save({ large: !cfg.large }))
                  notify(cfg.large ? "已恢复标准字号" : "已开启大字模式");
              }}
            >
              <Type />
              <span>大字模式</span>
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="page">
        {visibleAnnouncements.length > 0 && (
          <div
            className={"announce-bar " + visibleAnnouncements[0].level}
            role="region"
            aria-label="社区通知"
          >
            <Megaphone size={18} />
            <div className="announce-copy">
              <strong>{visibleAnnouncements[0].title}</strong>
              <span>{visibleAnnouncements[0].content}</span>
            </div>
            <button
              type="button"
              className="secondary announce-speak"
              onClick={() => {
                enableAudio();
                speak(
                  `${visibleAnnouncements[0].title}。${visibleAnnouncements[0].content}`,
                );
              }}
            >
              <Volume2 size={16} />
              读给我听
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="关闭通知"
              onClick={() =>
                setDismissedAnn(
                  (prev) => new Set([...prev, visibleAnnouncements[0].id]),
                )
              }
            >
              <X size={17} />
            </button>
          </div>
        )}
        <div className="page-heading">
          <div>
            <div className="heading-line">
              <h1>我的周边地图</h1>
              <button
                className="range-badge"
                aria-label={`查看方圆 ${cfg.radius} 公里的完整地图`}
                onClick={() => mapRef.current?.fitArea()}
              >
                <ScanLine size={14} />
                方圆 {cfg.radius} 公里
              </button>
            </div>
            <p>
              <MapPin size={17} />
              当前中心
              <span className="place-title">
                {cfg.center.example ? "杭州 · 湖滨公园" : cfg.center.name}
              </span>
              {cfg.center.example && <small>示例</small>}
            </p>
          </div>
          <button
            className="secondary center-btn"
            onClick={() => setup("center")}
          >
            <SlidersHorizontal size={18} />
            设置中心
          </button>
        </div>
        <div className="workspace">
          <NeighborhoodMap
            ref={mapRef}
            center={cfg.center}
            radius={cfg.radius}
            onRadius={changeRadius}
            pins={pins}
            selected={selected}
            onSelect={(p) => detail(p)}
            onStreetPhoto={p => setModal({ kind: "street-photo", p })}
            onRecognize={hasStreetGuide ? recognition : null}
            grid={grid}
            setGrid={setGrid}
            picking={!!picking}
            onPick={pick}
            onCancelPick={() => setPicking(null)}
            route={nav.route}
            fix={nav.fix}
            notify={notify}
          />
          <div className="sidebar" ref={sideRef}>
            {nav.phase !== "idle" ? (
              <RoutePanel
                nav={nav}
                onRecognizePoint={(p) =>
                  setModal({ kind: "recognize-point", p })
                }
                center={cfg.center}
                voice={cfg.voice}
                onEnd={() =>
                  nav.phase === "running" ? setModal({ kind: "end" }) : endNav()
                }
              />
            ) : (
              <>
                <aside className="side-card finder">
                  <div className="finder-title">
                    <span className="side-glyph">
                      <Signpost />
                    </span>
                    <h2>想去哪里？</h2>
                  </div>
                  <p>点一下图标，找附近的地方。</p>
                  <div className="categories">
                    {categories.map((key) => {
                      const t = types[key];
                      return (
                        <button
                          key={key}
                          className={"category " + t.color}
                          onClick={() => chooseCategory(key)}
                        >
                          <span className="category-icon">
                            <t.Icon size={28} strokeWidth={2} />
                          </span>
                          <strong>{t.name}</strong>
                        </button>
                      );
                    })}
                  </div>
                </aside>
                <button className="home-card" onClick={home}>
                  <span className="home-symbol">
                    <House size={27} />
                  </span>
                  <span>
                    <strong>一键回家</strong>
                    <small>
                      {cfg.home ? "从当前位置步行回家" : "先设置家，出门好找路"}
                    </small>
                  </span>
                  <ArrowRight className="home-arrow" size={23} />
                </button>
              </>
            )}
          </div>
        </div>
        <section className="shelf">
          <div className="shelf-head">
            <div>
              <div className="shelf-title">
                <Images />
                <h2>认地标找路</h2>
              </div>
              <p>看熟悉的照片，选想去的地方。</p>
            </div>
            <button
              className="text-btn"
              onClick={() => setModal({ kind: "landmarks" })}
            >
              查看全部
              <ArrowRight size={17} />
            </button>
          </div>
          {shelf.length ? (
            <div className="landmark-cards">
              {shelf.map((p) => {
                const t = types[p.type] || types.point;
                return (
                  <button
                    key={p.id}
                    className="landmark-card"
                    onClick={() => detail(p)}
                  >
                    {p.photo ? (
                      <img src={p.photo} alt="" />
                    ) : (
                      <span className={"landmark-placeholder " + t.color}>
                        <t.Icon size={32} />
                      </span>
                    )}
                    <span className="landmark-info">
                      <strong>{p.name}</strong>
                      <small>
                        <MapPin size={14} />
                        {p.hint || t.short} ·{" "}
                        {distanceText(meters(cfg.center, p))}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                );
              })}
            </div>
          ) : (
            <button className="empty-shelf" onClick={() => setup("save")}>
              <ImagePlus />
              添加熟悉地点的照片
            </button>
          )}
        </section>
        <footer>
          <span>
            <Compass size={15} />
            邻里地图
          </span>
          <button onClick={() => setModal({ kind: "credits" })}>
            影像 Copernicus、Esri、EOX · © OpenStreetMap 贡献者 · 来源与许可
          </button>
        </footer>
      </main>
      {!!toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {effectiveModal && (
        <Modal
          title={effectiveTitle}
          back={backup}
          close={close}
          wide={effectiveModal.kind === "admin"}
          closable={!(requireLogin && !user)}
        >
          {effectiveModal.kind === "auth" && (
            <AuthModal
              user={user}
              syncState={syncState}
              requireLogin={requireLogin}
              onAuthenticated={handleAuthenticated}
              onUserUpdated={(u) => setUser(u)}
              onLogout={handleLogout}
              onAccountDeleted={handleAccountDeleted}
              onSyncNow={() => pushProfileToCloud()}
              onOpenAdmin={() => setModal({ kind: "admin" })}
              onOpenPrivacy={() =>
                setModal({ kind: "privacy", from: effectiveModal })
              }
              onServerChanged={() => void refreshPublicData()}
            />
          )}
          {modal && effectiveModal.kind === "privacy" && <PrivacyPolicy />}
          {effectiveModal.kind === "admin" && user?.role === "admin" && (
            <AdminDashboard
              currentUser={user}
              currentCenter={cfg.center}
              onRefreshPublic={refreshPublicData}
              notify={notify}
            />
          )}
          {modal && effectiveModal.kind === "recognize-list" && (
            <>
              {streetError && (
                <p className="fine" role="status">
                  在线地点清单暂未载入，仍可查看已核对的地点。
                </p>
              )}
              <RecognitionList
                key={modal.listKind}
                kind={modal.listKind}
                center={cfg.center}
                list={streetPlaces}
                loading={!streetIndex && !streetError}
                onSelect={(p) => detail(p, modal)}
              />
            </>
          )}
          {modal && effectiveModal.kind === "recognize-point" && (
            <RecognitionDetail
              key={modal.p.id}
              p={modal.p}
              onPoint={(p) => detail(p, modal)}
              onMap={showOnMap}
              onGo={navigating ? null : plan}
              onSave={
                navigating ? null : (point) => candidate(point, "save", modal)
              }
              savedPhoto={
                cfg.saved.find(
                  (x) =>
                    x.id === modal.p.id && x.photo?.startsWith("data:image/"),
                )?.photo
              }
              onPhoto={(p) =>
                setModal({ kind: "street-photo", p, from: modal })
              }
              onPano={(p) => setModal({ kind: "street-pano", p, from: modal })}
            />
          )}
          {modal && effectiveModal.kind === "street-photo" && (
            <PhotoView key={modal.p.id} p={modal.p} />
          )}
          {modal && effectiveModal.kind === "street-pano" && (
            <StreetScene key={modal.p.id} p={modal.p} />
          )}
          {modal && effectiveModal.kind === "setup" && (
            <Setup
              key={modal.purpose}
              purpose={modal.purpose}
              settings={cfg}
              onPick={() => {
                setPicking({ purpose: modal.purpose, from: modal.from });
                close();
                document
                  .querySelector(".map-card")
                  ?.scrollIntoView({ block: "center" });
              }}
              onCandidate={(p) =>
                candidate(
                  p,
                  modal.purpose,
                  modal.purpose === "center" ? modal : modal.from,
                )
              }
              onSwitchCenter={switchSavedCenter}
              onRange={changeRadius}
              onFull={() => {
                close();
                setGrid(true);
                mapRef.current?.fitArea();
              }}
            />
          )}
          {modal && effectiveModal.kind === "confirm" && (
            <ConfirmPoint
              key={modal.p.id}
              p={modal.p}
              purpose={modal.purpose}
              center={cfg.center}
              navigating={navigating}
              onConfirm={commit}
            />
          )}
          {modal && effectiveModal.kind === "category" && (
            <Nearby
              key={modal.type}
              type={modal.type}
              settings={cfg}
              grid={grid}
              onSelect={(p) => detail(p, modal)}
              onResults={setExtra}
            />
          )}
          {modal && effectiveModal.kind === "detail" && (
            <>
              {modal.p.photo && (
                <img
                  className="detail-photo"
                  alt={modal.p.name}
                  src={modal.p.photo}
                />
              )}
              <p className="detail-meta">
                <MapPin size={17} />
                {types[modal.p.type]?.short || "地点"} · 距中心{" "}
                {distanceText(meters(cfg.center, modal.p))}
                {grid &&
                  ` · ${zoneName(areaFor(modal.p, cfg.center, cfg.radius * 1000))}区`}
              </p>
              <button className="primary wide" onClick={() => plan(modal.p)}>
                <Navigation size={20} />
                去这里
              </button>
              <div className="detail-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    const p = modal.p,
                      old = cfg.saved.find((x) => x.id === p.id);
                    if (old) setModal({ kind: "remove", p, from: modal });
                    else candidate(p, "save", modal);
                  }}
                >
                  <Bookmark size={17} />
                  {cfg.saved.some((x) => x.id === modal.p.id)
                    ? "已收藏"
                    : "存为常去"}
                </button>
                <button
                  className="secondary"
                  onClick={() => candidate(modal.p, "center", modal)}
                >
                  <LocateFixed size={17} />
                  设为中心
                </button>
              </div>
              {cfg.saved.some((x) => x.id === modal.p.id) && (
                <button
                  className="text-btn"
                  onClick={() => candidate(modal.p, "save", modal)}
                >
                  <ImagePlus size={16} />
                  修改名称或照片
                </button>
              )}
            </>
          )}
          {modal && effectiveModal.kind === "saved" && (
            <>
              <p className="intro">
                {user
                  ? "常去的地方已随账号云端同步，更换手机也不会丢失。"
                  : "常去的地方保存在这台设备上，登录账号即可自动云端备份。"}
              </p>
              {cfg.saved.length ? (
                <PlaceList
                  places={cfg.saved}
                  center={cfg.center}
                  radius={cfg.radius}
                  onSelect={(p) => detail(p, modal)}
                />
              ) : (
                <div className="saved-empty">
                  <Bookmark />
                  <strong>还没有常去地点</strong>
                  <p>把菜场、公园或家人的住处加在这里。</p>
                </div>
              )}
              <button
                className="primary wide"
                onClick={() => setup("save", modal)}
              >
                <Plus size={19} />
                添加常去地点
              </button>
            </>
          )}
          {modal && effectiveModal.kind === "landmarks" && (
            <>
              <PlaceList
                places={[
                  ...new Map(
                    [
                      ...cfg.saved.filter(
                        (p) => meters(p, cfg.center) <= cfg.radius * 1000,
                      ),
                      ...nearbyLandmarks,
                    ].map((p) => [p.id, p]),
                  ).values(),
                ]}
                center={cfg.center}
                radius={cfg.radius}
                onSelect={(p) => detail(p, modal)}
              />
              <button
                className="secondary wide"
                onClick={() => setup("save", modal)}
              >
                <ImagePlus />
                添加熟悉的地点
              </button>
            </>
          )}
          {modal && effectiveModal.kind === "help" && (
            <Help
              onCredits={() => setModal({ kind: "credits", from: modal })}
              onPrivacy={() => setModal({ kind: "privacy", from: modal })}
            />
          )}
          {modal && effectiveModal.kind === "credits" && <Credits />}
          {modal && effectiveModal.kind === "remove" && (
            <>
              <p className="intro">确定将“{modal.p.name}”从本机收藏中移出？</p>
              <div className="detail-actions">
                <button className="secondary" onClick={backup}>
                  保留
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    if (
                      save({
                        saved: cfg.saved.filter((x) => x.id !== modal.p.id),
                      })
                    ) {
                      setModal({ kind: "saved" });
                      notify("已移出常去地点");
                    }
                  }}
                >
                  确认移出
                </button>
              </div>
            </>
          )}
          {modal && effectiveModal.kind === "end" && (
            <>
              <p className="intro">结束后会停止定位和偏航提醒。</p>
              <div className="detail-actions">
                <button className="secondary" onClick={close}>
                  继续导航
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    endNav();
                    close();
                  }}
                >
                  结束导航
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
