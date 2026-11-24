import locations from "../tools/model/areas.json" with { type: "json" };
import { meters } from "./geo.js";

const earth = 6378137;
const rad = Math.PI / 180;
// Stable variant identities keep range changes and map-engine lifetimes in sync.
const families = locations.map((place) => ({
  place,
  models: (place.radiiKm || [5]).map((km) => ({
    ...place,
    id: place.radiiKm ? `${place.id}-${km}` : place.id,
    anchorId: place.id,
    radius: km * 1000,
    halfWidth: km * 1080,
  })),
}));
const ruihe = locations.find((p) => p.id === "ruiheyuan");
export const ruiheCenter = {
  id: "model:ruiheyuan",
  name: "瑞和苑",
  type: "point",
  lat: ruihe.lat,
  lon: ruihe.lon,
  hint: ruihe.address,
};
export const ruiheRanges = ruihe.radiiKm;

export function modelArea(point, radiusKm = 5) {
  let closest = null,
    nearest = Infinity;
  for (const { place, models } of families) {
    const distance = meters(place, point);
    if (distance > models.at(-1).radius || distance >= nearest) continue;
    nearest = distance;
    closest =
      models.find(
        (model) => model.radius >= Math.max(distance, radiusKm * 1000),
      ) || models.at(-1);
  }
  return closest;
}
export function ruiheLinkSettings(query) {
  const params = new URLSearchParams(query);
  if (params.get("map") !== "ruiheyuan") return null;
  const km = Number(params.get("radius"));
  return { center: ruiheCenter, radius: ruiheRanges.includes(km) ? km : 5 };
}
export const modelPath = (area) => `/models/v1/${area.id}/`;
export function projection(area) {
  const scale = Math.cos(area.lat * rad);
  const y0 = Math.asinh(Math.tan(area.lat * rad));
  return {
    toLocal(p) {
      return {
        x: earth * scale * (p.lon - area.lon) * rad,
        z: earth * scale * (y0 - Math.asinh(Math.tan(p.lat * rad))),
      };
    },
    toGeo(x, z) {
      return {
        lon: area.lon + x / (earth * scale * rad),
        lat: Math.atan(Math.sinh(y0 - z / (earth * scale))) / rad,
      };
    },
  };
}
export function previewBounds(area) {
  const p = projection(area),
    half = area.halfWidth,
    sw = p.toGeo(-half, half),
    ne = p.toGeo(half, -half);
  return [
    [sw.lat, sw.lon],
    [ne.lat, ne.lon],
  ];
}
