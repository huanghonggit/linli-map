import presets from "virtual:neighborhood-presets";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { imageBounds } from "./data.js";
import { meters } from "./geo.js";
import { modelArea, modelPath, previewBounds } from "./modelAreas.js";
import {
  getMapRuntimeConfig,
  resolveLeafletTemplate,
} from "./map/runtimeConfig.js";

const localImage = "/media/west-lake-satellite.webp";
const [west, south, east, north] = imageBounds;
const asin = (x) => Math.max(-85, Math.min(85, x));
const latLng = (p) => [asin(p.lat), p.lon];
const copy = (point) => ({ lon: point.lng, lat: point.lat });
export function flatMap(container, initial, cb, radiusKm = 5) {
  const map = L.map(container, {
    attributionControl: false,
    zoomControl: false,
    zoomSnap: 0.1,
    zoomDelta: 0.75,
    minZoom: 2,
    maxZoom: 19,
    preferCanvas: true,
    keyboard: false,
  }).setView(latLng(initial), 14);
  let photos;
  let preview = null,
    previewId;
  function previewAt(center, radiusKm = 5) {
    const area = modelArea(center, radiusKm),
      id = area?.id || null;
    if (id === previewId) return;
    previewId = id;
    photos?.setUrl(tileUrl());
    preview?.remove();
    preview = null;
    if (area)
      preview = L.imageOverlay(
        presets[area.id]?.preview || modelPath(area) + "preview.webp",
        previewBounds(area),
        { pane: "tilePane", zIndex: 0, interactive: false },
      ).addTo(map);
  }
  function tileUrl() {
    return resolveLeafletTemplate(Boolean(previewId?.startsWith("ruiheyuan-")));
  }
  previewAt(initial, radiusKm);
  // 256 source pixels cover 128 CSS pixels on a dense display. The URL still tops out at level 19.
  const dense = (window.devicePixelRatio || 1) > 1.25;
  photos = L.tileLayer(tileUrl(), {
    tileSize: dense ? 128 : 256,
    zoomOffset: dense ? 1 : 0,
    maxNativeZoom: dense ? 18 : 19,
    maxZoom: 19,
    zIndex: 2,
    keepBuffer: 2,
  });
  const failedTiles = new Set();
  function reportPhotos() {
    cb.imagery(
      failedTiles.size ? "partial" : photos.isLoading() ? "loading" : "ready",
    );
  }
  photos.on("loading", () => cb.imagery("loading"));
  photos.on("tileerror", ({ tile }) => {
    failedTiles.add(tile);
    reportPhotos();
  });
  photos.on("tileunload", ({ tile }) => {
    if (failedTiles.delete(tile)) reportPhotos();
  });
  photos.on("load", reportPhotos);
  function setOnline(on) {
    if (on && !map.hasLayer(photos)) photos.addTo(map);
    else if (!on && map.hasLayer(photos)) photos.remove();
  }
  setOnline(!modelArea(initial));
  const shapes = L.layerGroup().addTo(map);
  function change() {
    cb.draw();
  }
  map.on("move zoom resize viewreset", change);
  map.on("click", (e) => cb.pick(copy(e.latlng)));
  const api = {
    mode: "flat",
    previewAt,
    setOnline,
    project(p) {
      const pt = map.latLngToContainerPoint(latLng(p));
      return { x: pt.x, y: pt.y };
    },
    center() {
      return copy(map.getCenter());
    },
    heading() {
      return 0;
    },
    range() {
      const c = api.center(),
        edge = copy(
          map.containerPointToLatLng([map.getSize().x, map.getSize().y / 2]),
        );
      return meters(c, edge) * 2;
    },
    view(p, span = 4900) {
      const w = Math.max(250, container.clientWidth);
      const z = Math.log2(
        (156543.03392 * Math.cos((asin(p.lat) * Math.PI) / 180) * w) / span,
      );
      map.setView(latLng(p), Math.max(2, Math.min(19, z)), { animate: false });
    },
    zoom(by) {
      map.setZoom(map.getZoom() + by * 0.78, { animate: false });
    },
    north() {},
    lines(grid, route) {
      shapes.clearLayers();
      grid.forEach((line) =>
        L.polyline(line.map(latLng), {
          weight: 2,
          color: "#ffe893",
          dashArray: "8 7",
          opacity: 0.94,
          interactive: false,
        }).addTo(shapes),
      );
      if (route?.length) {
        L.polyline(route.map(latLng), {
          weight: 9,
          color: "#fff",
          opacity: 0.96,
          interactive: false,
        }).addTo(shapes);
        L.polyline(route.map(latLng), {
          weight: 5,
          color: "#14714c",
          interactive: false,
        }).addTo(shapes);
      }
    },
    resize() {
      map.invalidateSize();
    },
    dispose() {
      map.remove();
    },
  };
  api.view(initial);
  return api;
}
let loader;
function cesiumLibrary() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (!loader)
    loader = new Promise((resolve, reject) => {
      window.CESIUM_BASE_URL = "/cesium/";
      if (!document.querySelector("link[data-cesium]")) {
        const link = document.createElement("link");
        link.dataset.cesium = "yes";
        link.rel = "stylesheet";
        link.href = "/cesium/Widgets/widgets.css";
        document.head.append(link);
      }
      const s = document.createElement("script");
      s.src = "/cesium/Cesium.js";
      s.async = true;
      s.onload = () => resolve(window.Cesium);
      s.onerror = () => {
        loader = null;
        reject(Error("无法载入三维视图"));
      };
      document.head.append(s);
    });
  return loader;
}
let patchPromise;
function localTerrain(C, data) {
  const [w, s, e, n] = data.bounds,
    size = data.size;
  const tiling = new C.GeographicTilingScheme();
  function sample(lon, lat) {
    if (lon < w || lon > e || lat < s || lat > n) return 0;
    const x = ((lon - w) / (e - w)) * (size - 1),
      y = ((n - lat) / (n - s)) * (size - 1),
      i = Math.min(size - 2, Math.floor(x)),
      j = Math.min(size - 2, Math.floor(y));
    const dx = x - i,
      dy = y - j,
      h = data.heights,
      k = j * size + i;
    return (
      (h[k] * (1 - dx) + h[k + 1] * dx) * (1 - dy) +
      (h[k + size] * (1 - dx) + h[k + size + 1] * dx) * dy
    );
  }
  return new C.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    tilingScheme: tiling,
    callback(x, y, level) {
      const rect = tiling.tileXYToRectangle(x, y, level),
        arr = new Float32Array(33 * 33);
      const west = C.Math.toDegrees(rect.west),
        north = C.Math.toDegrees(rect.north),
        dw = C.Math.toDegrees(rect.width),
        dh = C.Math.toDegrees(rect.height);
      if (west > e || west + dw < w || north < s || north - dh > n) return arr;
      for (let j = 0; j < 33; j++)
        for (let i = 0; i < 33; i++)
          arr[j * 33 + i] = sample(west + (dw * i) / 32, north - (dh * j) / 32);
      return arr;
    },
  });
}
export async function globeMap(container, initial, cb, signal) {
  const C = await cesiumLibrary();
  if (signal.aborted) throw Error("取消");
  let viewer;
  try {
    viewer = new C.Viewer(container, {
      animation: false,
      timeline: false,
      geocoder: false,
      baseLayerPicker: false,
      baseLayer: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      skyBox: false,
      skyAtmosphere: new C.SkyAtmosphere(),
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      useBrowserRecommendedResolution: true,
      msaaSamples: 2,
      contextOptions: {
        webgl: { alpha: false, antialias: true, powerPreference: "high-performance" },
      },
    });
  } catch (error) {
    container.replaceChildren();
    throw error;
  }
  const scene = viewer.scene,
    camera = viewer.camera;
  function updateResolution() {
    // Use native pixels where possible and bound GPU work on large, high-density displays.
    const cssPixels = Math.max(
      1,
      container.clientWidth * container.clientHeight,
    );
    const density = Math.min(
      window.devicePixelRatio || 1,
      3,
      Math.sqrt(3_200_000 / cssPixels),
    );
    viewer.resolutionScale = density;
    // Cesium normalizes terrain screen error by pixel ratio, so a larger canvas alone won't fetch finer imagery.
    scene.globe.maximumScreenSpaceError = Math.max(0.5, 1.15 / density);
  }
  updateResolution();
  scene.globe.baseColor = C.Color.fromCssColorString("#4a6258");
  scene.fog.enabled = true;
  scene.fog.density = 0.00016;
  scene.fog.screenSpaceErrorFactor = 2.0;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.depthTestAgainstTerrain = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 55;
  scene.screenSpaceCameraController.maximumZoomDistance = 6500000;
  scene.globe.loadingDescendantLimit = 64;
  scene.globe.preloadAncestors = true;
  scene.globe.tileCacheSize = 256;
  viewer.screenSpaceEventHandler.removeInputAction(
    C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  );
  function active() {
    return !signal.aborted && !viewer.isDestroyed();
  }
  const cart = (p) => C.Cartographic.fromDegrees(p.lon, p.lat);
  const position = (p) =>
    C.Cartesian3.fromDegrees(
      p.lon,
      p.lat,
      (scene.globe.getHeight(cart(p)) || 0) + 3,
    );
  function at(screen) {
    const ray = camera.getPickRay(screen);
    const hit =
      (ray && scene.globe.pick(ray, scene)) ||
      camera.pickEllipsoid(screen, scene.globe.ellipsoid);
    if (!hit) return null;
    const c = C.Cartographic.fromCartesian(hit);
    return {
      lon: C.Math.toDegrees(c.longitude),
      lat: C.Math.toDegrees(c.latitude),
    };
  }
  viewer.screenSpaceEventHandler.setInputAction((e) => {
    const p = at(e.position);
    if (p) cb.pick(p);
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  const entities = viewer.entities;
  let latest = initial,
    span = 4900,
    terrainRequest = false,
    patched = false,
    worldReady = false;
  function ensureWorld(p) {
    if (
      terrainRequest ||
      (p.lon > 120.065 && p.lon < 120.218 && p.lat > 30.2 && p.lat < 30.305)
    )
      return;
    terrainRequest = true;
    C.ArcGISTiledElevationTerrainProvider.fromUrl(
      "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
    )
      .then((t) => {
        if (active()) {
          worldReady = true;
          viewer.terrainProvider = t;
          scene.requestRender();
        }
      })
      .catch(() => {
        terrainRequest = false;
      });
  }
  const api = {
    mode: "globe",
    project(p) {
      const q = scene.cartesianToCanvasCoordinates(position(p));
      return q ? { x: q.x, y: q.y } : null;
    },
    center() {
      return (
        at(
          new C.Cartesian2(
            container.clientWidth / 2,
            container.clientHeight / 2,
          ),
        ) || latest
      );
    },
    heading() {
      return C.Math.toDegrees(camera.heading);
    },
    range() {
      const a = at(
        new C.Cartesian2(
          container.clientWidth * 0.25,
          container.clientHeight * 0.5,
        ),
      );
      const b = at(
        new C.Cartesian2(
          container.clientWidth * 0.75,
          container.clientHeight * 0.5,
        ),
      );
      return a && b ? meters(a, b) * 2 : span;
    },
    view(p, width = 4900, heading = 0) {
      latest = p;
      span = width;
      const aspect =
        container.clientWidth / Math.max(1, container.clientHeight);
      const fov = camera.frustum.fov || Math.PI / 3;
      const horizontal =
        aspect >= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) * aspect);
      const distance = Math.max(90, width / (2 * Math.tan(horizontal / 2)));
      camera.lookAt(
        position(p),
        new C.HeadingPitchRange(
          C.Math.toRadians(heading),
          C.Math.toRadians(-55),
          distance,
        ),
      );
      camera.lookAtTransform(C.Matrix4.IDENTITY);
      ensureWorld(p);
      scene.requestRender();
    },
    zoom(by) {
      api.view(
        api.center(),
        Math.max(100, Math.min(6500000, api.range() * Math.pow(0.6, by))),
        api.heading(),
      );
    },
    north() {
      api.view(api.center(), api.range(), 0);
    },
    lines(grid, route) {
      entities.removeAll();
      const px = (pts) =>
        C.Cartesian3.fromDegreesArray(pts.flatMap((p) => [p.lon, p.lat]));
      for (const line of grid)
        entities.add({
          polyline: {
            positions: px(line),
            width: 2,
            clampToGround: true,
            material: new C.PolylineDashMaterialProperty({
              color: C.Color.fromCssColorString("#ffed9a"),
              dashLength: 15,
            }),
          },
        });
      if (route?.length > 1)
        entities.add({
          polyline: {
            positions: px(route),
            width: 8,
            clampToGround: true,
            material: new C.PolylineOutlineMaterialProperty({
              color: C.Color.fromCssColorString("#197a4f"),
              outlineColor: C.Color.WHITE,
              outlineWidth: 2,
            }),
          },
        });
      scene.requestRender();
    },
    resize() {
      updateResolution();
      viewer.resize();
      scene.requestRender();
    },
    dispose() {
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
  scene.postRender.addEventListener(() => {
    if (active()) cb.draw();
  });
  camera.moveEnd.addEventListener(() => {
    if (active()) ensureWorld(api.center());
  });
  scene.renderError.addEventListener(() => {
    if (active()) cb.fail();
  });
  // A global base prevents Cesium from stretching a regional image outside its footprint.
  const worldBase = viewer.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: "/cesium/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg",
      tilingScheme: new C.GeographicTilingScheme(),
      maximumLevel: 2,
      credit: new C.Credit("Natural Earth"),
    }),
  );
  const runtimeCfg = getMapRuntimeConfig();
  const globeTemplate = resolveLeafletTemplate(false);
  const ground = new C.UrlTemplateImageryProvider({
    url: globeTemplate,
    maximumLevel: 19,
    credit: new C.Credit("Esri · Maxar · Earthstar Geographics"),
  });
  let missedImagery = false;
  function startRefinement() {
    missedImagery = false;
    cb.imagery("loading");
  }
  camera.moveStart.addEventListener(startRefinement);
  ground.errorEvent.addEventListener((error) => {
    if (!active()) return;
    const visible = camera.computeViewRectangle();
    const tile = ground.tilingScheme.tileXYToRectangle(
      error.x,
      error.y,
      error.level,
    );
    if (visible && !C.Rectangle.intersection(visible, tile)) return;
    missedImagery = true;
    cb.imagery("partial");
  });
  function reportGlobeImagery() {
    if (active())
      cb.imagery(
        missedImagery
          ? "partial"
          : scene.globe.tilesLoaded
            ? "ready"
            : "loading",
      );
  }
  scene.globe.tileLoadProgressEvent.addEventListener(reportGlobeImagery);
  camera.moveEnd.addEventListener(() => {
    scene.requestRender();
  });
  scene.postRender.addEventListener(reportGlobeImagery);
  const hires = viewer.imageryLayers.addImageryProvider(ground);
  hires.brightness = 1.06;
  hires.contrast = 1.07;
  hires.saturation = 1.08;
  hires.gamma = 0.98;
  C.SingleTileImageryProvider.fromUrl(localImage, {
    rectangle: C.Rectangle.fromDegrees(...imageBounds),
    credit: new C.Credit("Sentinel‑2 cloudless 2016 · EOX"),
  })
    .then((p) => {
      if (active()) {
        viewer.imageryLayers.addImageryProvider(
          p,
          viewer.imageryLayers.indexOf(worldBase) + 1,
        );
        scene.requestRender();
      }
    })
    .catch(() => {});
  patchPromise ||= fetch("/media/west-lake-terrain.json").then((r) => r.json());
  patchPromise
    .then((d) => {
      if (active() && !worldReady) {
        viewer.terrainProvider = localTerrain(C, d);
        patched = true;
        scene.requestRender();
      }
    })
    .catch(() => {
      if (!patched) terrainRequest = false;
    });
  const token =
    runtimeCfg.cesiumIonToken || import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (token) {
    C.Ion.defaultAccessToken = token;
    C.createGooglePhotorealistic3DTileset(
      { onlyUsingWithGoogleGeocoder: true },
      {
        showCreditsOnScreen: true,
        cacheBytes: 128 * 1024 * 1024,
        maximumCacheOverflowBytes: 64 * 1024 * 1024,
      },
    )
      .then((tiles) => {
        if (active()) {
          scene.primitives.add(tiles);
          scene.requestRender();
        } else tiles.destroy();
      })
      .catch(() => {});
  }
  api.view(initial);
  return api;
}
