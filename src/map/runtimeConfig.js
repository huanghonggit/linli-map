// Shared runtime configuration populated from backend public bootstrap (admin-managed) and local overrides.

const DEFAULT_CONFIG = {
  imageryProvider: "esri", // "esri" | "wayback" | "custom"
  customTileUrl: "",
  defaultLighting: "day", // "day" | "golden" | "clear"
  default3DBuildings: true,
  cesiumIonToken: "",
  requireLogin: false,
};

let currentConfig = { ...DEFAULT_CONFIG };
const listeners = new Set();

export function getMapRuntimeConfig() {
  return currentConfig;
}

export function setMapRuntimeConfig(patch) {
  if (!patch || typeof patch !== "object") return currentConfig;
  currentConfig = { ...currentConfig, ...patch };
  for (const fn of listeners) {
    try {
      fn(currentConfig);
    } catch {
      /* ignore listener failure */
    }
  }
  return currentConfig;
}

export function onMapRuntimeConfig(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resolveTileUrls({ z, x, y, archive }) {
  const cfg = currentConfig;
  const esriLive = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`;
  const esriWayback = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/3692/${z}/${y}/${x}`;

  if (cfg.imageryProvider === "custom" && cfg.customTileUrl) {
    const custom = cfg.customTileUrl
      .replaceAll("{z}", String(z))
      .replaceAll("{x}", String(x))
      .replaceAll("{y}", String(y));
    return [custom, archive ? esriWayback : esriLive];
  }
  if (cfg.imageryProvider === "wayback" || archive) {
    return [esriWayback, esriLive];
  }
  return [esriLive, esriWayback];
}

export function resolveLeafletTemplate(isRuiheyuan) {
  const cfg = currentConfig;
  if (cfg.imageryProvider === "custom" && cfg.customTileUrl) {
    return cfg.customTileUrl;
  }
  if (cfg.imageryProvider === "wayback" || isRuiheyuan) {
    return "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/3692/{z}/{y}/{x}";
  }
  return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false";
}
