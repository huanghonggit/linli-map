import { meters, distanceText } from "../geo.js";

const baidu = (pid, uid, heading, mapCenter) => ({
  pid,
  uid,
  heading,
  mapCenter,
  captured: pid === "09000300121905241252473767I" ? "2019年5月" : "2021年1月",
});
const corner = (node, a, b, lon, lat, arms, clue, pano, streetPhoto) => ({
  id: `cross:${node}`,
  kind: "junction",
  type: "junction",
  name: `${a}与${b}`,
  roads: [a, b],
  lon,
  lat,
  arms,
  clue,
  pano,
  streetPhoto,
});
const storefront = (
  id,
  name,
  branch,
  shopType,
  lon,
  lat,
  address,
  clue,
  image,
) => ({
  id: `shop:${id}`,
  kind: "shop",
  type: shopType,
  name,
  hint: branch,
  lon,
  lat,
  address,
  clue,
  amapId: id,
  photo: `https://store.is.autonavi.com/showpic/${image}`,
  photoAlt: `${name}店外招牌`,
  photoCredit: "高德地图地点照片 · 拍摄日期未知",
});
export const featured = [
  corner(
    "1165821465",
    "瑞和路",
    "瑞浦路",
    121.5832175,
    31.0883037,
    [[88, 271], [358]],
    "先找写着“瑞浦路”的蓝色指路牌，再核对另一条路名“瑞和路”。",
    baidu(
      "09000300121905241252473767I",
      "979f15bce90c6e4bfa42b2d3",
      301,
      "13535912,3622457",
    ),
  ),
  corner(
    "1165821082",
    "瑞和路",
    "瑞阳路",
    121.586101,
    31.0902418,
    [[82, 249], [6]],
    "在斑马线边核对“瑞和路”和“瑞阳路”两块路牌。",
    baidu(
      "0900030012210108135910680GR",
      "9f353f42b2ab9fcd8bfc0610",
      251,
      "13536229,3622696",
    ),
  ),
  corner(
    "9836149178",
    "周东南路",
    "瑞和路",
    121.5874346,
    31.0904172,
    [
      [172, 353],
      [81, 260],
    ],
    "找有红绿灯的路口，核对“周东南路”和“瑞和路”。",
    baidu(
      "0900030012210108125700906GR",
      "f986becec3a6f9f6ae31e5bd",
      187,
      "13536393,3622709",
    ),
    "1193684637752085",
  ),
  corner(
    "1165820695",
    "周东南路",
    "瑞安路",
    121.5870667,
    31.0926891,
    [
      [173, 353],
      [86, 262],
    ],
    "这里的横路叫“瑞安路”。核对路牌上的“安”字。",
    null,
    "761926911164262",
  ),
  corner(
    "8558929799",
    "周建路",
    "瑞和路",
    121.5885839,
    31.0905174,
    [[352], [83, 265]],
    "在周建路找“瑞和路”路牌，附近有吉祥里生鲜超市。",
    null,
    "164549105530999",
  ),
  storefront(
    "B001570C2D",
    "阳光超市",
    "瑞阳路店",
    "market",
    121.5855067,
    31.0913423,
    "瑞阳路750号",
    "看蓝灰色横招牌，右边有红色“阳光超市”四个字，下面是红色雨棚。",
    "9e9ae6b4cfa4806ebe6f741ddf1c232d",
  ),
  storefront(
    "B0FFI7MOET",
    "吉祥里生鲜超市",
    "周建路店",
    "market",
    121.587993,
    31.0908543,
    "周建路166号",
    "找红底白字的“吉祥里生鲜超市”。入口上方另有一块写着“出入口”的黑底牌。",
    "4f7d50b254a4e84f09d3aa9a7f58f905",
  ),
  storefront(
    "B0FFJGXA4G",
    "益丰大药房",
    "瑞福店",
    "pharmacy",
    121.5864812,
    31.0925718,
    "瑞安路214号，安阁苑中区北门旁",
    "找绿色底的“益丰大药房”招牌，再核对瑞安路214号。",
    "c59268cbaeb095f68b720d16c62ffa60",
  ),
  storefront(
    "B0LDDS4CT7",
    "京东大药房",
    "周建路店",
    "pharmacy",
    121.58855,
    31.09132,
    "周建路141号，汇福家园吉祥里西门旁",
    "找红底白字的“京东大药房”和招牌下的玻璃门，核对周建路141号。",
    "8f7710e94ee05111e502779702b2c701",
  ),
];
const byId = new Map(featured.map((p) => [p.id, p]));
const featuredOsmShops = new Set(["3145066727", "11257034407", "12876495237"]);
export function inRange(items, center, radius) {
  return items
    .filter((p) => meters(center, p) <= radius * 1000)
    .sort((a, b) => meters(center, a) - meters(center, b));
}
export function readIndex(raw) {
  const corners = raw.junctions
    .map(([id, a, b, lon, lat, armsA, armsB]) =>
      corner(
        id,
        a,
        b,
        lon,
        lat,
        [armsA, armsB],
        `到路口核对“${a}”和“${b}”两个路名。`,
      ),
    )
    .filter((p) => !byId.has(p.id))
    .map((p) => ({ ...p, id: `${p.id}:${p.roads.join("/")}` }));
  const shops = raw.shops
    .filter((r) => !featuredOsmShops.has(r[0]))
    .map(([id, name, lon, lat, address, category]) => ({
      id: "osm-shop:" + id,
      type:
        category === "pharmacy"
          ? "pharmacy"
          : ["restaurant", "cafe"].includes(category)
            ? "food"
            : "market",
      kind: "shop",
      name,
      lon,
      lat,
      address,
      clue: `核对店招“${name}”${address ? `和门牌“${address}”` : ""}。`,
    }));
  return [...featured, ...corners, ...shops];
}
export function spokenCard(p) {
  return [p.name, p.address, p.clue].filter(Boolean).join("。");
}
export function sortedCards(list, kind, query, verifiedOnly) {
  const words = query.trim().split(/\s+/u).filter(Boolean);
  return list.filter(
    (p) =>
      p.kind === kind &&
      (!verifiedOnly || p.photo || p.streetPhoto || p.pano) &&
      words.every((q) =>
        (p.name + (p.address || "") + (p.hint || "")).includes(q),
      ),
  );
}
// Match only a verified junction close to the actual OSRM manoeuvre, never the nearest shop to the phone.
export function turnJunction(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon))
    return null;
  let best = null,
    limit = 25;
  for (const p of featured) {
    if (p.kind !== "junction") continue;
    const d = meters(p, point);
    if (d < limit) {
      best = p;
      limit = d;
    }
  }
  return best;
}
export function nearbyStore(point) {
  const p = inRange(
    featured.filter((p) => p.kind === "shop"),
    point,
    0.18,
  )[0];
  return p
    ? { p, label: `${p.name} · 距路口约 ${distanceText(meters(point, p))}` }
    : null;
}
export function publicPanoUrl(p) {
  const { pid, heading, mapCenter } = p;
  return `https://map.baidu.com/@${mapCenter},20z#panoid=${pid}&panotype=street&heading=${heading}&pitch=0&l=20&newmap=1&shareurl=1&pid=${pid}`;
}
export function licensedPanoUrl(p, key) {
  const q = new URLSearchParams({
    pid: p.pid,
    ak: key,
    h: p.heading,
    p: 0,
    lc: 1,
    nc: 1,
    src: "webapp.linli.seniormap",
  });
  return `https://api.map.baidu.com/pano/?${q}`;
}
