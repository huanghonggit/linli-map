import { streetFile } from "./recognition/streetMedia.js";
import presets from "virtual:neighborhood-presets";
import { useExpandedMap } from "./useExpandedMap.js";
import React, {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  useMemo,
  useLayoutEffect,
} from "react";
import {
  Box,
  Building2,
  Layers2,
  Plus,
  Minus,
  LocateFixed,
  Grid3X3,
  ScanSearch,
  Maximize,
  Minimize,
  Camera,
  ChevronRight,
  RotateCcw,
  RotateCw,
  Signpost,
  Store,
  MapPin,
  Navigation2,
  X,
  House,
  Sun,
} from "lucide-react";
import { modelArea, modelPath } from "./modelAreas.js";
import { flatMap, globeMap } from "./mapEngines.js";
import { makeGrid, offset, meters, distanceText } from "./geo.js";
import { types, exampleCenter } from "./data.js";

const gridLabels = [
  "西北",
  "北",
  "东北",
  "西",
  "中心",
  "东",
  "西南",
  "南",
  "东南",
];
const lake = {
  id: "lake-label",
  lon: 120.1371,
  lat: 30.2457,
  type: "water",
  name: "西 湖",
};
const NeighborhoodMap = forwardRef(function NeighborhoodMap(
  {
    center,
    radius,
    onRadius,
    pins,
    selected,
    onSelect,
    onRecognize,
    onStreetPhoto,
    grid,
    setGrid,
    picking,
    onPick,
    onCancelPick,
    route,
    fix,
    notify,
  },
  ref,
) {
  const card = useRef(null);
  const full = useExpandedMap(card);
  const root = useRef(null),
    flat = useRef(null),
    three = useRef(null),
    active = useRef(null),
    compass = useRef(null),
    scale = useRef(null);
  const state = useRef(null),
    markerNodes = useRef(new Map()),
    measureCache = useRef(new Map()),
    draw = useRef(() => {}),
    viewTarget = useRef({ p: center, span: 5200 });
  const [wanted, setWanted] = useState("auto"),
    [mode, setMode] = useState("flat"),
    [unsupported, setUnsupported] = useState(false);
  const area = modelArea(center, radius);
  const desired =
    wanted === "auto"
      ? area
        ? "model"
        : "globe"
      : wanted === "model" && !area
        ? "globe"
        : wanted;
  const [metadata, setMetadata] = useState(null);
  const [closeView, setCloseView] = useState("off");
  const [nearPhoto, setNearPhoto] = useState(null);
  const [atPhotoLimit, setAtPhotoLimit] = useState(false);
  const limitRef = useRef(false);
  const [motion, setMotion] = useState(() => {
    try { return localStorage.getItem("linli:camera-motion") !== "off"; } catch { return true; }
  });
  const reduce = useRef(matchMedia("(prefers-reduced-motion: reduce)"));
  const [reduced, setReduced] = useState(reduce.current.matches);
  useEffect(() => {
    const media = reduce.current;
    const change = () => { setReduced(media.matches); if (media.matches) active.current?.cancelMotion?.(); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  function toggleMotion() {
    const next = !motion;
    setMotion(next);
    if (!next) active.current?.cancelMotion?.();
    try { localStorage.setItem("linli:camera-motion", next ? "on" : "off"); } catch { /* device storage is optional */ }
  }
  const startInStreet = useRef(new URLSearchParams(location.search).get("view") === "street");
  const nearestKey = useRef("");
  const [texture, setTexture] = useState("local"),
    [showBuildings, setShowBuildings] = useState(true),
    [lighting, setLighting] = useState("day");
  const lightingCycle = [
    ["day", "晴日"],
    ["golden", "暖阳"],
    ["clear", "柔和"],
  ];
  function cycleLighting() {
    const idx = lightingCycle.findIndex(([k]) => k === lighting);
    const [nextKey, nextLabel] = lightingCycle[(idx + 1) % lightingCycle.length];
    const applied = active.current?.setLighting?.(nextKey) || nextKey;
    setLighting(applied);
    notify?.(`光影已切换为${nextLabel}`);
  }
  const [imageStates, setImageStates] = useState({
    flat: "loading",
    globe: "loading",
    model: "loading",
  });
  const lastImage = useRef({ flat: "loading", globe: "loading" });
  function reportImagery(engine, status) {
    if (lastImage.current[engine] === status) return;
    lastImage.current[engine] = status;
    setImageStates((previous) => ({ ...previous, [engine]: status }));
  }
  const storefronts = useMemo(() => pins.filter(p => p.kind === "shop" && p.photo), [pins]);
  const [visiting, setVisiting] = useState(null);
  const shop = !picking && storefronts.find(p => p.id === visiting);
  useEffect(() => { setVisiting(null); }, [center, radius, picking]);
  function visit(p) {
    if (!p) return;
    setVisiting(p.id);
    approach(p, 155);
  }
  function nextShop() {
    const index = storefronts.findIndex(p => p.id === visiting);
    visit(storefronts[(index + 1) % storefronts.length]);
  }
  const gridMarks = useMemo(
    () =>
      grid
        ? gridLabels.map((name, i) => ({
            ...offset(
              center,
              ((i % 3) - 1) * radius * 1000 * 0.6,
              (1 - Math.floor(i / 3)) * radius * 1000 * 0.6,
            ),
            id: "zone" + i,
            type: "zone",
            name,
          }))
        : [],
    [grid, center, radius],
  );
  const marks = useMemo(() => {
    const cursor = {
      ...center,
      id: "center-marker",
      type: "center",
      name: center.example ? "湖滨公园" : center.name,
    };
    const arr = [];
    if (fix)
      arr.push({ ...fix, id: "gps-marker", type: "gps", name: "我的位置" });
    if (
      selected &&
      selected.id !== center.id &&
      !pins.some((p) => p.id === selected.id)
    )
      arr.push(selected);
    arr.push(
      cursor,
      ...pins
        .filter((p) => p.id !== center.id)
        .sort(
          (a, b) =>
            Number(b.id === selected?.id) - Number(a.id === selected?.id),
        ),
      ...gridMarks,
    );
    // In a street close-up, a selected shop or intersection takes label priority over the center.
    if (shop || selected?.kind) {
      const index = arr.findIndex((p) => p.id === (shop || selected).id);
      if (index > 0) arr.unshift(arr.splice(index, 1)[0]);
    }
    if (meters(center, exampleCenter) < 20000) arr.push(lake);
    return arr;
  }, [center, pins, selected, gridMarks, fix, shop]);
  const gridLines = useMemo(() => {
    const lines = makeGrid(center, radius * 1000);
    if (
      metadata?.boundary &&
      metadata.id === area?.id &&
      meters(center, area) < 2 &&
      metadata.radius === radius * 1000
    ) {
      lines[0] = metadata.boundary.map(([lon, lat]) => ({ lon, lat }));
    }
    return grid ? lines : [lines[0]];
  }, [grid, center, radius, metadata, area]);
  state.current = {
    onSelect,
    onPick,
    motion: motion && !reduced,
    picking,
    notify,
    marks,
    gridLines,
    route,
    center,
  };
  function screenSpan(km) {
    const el = root.current;
    const ratio = el.clientWidth / Math.max(el.clientHeight, 1);
    return km * 2000 * Math.max(1, ratio) * 1.43;
  }
  function move(p, span) {
    viewTarget.current = { p, span };
    if (
      active.current?.mode === "model" &&
      meters(p, active.current.area) > active.current.area.radius + 2
    ) {
      setWanted("globe");
      return;
    }
    active.current?.view(p, span);
    draw.current();
  }
  function fitArea() {
    if (
      desired === "model" &&
      meters(center, area) + radius * 1000 > area.radius + 25
    )
      setWanted("globe");
    move(center, screenSpan(radius));
  }
  function showNeighborhood() {
    const span = center.example
      ? 5200
      : Math.max(900, Math.min(3500, root.current.clientWidth * 2.8));
    move(center, span);
  }
  function approach(p, span) {
    viewTarget.current = { p, span };
    if (active.current?.approach) active.current.approach(p, span, state.current.motion);
    else move(p, span);
  }
  function streetView() {
    const map = active.current;
    if (!map) return;
    if (map.mode === "model" && area?.anchorId === "ruiheyuan") return approach(map.center(), Math.min(170, map.range()));
    const span = Math.max(340, Math.min(950, root.current.clientWidth));
    move(map.center(), Math.min(map.range(), span));
  }
  useImperativeHandle(ref, () => ({
    exitExpanded: full.exit,
    focus(p, span = 1400) {
      if (p.kind === "shop" && p.photo) return visit(p);
      setVisiting(null);
      move(p, span);
    },
    fitArea,
    showNeighborhood,
    fitRoute(coords) {
      if (!coords?.length) return;
      if (
        desired === "model" &&
        area &&
        coords.some((p) => meters(p, area) > area.radius + 2)
      )
        setWanted("globe");
      const xs = coords.map((p) => p.lon),
        ys = coords.map((p) => p.lat),
        p = {
          lon: (Math.max(...xs) + Math.min(...xs)) / 2,
          lat: (Math.max(...ys) + Math.min(...ys)) / 2,
        };
      const dx = meters(
          { lon: Math.min(...xs), lat: p.lat },
          { lon: Math.max(...xs), lat: p.lat },
        ),
        dy = meters(
          { lon: p.lon, lat: Math.min(...ys) },
          { lon: p.lon, lat: Math.max(...ys) },
        );
      move(
        p,
        Math.max(
          500,
          dx * 1.45,
          ((dy * root.current.clientWidth) /
            Math.max(1, root.current.clientHeight)) *
            1.6,
        ),
      );
    },
  }));
  draw.current = () => {
    const engine = active.current,
      el = root.current;
    if (!engine || !el || !el.clientWidth) return;
    const w = el.clientWidth,
      h = el.clientHeight,
      boxes = [
        { x: w - 65, y: 0, w: 65, h: 67 },
        { x: w - 65, y: h - 195, w: 65, h: 160 },
        { x: 0, y: h - 62, w: 184, h: 62 },
      ];
    for (const marker of state.current.marks) {
      const node = markerNodes.current.get(marker.id);
      if (!node) continue;
      const pt = engine.project(marker);
      if (!pt || pt.x < 9 || pt.x > w - 9 || pt.y < 9 || pt.y > h - 8) {
        node.style.visibility = "hidden";
        continue;
      }
      let size = measureCache.current.get(node);
      if (!size) {
        size = [node.offsetWidth || 75, node.offsetHeight || 34];
        measureCache.current.set(node, size);
      }
      const [mw, mh] = size,
        x = Math.round(pt.x - mw / 2),
        y = Math.round(pt.y - mh - 4);
      const b = { x, y, w: mw, h: mh };
      const clips = x < 2 || x + mw > w - 2 || y < 0 || y + mh > h;
      const overlaps = boxes.some(
        (v) =>
          x < v.x + v.w + 5 &&
          x + mw + 5 > v.x &&
          y < v.y + v.h + 4 &&
          y + mh + 4 > v.y,
      );
      if (clips || overlaps) {
        node.style.visibility = "hidden";
        continue;
      }
      if (marker.type !== "water") boxes.push(b);
      node.style.visibility = "visible";
      node.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    if (engine.mode === "model" && three.current?.dataset.closeView && three.current.dataset.closeView !== "off") {
      const point = engine.center();
      let distance = Infinity, nearest = null, bestScore = Infinity;
      for (const p of state.current.marks) {
        if (!p.kind || !(p.streetPhoto || p.photo)) continue;
        const d = meters(p, point);
        // Prefer a full-resolution street photograph when two sites are similarly close.
        const score = d + (p.streetPhoto || d < 60 ? 0 : 65);
        if (d <= 650 && score < bestScore) { bestScore = score; distance = d; nearest = p; }
      }
      const rounded = Math.round(distance / 10) * 10;
      const key = nearest ? nearest.id + rounded : "";
      if (key !== nearestKey.current) {
        nearestKey.current = key;
        setNearPhoto(nearest ? {place: nearest, distance: rounded} : null);
      }
    }
    const limited = Boolean(engine.atPhotoLimit?.());
    if (limitRef.current !== limited) { limitRef.current = limited; setAtPhotoLimit(limited); }
    if (compass.current)
      compass.current.style.transform = `rotate(${-engine.heading()}deg)`;
    if (scale.current) {
      const mpp = engine.range() / w;
      const candidates = [
        1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
        100000, 200000, 500000,
      ];
      const d = limited ? 5 : candidates.filter((n) => n <= mpp * 75).at(-1) || 5;
      scale.current.textContent = d >= 1000 ? `${d / 1000} 公里` : `${d} 米`;
      scale.current.style.width = `${d / mpp}px`;
    }
  };
  useEffect(() => {
    const el = flat.current;
    const engine = flatMap(
      el,
      viewTarget.current.p,
      {
        imagery: (status) => reportImagery("flat", status),
        draw: () => draw.current(),
        pick: (p) => {
          if (state.current.picking) state.current.onPick(p);
        },
      },
      radius,
    );
    active.current = engine;
    el._mapEngine = engine;
    engine.view(viewTarget.current.p, viewTarget.current.span);
    draw.current();
    const observer = new ResizeObserver(() => {
      measureCache.current.clear();
      engine.resize();
      if (active.current !== engine) active.current?.resize();
      draw.current();
    });
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      active.current = null;
      engine.dispose();
      el._mapEngine = null;
    };
  }, []);
  useEffect(() => {
    const base = flat.current?._mapEngine;
    if (!base) return;
    const ctl = new AbortController();
    let globe = null;
    base.previewAt(state.current.center, radius);
    base.setOnline(desired === "flat" || !area);
    setMode("flat");
    setMetadata(null);
    setTexture("local");
    setShowBuildings(!area?.radiiKm);
    setCloseView("off");
    const sync = (engine) => {
      engine.lines(state.current.gridLines, state.current.route?.coords);
      engine.view(viewTarget.current.p, viewTarget.current.span);
      draw.current();
    };
    function fallback() {
      if (ctl.signal.aborted) return;
      setUnsupported(true);
      setWanted("flat");
      state.current.notify("这台设备已切换到平面卫星地图。");
    }
    if (desired !== "flat") {
      const callbacks = {
        draw: () => draw.current(),
        pick: (p) => {
          if (state.current.picking) state.current.onPick(p);
        },
        imagery: (status) => {
          if (!ctl.signal.aborted) reportImagery(desired, status);
        },
        closeView: (value) => { if (!ctl.signal.aborted) setCloseView(value); },
        texture: (value) => {
          if (!ctl.signal.aborted) setTexture(value);
        },
        meta: (data) => {
          if (!ctl.signal.aborted) setMetadata(data);
        },
        fail: fallback,
      };
      let preload;
      if (desired === "model" && presets[area.id]) {
        // Discover the startup pack alongside Three.js, after the 2D preview is interactive.
        preload = document.createElement("link");
        preload.rel = "preload";
        preload.as = "fetch";
        preload.crossOrigin = "anonymous";
        preload.href = presets[area.id].start;
        document.head.append(preload);
        ctl.signal.addEventListener("abort", () => preload.remove(), { once: true });
      }
      const ready =
        desired === "model"
          ? import("./modelEngine.js").then((mod) => {
              if (ctl.signal.aborted) throw Error("取消");
              return mod.modelMap(three.current, area, callbacks, ctl.signal);
            })
          : globeMap(
              three.current,
              viewTarget.current.p,
              callbacks,
              ctl.signal,
            );
      ready
        .then((engine) => {
          if (ctl.signal.aborted) {
            engine.dispose();
            return;
          }
          globe = engine;
          active.current = engine;
          if (engine.lighting) setLighting(engine.lighting());
          setMode(desired);
          sync(engine);
          if (startInStreet.current && engine.area?.anchorId === "ruiheyuan") {
            startInStreet.current = false;
            approach(state.current.center, 175);
          }
        })
        .catch(fallback);
    } else {
      active.current = base;
      setMode("flat");
      sync(base);
    }
    return () => {
      ctl.abort();
      if (globe) {
        active.current = base;
        globe.dispose();
      }
    };
  }, [desired, area]);
  useEffect(() => {
    if (area?.radiiKm && meters(center, area) < 2) fitArea();
    else showNeighborhood();
  }, [center]);
  const lastRadius = useRef(radius);
  useEffect(() => {
    if (lastRadius.current !== radius) {
      lastRadius.current = radius;
      fitArea();
    }
  }, [radius]);
  useEffect(() => {
    active.current?.lines(gridLines, route?.coords);
    draw.current();
  }, [gridLines, route]);
  useLayoutEffect(() => {
    measureCache.current.clear();
    draw.current();
  }, [marks, mode, visiting, full.expanded]);
  function switchMode(next) {
    if (next === desired) return;
    if (unsupported && next === "globe") {
      notify("此设备需要启用 WebGL 2 才能显示三维地形。");
      return;
    }
    if (active.current)
      viewTarget.current = {
        p: active.current.center(),
        span: active.current.range(),
      };
    setWanted(next);
  }
  function toggleGrid() {
    if (!grid) fitArea();
    else showNeighborhood();
    setGrid(!grid);
  }
  const photoPoint = shop || nearPhoto?.place;
  const photoReady = texture === "mixed" || texture === "detail";
  const photoStatus = texture === "unavailable" ? "高清影像暂未载入" : photoReady ? "卫星实景" : "卫星底图 · 正在加载近景";
  const atEvidence = mode === "model" && closeView === "satellite" && atPhotoLimit && photoPoint;
  return (
    <section ref={card} className={"map-card" + (full.expanded ? " expanded-map" : "")} aria-label="周边卫星地图">
      <div className="map-command-row">
        {onRecognize && <div className="recognition-entry" role="group" aria-label="街面认路">
          <button onClick={() => onRecognize("junction")}><Signpost />认路口</button>
          <button onClick={() => onRecognize("shop")}><Store />认店铺</button>
        </div>}
        <button ref={full.toggleRef} className="map-expand" onClick={full.toggle} aria-pressed={full.expanded}>
          {full.expanded ? <Minimize /> : <Maximize />}{full.expanded ? "退出全屏" : "全屏地图"}
        </button>
      </div>
      <div
        ref={root}
        className={"map-stage" + (picking ? " picking" : "")}
        data-mode={mode}
        data-model={mode === "model" ? metadata?.id : undefined}
      >
        <div
          ref={flat}
          className="map-engine flat-engine"
          style={{ visibility: mode === "flat" ? "visible" : "hidden" }}
          aria-hidden="true"
        />
        <div
          ref={three}
          className="map-engine globe-engine"
          style={{ visibility: mode !== "flat" ? "visible" : "hidden" }}
          aria-hidden="true"
        />
        <div className="map-shade" />
        <div className="pin-layer">
          {marks.map((p) => {
            const set = (node) => {
              if (node) markerNodes.current.set(p.id, node);
              else markerNodes.current.delete(p.id);
            };
            if (p.type === "zone")
              return (
                <button
                  key={p.id}
                  ref={set}
                  className="mapmark map-text zone"
                  aria-label={`放大${p.name}区域`}
                  onClick={() =>
                    picking ? onPick(p) : move(p, screenSpan(radius) / 3)
                  }
                >
                  {p.name}
                </button>
              );
            if (p.type === "water")
              return (
                <span
                  key={p.id}
                  ref={set}
                  className={"mapmark map-text " + p.type}
                >
                  {p.name}
                </span>
              );
            if (p.id === shop?.id) return (
              <button key={p.id} ref={set} className="mapmark facade-pin" aria-label={`放大${p.name}的门面实拍`} onClick={() => onStreetPhoto(p)}>
                <img key={p.photo} src={p.photo} alt="" onError={e => { e.currentTarget.hidden = true; }} />
                <span><Camera size={15} />{p.name}</span>
              </button>
            );
            const central = p.type === "center",
              gps = p.type === "gps",
              meta = types[p.type] || types.point,
              Icon = central
                ? center.type === "home"
                  ? House
                  : MapPin
                : gps
                  ? Navigation2
                  : meta.Icon;
            return (
              <button
                key={p.id}
                ref={set}
                className={`mapmark place-pin ${central ? "central" : gps ? "gps" : meta.color} ${p.id === selected?.id ? "chosen" : ""}`}
                aria-label={(central ? "地图中心，" : "") + p.name}
                onClick={() =>
                  picking
                    ? onPick(p)
                    : p.kind === "shop" && p.photo ? visit(p) : onSelect(
                        central ? center : gps ? { ...p, type: "point" } : p,
                      )
                }
              >
                <i>
                  <Icon size={16} strokeWidth={2.6} />
                </i>
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
        <div className="sat-badge" data-status={imageStates[mode]}>
          <i />
          {mode === "model" && closeView === "satellite" ? photoStatus : mode === "model" && closeView === "model" ? "立体近景 · 模拟外观" : mode === "model" && closeView === "loading" ? "正在绘制近景" : imageStates[mode] === "partial"
            ? "部分影像未载入"
            : imageStates[mode] === "loading"
              ? "正在加载卫星影像"
              : mode === "model"
                ? texture === "local"
                  ? "本地卫星底图"
                  : area?.anchorId === "ruiheyuan" ? "卫星存档 · Esri" : "卫星影像 · Esri"
                : "卫星影像"}
        </div>
        {!picking && !shop && storefronts.length > 0 && <button className="visit-shops" onClick={() => visit(storefronts[0])}>
          <Camera size={19} />看店面实拍
        </button>}
        <button
          className="north-control"
          aria-label="地图朝北"
          onClick={() => {
            active.current?.north();
            notify("地图已朝北");
          }}
        >
          <span>N</span>
          <svg
            ref={compass}
            width="21"
            height="26"
            viewBox="0 0 22 28"
            aria-hidden="true"
          >
            <path d="m11 1 6 14-6-3-6 3z" fill="#be6044" />
            <path d="m11 27-6-13 6 3 6-3z" fill="#42634f" />
          </svg>
        </button>
        {atPhotoLimit && <p className="imagery-notice">已到卫星影像放大上限{photoPoint ? "，看实拍可辨认街面细节。" : "。"}</p>}
        <div className="map-tools">
          <div className="zoom-pair">
            <button
              aria-label={atEvidence ? "打开附近实拍大图" : "放大地图"}
              disabled={atPhotoLimit && !photoPoint}
              onClick={() => atEvidence ? onStreetPhoto(photoPoint) : active.current?.zoom(1)}
            >
              {atEvidence ? <Camera/> : <Plus />}
            </button>
            <button
              aria-label="缩小地图"
              onClick={() => active.current?.zoom(-1)}
            >
              <Minus />
            </button>
          </div>
          <button
            title="回到地图中心"
            aria-label="回到地图中心"
            onClick={showNeighborhood}
          >
            <LocateFixed />
          </button>
        </div>
        <div className="view-switch" role="group" aria-label="地图视图">
          {area && (
            <button
              aria-pressed={mode === "model"}
              onClick={() => switchMode("model")}
            >
              <Building2 size={16} />
              {area.anchorId === "ruiheyuan" ? "卫星实景" : `${area.radius / 1000}公里模型`}
            </button>
          )}
          <button
            aria-pressed={mode === "globe"}
            onClick={() => switchMode("globe")}
          >
            <Box size={16} />
            3D 实景
          </button>
          <button
            aria-pressed={wanted === "flat"}
            onClick={() => switchMode("flat")}
          >
            <Layers2 size={16} />
            2D 平面
          </button>
        </div>
        <span ref={scale} className="scale" />
        {mode === "model" && area?.anchorId === "ruiheyuan" && <span className="model-credit">{closeView !== "model" && photoReady ? "Esri Wayback 2026-11-18 · " : "Copernicus · "}© OpenStreetMap</span>}
        {picking && (
          <div className="pick-hint">
            <MapPin size={18} />
            <strong>点一下地图选位置</strong>
            <button onClick={() => onPick(active.current.center())}>
              选画面中心
            </button>
            <button aria-label="取消选点" onClick={onCancelPick}>
              <X size={19} />
            </button>
          </div>
        )}
      </div>
      {mode === "model" && closeView !== "off" && <section className="aerial-evidence" aria-label="街面照片对照">
        {photoPoint && !picking && !shop ? <>
          <button className="ground-evidence" onClick={() => onStreetPhoto(photoPoint)} aria-label={`看${photoPoint.name}实拍大图`}>
            <img key={photoPoint.id} src={photoPoint.photo || streetFile(photoPoint)?.replace(".webp", "-small.webp")} alt="" onError={e => { e.currentTarget.hidden = true; }} />
            <span><small>{photoPoint.streetPhoto ? "路口实拍 · 2019年7月" : "店面实拍 · 拍摄日期未知"}</small>
              <strong>{photoPoint.name}</strong><span>距画面中心约 {distanceText(nearPhoto.distance)} · 点照片放大</span></span>
          </button>
          <button className="photo-pinpoint" onClick={() => approach(photoPoint, 155)}>地图上看</button>
        </> : !shop && <p>画面中心 650 米内暂无已收录的街面照片。</p>}

        {texture === "unavailable" && <button onClick={() => active.current?.retryPhoto?.()}>重试高清卫星影像</button>}
      </section>}
      {shop && <div className="facade-strip" role="region" aria-label="门面实拍对照">
        <div className="facade-caption" aria-live="polite"><strong>{shop.name}</strong><span>{shop.address}</span></div>
        <div className="facade-actions">
          <button onClick={() => onStreetPhoto(shop)}><Maximize size={16} />看门面大图</button>
          {storefronts.length > 1 && <button onClick={nextShop}>下一家<ChevronRight size={16} /></button>}
          <button aria-label="收起门面实拍" onClick={() => setVisiting(null)}><X size={19} /></button>
        </div>
      </div>}
      {area?.radiiKm && meters(center, area) < 2 && (
        <div
          className="model-range-select"
          role="group"
          aria-label="瑞和苑建模范围"
        >
          <span>模型半径</span>
          {area.radiiKm.map((km) => (
            <button
              key={km}
              aria-pressed={radius === km}
              onClick={() => {
                if (!unsupported) setWanted("model");
                if (km === radius) fitArea();
                else onRadius(km);
              }}
            >
              {km} 公里
            </button>
          ))}
        </div>
      )}
      <div className="map-foot">
        {mode === "model" && closeView !== "off" && <button aria-label="镜头动效" aria-pressed={motion && !reduced} disabled={reduced} onClick={toggleMotion}>{motion && !reduced ? "动效开" : "动效关"}</button>}
        <button className="street-view" onClick={streetView}>
          <ScanSearch size={18} />
          看清街区
        </button>
        {mode === "model" && (
          <div className="map-rotate" role="group" aria-label="环看三维模型">
            <button
              aria-label="向左环看45度"
              title="向左环看"
              onClick={() => active.current?.rotateBy(-45)}
            >
              <RotateCcw size={18} />
            </button>
            <button
              aria-label="向右环看45度"
              title="向右环看"
              onClick={() => active.current?.rotateBy(45)}
            >
              <RotateCw size={18} />
            </button>
          </div>
        )}
        {mode === "model" && closeView !== "model" && (
          <button
            className="lighting-btn"
            aria-label="切换实景光影"
            title="切换实景光影（晴日 / 暖阳 / 柔和）"
            onClick={cycleLighting}
          >
            <Sun size={17} />
            {lightingCycle.find(([k]) => k === lighting)?.[1] || "晴日"}
          </button>
        )}
        {mode === "model" && closeView !== "satellite" && (
          <button
            aria-pressed={showBuildings}
            onClick={() =>
              setShowBuildings(active.current?.toggleBuildings?.() ?? true)
            }
          >
            <Building2 size={17} />
            楼体示意
            <span className="switch-track">
              <i />
            </span>
          </button>
        )}
        {grid && <span className="grid-hint">点方位可放大该区</span>}
        <button aria-pressed={grid} onClick={toggleGrid}>
          <Grid3X3 size={17} />
          九宫格
          <span className="switch-track">
            <i />
          </span>
        </button>
      </div>
      {mode === "model" && area && metadata?.id === area.id && (
        <details className="model-facts">
          <summary>{metadata.name} · 模型精度与来源</summary>
          {metadata.address && (
            <p>
              {metadata.address} ·{" "}
              <a href={metadata.centerSource} target="_blank" rel="noreferrer">
                查看小区边界
              </a>
            </p>
          )}
          <p>
            这片模型以{metadata.name}为中心，半径 {metadata.radius / 1000}{" "}
            公里。卫星底图摄于 {metadata.imageDate}
            ，原始像元 10 米。地形来自约 30 米网格。放大后会按需叠加 Esri 影像。
            {area.anchorId === "ruiheyuan" && "中心 5 公里的近景叠加了 OpenStreetMap 收录的街道、小路和过街点。店面照片标在门店点位，拍摄日期见大图。"}
          </p>
          <p>
            楼高有地图标注的 {metadata.counts.tag || 0} 处，按楼层估高的{" "}
            {metadata.counts.levels || 0} 处，采用 2020 年遥感估高的{" "}
            {metadata.counts.raster || 0} 处。其余{" "}
            {metadata.counts.outline || 0}{" "}
            处可在建筑数据里查看轮廓。楼顶按平顶近似。
          </p>
          <p>
            影像 © Copernicus Sentinel · 地形 GEDTM30 · 建筑 © OpenStreetMap
            贡献者 · 楼高 CNBH-10m。
            <a href="/models/SOURCES.txt" target="_blank" rel="noreferrer">
              数据来源与许可
            </a>
            {" · "}
            <a href={modelPath(area) + "footprints.geojson.gz"} download>
              下载建筑数据
            </a>
          </p>
        </details>
      )}
      {!area && (
        <p className="model-uncovered">
          此位置使用在线卫星图。已建模区域包括天津站、上海人民广场、浦东瑞和苑和杭州湖滨公园。
        </p>
      )}
    </section>
  );
});
export default NeighborhoodMap;
