import { ruiheCenter } from "./modelAreas.js";
import { validPoint, meters } from "./geo.js";

// WGS84 reference points for the two city shortcuts (OpenStreetMap).
export const cityShortcuts = [
  {
    id: "city:tianjin",
    name: "天津",
    type: "point",
    lat: 39.1357517,
    lon: 117.2036841,
    hint: "天津市区 · 天津站附近",
  },
  {
    id: "city:shanghai",
    name: "上海",
    type: "point",
    lat: 31.2319264,
    lon: 121.4715447,
    hint: "上海市区 · 人民广场附近",
  },
  ruiheCenter,
];

export function matchesCenter(a, b) {
  if (!validPoint(a) || !validPoint(b)) return false;
  if (a.id && a.id !== "my-home" && a.id === b.id) return true;
  const bothGPS = a.id?.startsWith("gps-") && b.id?.startsWith("gps-");
  return meters(a, b) < (bothGPS ? 20 : 2);
}

export function centerEntry(place) {
  // “my-home” is a role that can move between cities. Keep the list entry tied to its location.
  const id =
    place.id === "my-home"
      ? `point-${place.lat.toFixed(6)}-${place.lon.toFixed(6)}`
      : place.id;
  return {
    id,
    name: place.name,
    type: place.type === "home" ? "point" : place.type,
    lat: place.lat,
    lon: place.lon,
    ...(place.hint ? { hint: place.hint } : {}),
  };
}

export function rememberCenter(list, place) {
  const entry = centerEntry(place);
  const existing = list.find((p) => matchesCenter(p, entry));
  if (existing) entry.id = existing.id;
  return [entry, ...list.filter((p) => !matchesCenter(p, entry))];
}

export function centerSearchResults(features) {
  const results = [];
  for (const feature of features) {
    const props = feature?.properties;
    if (
      !props ||
      feature.geometry?.type !== "Point" ||
      !Array.isArray(feature.geometry.coordinates)
    )
      continue;
    const [lon, lat] = feature.geometry.coordinates;
    const street = [props.street, props.housenumber].filter(Boolean).join(" ");
    const name = props.name || street || props.label;
    if (!validPoint({ lat, lon }) || typeof name !== "string" || !name.trim())
      continue;
    const id =
      props.osm_id && props.osm_type
        ? `osm:${props.osm_type}:${props.osm_id}`
        : `search:${lon}:${lat}`;
    const parts = [
      props.countrycode?.toUpperCase() !== "CN" && props.country,
      props.state,
      props.city,
      props.district,
      street,
    ];
    const area = [...new Set(parts.filter((x) => x && x !== name))].join(" · ");
    const hint =
      area ||
      (props.label !== name && props.label) ||
      `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    const entry = { id, name, hint, lon, lat, type: "point" };
    if (!results.some((p) => matchesCenter(p, entry))) results.push(entry);
  }
  return results.slice(0, 8);
}
