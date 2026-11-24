const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (radians) => (radians * 180) / Math.PI;
const earth = 6371008.8;
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

export function inChinaMainland(lon, lat) {
  return lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}

function gcjTransformLat(x, y) {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) +
      320.0 * Math.sin((y * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function gcjTransformLon(x, y) {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0;
  return ret;
}

export function wgs84ToGcj02(point) {
  if (!validPoint(point) || !inChinaMainland(point.lon, point.lat)) {
    return { ...point };
  }
  const dLat = gcjTransformLat(point.lon - 105.0, point.lat - 35.0);
  const dLon = gcjTransformLon(point.lon - 105.0, point.lat - 35.0);
  const radLat = radians(point.lat);
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    ...point,
    lat: point.lat + (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI),
    lon: point.lon + (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI),
  };
}

// Iterative inverse yields sub-centimetre accuracy when converting GCJ-02 POIs to WGS-84.
export function gcj02ToWgs84(point) {
  if (!validPoint(point) || !inChinaMainland(point.lon, point.lat)) {
    return { ...point };
  }
  let lat = point.lat;
  let lon = point.lon;
  for (let i = 0; i < 6; i++) {
    const est = wgs84ToGcj02({ lat, lon });
    const dLat = est.lat - point.lat;
    const dLon = est.lon - point.lon;
    lat -= dLat;
    lon -= dLon;
    if (Math.abs(dLat) < 1e-8 && Math.abs(dLon) < 1e-8) break;
  }
  return { ...point, lat, lon };
}
export function validPoint(p) {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}
export function meters(a, b) {
  const h =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function bearing(a, b) {
  const dLon = radians(b.lon - a.lon),
    lat1 = radians(a.lat),
    lat2 = radians(b.lat);
  return (
    (degrees(
      Math.atan2(
        Math.sin(dLon) * Math.cos(lat2),
        Math.cos(lat1) * Math.sin(lat2) -
          Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
      ),
    ) +
      360) %
    360
  );
}
export const directions = [
  "北",
  "东北",
  "东",
  "东南",
  "南",
  "西南",
  "西",
  "西北",
];
export const direction = (angle) =>
  directions[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
export function offset(p, east, north) {
  return {
    lon:
      ((p.lon +
        degrees(east / (earth * Math.max(0.01, Math.cos(radians(p.lat))))) +
        540) %
        360) -
      180,
    lat: Math.max(-89.9, Math.min(89.9, p.lat + degrees(north / earth))),
  };
}
export function distanceText(distance) {
  return distance < 1000
    ? `${Math.round(distance)} 米`
    : `${(distance / 1000).toFixed(1).replace(/\.0$/, "")} 公里`;
}
export function areaFor(p, center, radius) {
  const metersPerDegree = (earth * Math.PI) / 180;
  const x =
    (((p.lon - center.lon + 540) % 360) - 180) *
    metersPerDegree *
    Math.cos(radians(center.lat));
  const y = (p.lat - center.lat) * metersPerDegree,
    third = radius / 3;
  return (
    (y > third ? "北" : y < -third ? "南" : "") +
      (x < -third ? "西" : x > third ? "东" : "") || "中心"
  );
}
export const zoneName = (z) =>
  ({ 北西: "西北", 北东: "东北", 南西: "西南", 南东: "东南" })[z] || z;
export function makeGrid(center, radius) {
  const segments = [];
  for (const v of [-radius / 3, radius / 3]) {
    const limit = Math.sqrt(radius * radius - v * v);
    segments.push(
      [offset(center, v, -limit), offset(center, v, limit)],
      [offset(center, -limit, v), offset(center, limit, v)],
    );
  }
  const ring = Array.from({ length: 97 }, (_, i) =>
    offset(
      center,
      radius * Math.sin((i * Math.PI) / 48),
      radius * Math.cos((i * Math.PI) / 48),
    ),
  );
  return [ring, ...segments];
}
export function measureRoute(coords) {
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++)
    cumulative.push(cumulative[i - 1] + meters(coords[i - 1], coords[i]));
  return cumulative;
}
// Find the closest point on a road segment, rather than the nearest shape vertex.
export function snapToRoute(p, points, cumulative) {
  let best = { distance: Infinity, progress: 0, index: 0 };
  const scale = (earth * Math.PI) / 180,
    xscale = scale * Math.cos(radians(p.lat));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const x = (((a.lon - p.lon + 540) % 360) - 180) * xscale,
      y = (a.lat - p.lat) * scale;
    const dx = (((b.lon - a.lon + 540) % 360) - 180) * xscale,
      dy = (b.lat - a.lat) * scale;
    const t = Math.max(
      0,
      Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)),
    );
    const distance = Math.hypot(x + t * dx, y + t * dy);
    if (distance < best.distance)
      best = {
        distance,
        progress: cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t,
        index: i - 1,
      };
  }
  return best;
}
export function pointAhead(route, distance) {
  const i = route.cumulative.findIndex((s) => s >= distance);
  if (i < 0) return route.coords.at(-1);
  if (i === 0) return route.coords[0];
  const a = route.coords[i - 1],
    b = route.coords[i];
  const t =
    (distance - route.cumulative[i - 1]) /
    (route.cumulative[i] - route.cumulative[i - 1] || 1);
  return {
    lon: a.lon + t * (((b.lon - a.lon + 540) % 360) - 180),
    lat: a.lat + t * (b.lat - a.lat),
  };
}
export const newTracker = () => ({
  outside: 0,
  arrival: 0,
  lastAlarm: -Infinity,
  lastTime: 0,
  lastGood: null,
  lastHeading: null,
});
export function navigationFix(route, fix, tracker) {
  const now = fix.time;
  if (
    !validPoint(fix) ||
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy > 45 ||
    fix.accuracy < 0 ||
    now <= tracker.lastTime
  ) {
    tracker.outside = 0;
    tracker.arrival = 0;
    return { state: "weak" };
  }
  tracker.lastTime = now;
  const snapped = snapToRoute(fix, route.coords, route.cumulative);
  const remaining = Math.max(0, route.cumulative.at(-1) - snapped.progress);
  const outside = snapped.distance > Math.max(32, fix.accuracy * 1.8);
  tracker.outside = outside ? tracker.outside + 1 : 0;
  const near =
    remaining < 35 &&
    snapped.distance < 25 &&
    meters(fix, route.coords.at(-1)) < Math.max(18, Math.min(28, fix.accuracy));
  tracker.arrival = near ? tracker.arrival + 1 : 0;
  const state =
    tracker.arrival >= 2
      ? "arrived"
      : tracker.outside >= 2
        ? "offroute"
        : "onroute";
  const alarm = state === "offroute" && now - tracker.lastAlarm >= 25000;
  if (alarm) tracker.lastAlarm = now;
  if (Number.isFinite(fix.heading) && fix.heading >= 0)
    tracker.lastHeading = fix.heading;
  else if (
    tracker.lastGood &&
    meters(fix, tracker.lastGood) >
      Math.max(9, fix.accuracy, tracker.lastGood.accuracy)
  )
    tracker.lastHeading = bearing(tracker.lastGood, fix);
  if (
    !tracker.lastGood ||
    meters(fix, tracker.lastGood) >
      Math.max(9, fix.accuracy, tracker.lastGood.accuracy)
  )
    tracker.lastGood = fix;
  const next =
    route.steps.find((s) => s.at > snapped.progress + 12) || route.steps.at(-1);
  return {
    state,
    alarm,
    remaining,
    next,
    turnDistance: Math.max(0, (next?.at || 0) - snapped.progress),
    heading: tracker.lastHeading,
    angle: bearing(fix, pointAhead(route, snapped.progress + 32)),
  };
}
