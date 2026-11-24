import { validPoint, meters, measureRoute, snapToRoute } from "./geo.js";
import { exampleCenter, types } from "./data.js";
import {
  centerEntry,
  centerSearchResults,
  cityShortcuts,
  matchesCenter,
} from "./centers.js";
import { getNativeGeoPosition, isNativeApp } from "./platform/native.js";
const settingsKey = "linli-map:v1";
const defaults = {
  center: exampleCenter,
  home: null,
  saved: [],
  centers: [],
  radius: 5,
  large: false,
  voice: true,
};
const placeOK = (p) =>
  validPoint(p) &&
  typeof p.name === "string" &&
  typeof p.id === "string" &&
  Object.hasOwn(types, p.type);
export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(settingsKey)) || {};
    const center = placeOK(s.center) ? s.center : exampleCenter;
    const home = placeOK(s.home) ? s.home : null;
    const stored = Array.isArray(s.centers) ? s.centers : [];
    const centers = [];
    // Older installs have just an active center and a home. Carry both forward.
    for (const p of [...stored, center, home]) {
      if (
        placeOK(p) &&
        !p.example &&
        !centers.some((entry) => matchesCenter(entry, p))
      )
        centers.push(centerEntry(p));
    }
    return {
      center,
      home,
      centers,
      saved: Array.isArray(s.saved) ? s.saved.filter(placeOK) : [],
      radius: [1, 3, 5, 8, 10].includes(s.radius) ? s.radius : 5,
      large: s.large === true,
      voice: s.voice !== false,
    };
  } catch {
    return { ...defaults };
  }
}
export function storeSettings(data) {
  localStorage.setItem(settingsKey, JSON.stringify(data));
}
export function fromGPS(pos) {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy,
    heading: c.heading,
    time: pos.timestamp,
  };
}
export function gpsProblem(err) {
  return (
    {
      1: "定位权限已关闭。请在浏览器的网站设置里允许定位。",
      2: "手机暂时找不到位置，请到开阔处再试。",
      3: "定位超时，请到开阔处再试。",
    }[err?.code] || "当前浏览器无法定位，请用 HTTPS 或本机 localhost 打开。"
  );
}
export function locate({ forCenter = false, signal, onApproximate } = {}) {
  if (isNativeApp()) {
    return (async () => {
      if (signal?.aborted) throw new DOMException("取消定位", "AbortError");
      const nativePos = await getNativeGeoPosition({
        enableHighAccuracy: !forCenter,
        timeout: 13500,
        maximumAge: forCenter ? 15000 : 3000,
      });
      if (signal?.aborted) throw new DOMException("取消定位", "AbortError");
      if (nativePos?.coords) return fromGPS(nativePos);
      const precisePos = await getNativeGeoPosition({
        enableHighAccuracy: true,
        timeout: 13500,
        maximumAge: 0,
      });
      if (precisePos?.coords) return fromGPS(precisePos);
      throw new Error(gpsProblem({ code: 2 }));
    })();
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error(gpsProblem()));
      return;
    }
    if (signal?.aborted) {
      reject(new DOMException("取消定位", "AbortError"));
      return;
    }
    let done = false,
      highStarted = false;
    let deadline, escalation;
    const fresh = (p, age) =>
      Number.isFinite(p.timestamp) && Date.now() - p.timestamp <= age;
    function finish(fn, value) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", cancel);
      fn(value);
    }
    const cancel = () =>
      finish(reject, new DOMException("取消定位", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    function precise() {
      if (done || highStarted) return;
      highStarted = true;
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (!fresh(p, forCenter ? 30000 : 5000))
            finish(reject, new Error("位置已过期，请重新定位。"));
          else finish(resolve, fromGPS(p));
        },
        (e) => finish(reject, new Error(gpsProblem(e))),
        {
          enableHighAccuracy: true,
          maximumAge: forCenter ? 15000 : 3000,
          timeout: 13500,
        },
      );
    }
    deadline = setTimeout(
      () => finish(reject, new Error(gpsProblem({ code: 3 }))),
      15000,
    );
    if (!forCenter) {
      precise();
      return;
    }
    escalation = setTimeout(precise, 1000);
    // A fresh, accurate device fix can set a center without waiting for another satellite acquisition.
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (done) return;
        if (fresh(p, 30000) && p.coords.accuracy <= 65) {
          finish(resolve, fromGPS(p));
          return;
        }
        onApproximate?.();
        precise();
      },
      (e) => {
        if (e.code === 1) finish(reject, new Error(gpsProblem(e)));
        else precise();
      },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 1500 },
    );
  });
}
let audio;
export function enableAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio ||= new AC();
    audio.resume().catch(() => {});
  } catch {
    /* visual alerts still work */
  }
}
export function beep() {
  if (!audio || audio.state !== "running") return;
  for (const delay of [0, 0.28]) {
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    const time = audio.currentTime + delay;
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.13, time + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(time);
    osc.stop(time + 0.18);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}
export function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const s = new SpeechSynthesisUtterance(text);
  s.lang = "zh-CN";
  s.rate = 0.88;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(s);
}
export function quiet() {
  window.speechSynthesis?.cancel();
}
function turnText(step) {
  const m = step.maneuver,
    road = step.name ? `，走${step.name}` : "";
  if (m.type === "arrive") return "到达目的地附近";
  if (m.type === "depart") return "沿路线出发" + road;
  if (["roundabout", "rotary"].includes(m.type))
    return m.exit ? `进入环岛，从第 ${m.exit} 个出口离开` : "进入环岛";
  const action =
    {
      left: "向左转",
      right: "向右转",
      "slight left": "靠左前方走",
      "slight right": "靠右前方走",
      "sharp left": "向左急转",
      "sharp right": "向右急转",
      uturn: "掉头",
      straight: "继续直行",
    }[m.modifier] || "沿路线前进";
  return action + road;
}
async function request(url, signal, ms = 16000) {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) ctl.abort();
  const timer = setTimeout(abort, ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw Error();
    return await res.json();
  } catch {
    throw Error("网络服务暂时没有响应，请稍后重试。");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export async function searchCenters(text, signal) {
  const query = text.trim();
  if (!query) return [];
  if (
    /^(?:上海市?)?(?:浦东(?:新区)?)?(?:航头镇)?(?:瑞和苑|瑞和路168弄)$/u.test(
      query.replace(/\s+/gu, ""),
    )
  ) {
    return [cityShortcuts.find((p) => p.id === "model:ruiheyuan")];
  }
  const city = cityShortcuts.find(
    (p) => query === p.name || query === p.name + "市",
  );
  if (city) return [city];

  const token = import.meta.env?.VITE_CESIUM_ION_TOKEN;
  let url;
  if (token) {
    url = new URL("https://api.cesium.com/v1/geocode/search");
    url.search = new URLSearchParams({
      text: query,
      geocoder: "google",
      access_token: token,
    });
  } else {
    url = new URL("https://photon.komoot.io/api/");
    // A space separates a city from its landmark in Photon (e.g. 上海 人民广场).
    const words = query.replace(
      /^(天津|上海)市?(?=[\u3400-\u9fff]{3,}$)/u,
      "$1 ",
    );
    url.search = new URLSearchParams({ q: words, limit: 8 });
  }
  const data = await request(url, signal, 10000);
  if (!Array.isArray(data.features))
    throw Error("地点搜索暂时不可用，请再试一次。");
  return centerSearchResults(data.features);
}

export async function findNearby(center, radius, type, signal) {
  // Photon can return nearby OSM features by category, even when a busy Overpass instance times out.
  const tags = {
    park: ["leisure:park"],
    market: ["shop:supermarket", "shop:greengrocer", "amenity:marketplace"],
    hospital: ["amenity:hospital", "amenity:clinic"],
    pharmacy: ["amenity:pharmacy"],
    toilet: ["amenity:toilets"],
    food: ["amenity:restaurant", "amenity:cafe", "amenity:fast_food"],
  };
  if (!import.meta.env.VITE_CESIUM_ION_TOKEN) {
    const query = new URLSearchParams({
      lon: center.lon,
      lat: center.lat,
      radius,
      limit: 24,
    });
    for (const tag of tags[type]) query.append("osm_tag", tag);
    try {
      const data = await request(
        "https://photon.komoot.io/reverse?" + query,
        signal,
        6500,
      );
      const places = (data.features || [])
        .filter((f) =>
          tags[type].includes(
            f.properties?.osm_key + ":" + f.properties?.osm_value,
          ),
        )
        .map((f) => {
          const attrs = f.properties,
            [lon, lat] = f.geometry.coordinates;
          const osmType =
            { N: "node", W: "way", R: "relation" }[attrs.osm_type] ||
            attrs.osm_type;
          return {
            id: `${osmType}-${attrs.osm_id}`,
            name: attrs.name || types[type].short,
            type,
            lat,
            lon,
          };
        })
        .filter((p) => validPoint(p) && meters(center, p) <= radius * 1000);
      if (places.length) return places;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  const around = `(around:${Math.round(radius * 1000)},${center.lat.toFixed(5)},${center.lon.toFixed(5)})`;
  const clause = "nwr" + types[type].filter + around + ";";
  const more =
    type === "market" ? "nwr[amenity=marketplace]" + around + ";" : "";
  const q = `[out:json][timeout:12];(${clause}${more});out center 300;`;
  const j = await request(
    "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q),
    signal,
  );
  if (!Array.isArray(j.elements) || j.remark)
    throw Error("附近地点服务繁忙，请稍后再试。");
  return j.elements
    .map((e) => ({
      id: `${e.type}-${e.id}`,
      name:
        e.tags?.["name:zh-Hans"] ||
        e.tags?.["name:zh"] ||
        e.tags?.name ||
        types[type].short,
      type,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
    }))
    .filter((p) => validPoint(p) && meters(p, center) <= radius * 1000)
    .sort((a, b) => meters(a, center) - meters(b, center))
    .slice(0, 35);
}
let lastRouteRequest = 0;
async function waitForRoutingSlot(signal) {
  while (Date.now() - lastRouteRequest < 1050) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(5, 1050 - (Date.now() - lastRouteRequest))),
    );
    if (signal?.aborted) throw Error("路线查询已取消。");
  }
  if (signal?.aborted) throw Error("路线查询已取消。");
  lastRouteRequest = Date.now();
}
export async function getRoute(start, end, mode, signal) {
  await waitForRoutingSlot(signal);
  const profile = mode === "bike" ? "bike" : "foot";
  const xy = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  const data = await request(
    `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${xy(start)};${xy(end)}?overview=full&geometries=geojson&steps=true`,
    signal,
  );
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route?.geometry?.coordinates?.length)
    throw Error("没有找到可通行的路线。请换一个入口或出行方式。");
  if (data.waypoints?.some((w) => w.distance > 100))
    throw Error("起点或终点离已收录道路较远。请选附近的出入口再试。");
  const coords = route.geometry.coordinates.map(([lon, lat]) => ({ lon, lat }));
  const cumulative = measureRoute(coords);
  const steps = route.legs
    .flatMap((l) => l.steps)
    .map((s) => {
      const [lon, lat] = s.maneuver.location;
      return {
        text: turnText(s),
        lon,
        lat,
        at: snapToRoute({ lon, lat }, coords, cumulative).progress,
      };
    });
  if (steps.length) steps[steps.length - 1].at = cumulative.at(-1);
  return {
    coords,
    cumulative,
    steps,
    distance: route.distance,
    duration: route.duration,
    start,
    end,
    mode,
  };
}
export async function smallPhoto(file) {
  if (!file?.type.startsWith("image/")) throw Error("请选择手机相册里的照片。");
  const url = URL.createObjectURL(file);
  try {
    const pic = new Image();
    pic.src = url;
    await pic.decode();
    const s = Math.min(1, 1600 / Math.max(pic.width, pic.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(pic.width * s));
    canvas.height = Math.max(1, Math.round(pic.height * s));
    canvas.getContext("2d").drawImage(pic, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.84);
  } catch {
    throw Error("这张照片无法读取，请换一张。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
