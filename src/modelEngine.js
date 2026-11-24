import presets from "virtual:neighborhood-presets";
import * as T from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { projection, modelPath } from "./modelAreas.js";
import { gunzipBuffer, decodeBuildingBuffers } from "./map/meshDecoder.js";
import { decodeBuildingAsync } from "./map/workerPool.js";
import { loadTileBitmap } from "./map/tileCache.js";
import {
  createAtmosphereUniforms,
  applyLightingPreset,
  createSkyDome,
  createRealisticTerrainMaterial,
  createRealisticBuildingMaterial,
} from "./map/realisticShaders.js";
import { getMapRuntimeConfig, resolveTileUrls } from "./map/runtimeConfig.js";

async function get(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error(`模型资源未载入 (${response.status})`);
  return response;
}

async function unpack(url, signal) {
  const response = await get(url, signal);
  return gunzipBuffer(await response.arrayBuffer());
}

function geometryFromDecoded({ positions, indices, limits }) {
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(positions, 3));
  geo.setAttribute("limits", new T.BufferAttribute(limits, 2));
  geo.setIndex(new T.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

function buildingGeometrySync(buffer) {
  return geometryFromDecoded(decodeBuildingBuffers(buffer));
}

function landscapeTexture(bitmap) {
  const texture = new T.Texture(bitmap);
  texture.colorSpace = T.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function terrainGeometry(heights, grid, half) {
  const plane = new T.PlaneGeometry(2 * half, 2 * half, grid - 1, grid - 1);
  plane.rotateX(-Math.PI / 2);
  const pos = plane.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i] * 0.1);
  plane.computeVertexNormals();
  plane.computeBoundingSphere();
  return plane;
}

export async function modelMap(container, area, cb, signal) {
  const prefix = modelPath(area);
  const project = projection(area);
  const isRuiheyuan = area.anchorId === "ruiheyuan";
  const preset = presets[area.id];
  const runtimeCfg = getMapRuntimeConfig();

  async function readTexture(name) {
    const resp = await get(name.startsWith("/") ? name : prefix + name, signal);
    return createImageBitmap(await resp.blob(), {
      colorSpaceConversion: "none",
    });
  }

  async function readStartup() {
    if (!preset) {
      const [manifest, heights] = await Promise.all([
        get(prefix + "manifest.json", signal).then((r) => r.json()),
        unpack(prefix + "terrain.i16.gz", signal),
      ]);
      return { manifest, heights };
    }
    const packed = await unpack(preset.start, signal);
    const view = new DataView(packed);
    const endHeader = 8 + view.getUint32(0, true);
    const endTerrain = endHeader + view.getUint32(4, true);
    const header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(packed, 8, endHeader - 8)),
    );
    return {
      ...header,
      heights: packed.slice(endHeader, endTerrain),
      mesh: packed.slice(endTerrain),
    };
  }

  async function readPreview() {
    if (!preset) return readTexture("satellite.webp");
    const image = new Image();
    image.src = preset.preview;
    await image.decode();
    return createImageBitmap(image, { colorSpaceConversion: "none" });
  }

  const [startup, bitmap] = await Promise.all([readStartup(), readPreview()]);
  const { manifest, heights: heightBuffer } = startup;
  if (signal.aborted) {
    bitmap.close();
    throw new DOMException("Aborted", "AbortError");
  }
  const heights = new Int16Array(heightBuffer);
  const n = manifest.gridSize;
  const half = manifest.halfWidth;
  if (heights.length !== n * n) {
    bitmap.close();
    throw Error("缺少地形数据");
  }

  function ground(x, z) {
    const c = T.MathUtils.clamp(
      ((x + half) / (2 * half)) * (n - 1),
      0,
      n - 1.001,
    );
    const r = T.MathUtils.clamp(
      ((z + half) / (2 * half)) * (n - 1),
      0,
      n - 1.001,
    );
    const j = Math.floor(r);
    const i = Math.floor(c);
    const k = j * n + i;
    const u = c - i;
    const v = r - j;
    return (
      0.1 *
      ((heights[k] * (1 - u) + heights[k + 1] * u) * (1 - v) +
        (heights[k + n] * (1 - u) + heights[k + n + 1] * u) * v)
    );
  }

  let renderer;
  try {
    renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch (e) {
    bitmap.close();
    throw e;
  }
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);

  const scene = new T.Scene();
  const lightingKey = runtimeCfg.defaultLighting || "day";
  const atmosphere = createAtmosphereUniforms(lightingKey);
  scene.background = atmosphere.fogColor.value.clone();

  const farPlane = Math.max(80000, manifest.radius * 12);
  const camera = new T.PerspectiveCamera(44, 1, 2, farPlane);
  const controls = new MapControls(camera, renderer.domElement);
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI * 0.42;
  controls.minDistance = 32;
  controls.maxDistance = Math.max(34000, manifest.radius * 6.5);
  controls.enableDamping = false;
  controls.screenSpacePanning = false;

  const skyDome = createSkyDome(atmosphere, farPlane * 0.72);
  scene.add(skyDome);

  let baseBitmap = bitmap;
  const tex = landscapeTexture(bitmap);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const sharedUniforms = {
    ...atmosphere,
    baseMap: { value: tex },
    prevDetailMap: { value: tex },
    prevDetailRect: { value: new T.Vector4(0, 0, -1, -1) },
    detailMap: { value: tex },
    detailRect: { value: new T.Vector4(0, 0, -1, -1) },
    halfWidth: { value: half },
  };

  const floorMaterial = createRealisticTerrainMaterial(sharedUniforms);
  const wallMaterial = createRealisticBuildingMaterial(sharedUniforms);
  const surface = new T.Mesh(terrainGeometry(heights, n, half), floorMaterial);
  scene.add(surface);

  const buildings = new T.Group();
  const lines = new T.Group();
  scene.add(buildings, lines);
  buildings.userData.wall = wallMaterial;

  const raycaster = new T.Raycaster();
  const cursor = new T.Vector3();
  const frustum = new T.Frustum();
  const projScreenMatrix = new T.Matrix4();
  const tileProbe = new T.Vector3();

  let frame = 0;
  let dead = false;
  let detailTimer;
  let patchAbort;
  let patchTexture = null;
  let prevPatchTexture = null;
  let lastPatch = "";
  let buildingsLoaded = 0;
  let buildingsFailed = 0;
  let currentLighting = lightingKey;

  let closeScene;
  let closeLoading = false;
  let closeFailed = false;
  let preferPhoto = isRuiheyuan;
  let closeState = "off";
  let motionFrame = 0;
  let showBuildings = isRuiheyuan ? false : runtimeCfg.default3DBuildings !== false;
  buildings.visible = showBuildings;

  const closeArea = () =>
    isRuiheyuan &&
    currentSpan() / Math.max(1, container.clientWidth) <
      (closeState === "off" ? 0.88 : 1.24);

  function photoLimit() {
    if (!isRuiheyuan || !preferPhoto) return 32;
    const tilePixel =
      (40075016.68557849 * Math.cos((area.lat * Math.PI) / 180)) / (256 * 2 ** 19);
    return (
      ((tilePixel / 1.25) * container.clientHeight) /
      (2 * Math.tan((camera.fov * Math.PI) / 360))
    );
  }

  function syncClose() {
    const near = closeArea();
    const use = near && !preferPhoto && !closeFailed;
    const status = !near
      ? "off"
      : preferPhoto
        ? "satellite"
        : closeFailed
          ? "failed"
          : closeScene
            ? "model"
            : "loading";
    if (closeState !== status) {
      closeState = status;
      container.dataset.closeView = status;
      cb.closeView(status);
    }
    if (use && !closeScene && !closeLoading) {
      closeLoading = true;
      Promise.all([import("./closeup/scene.js"), import("./ruihe-streets.json")])
        .then(([{ createCloseScene }, data]) => {
          if (dead || signal.aborted) return;
          return createCloseScene({
            scene,
            renderer,
            surface,
            buildings,
            ground,
            signal,
            data: data.default,
          });
        })
        .then((layer) => {
          if (!layer) return;
          if (dead || signal.aborted) {
            layer.dispose();
            return;
          }
          closeScene = layer;
          syncClose();
          render();
        })
        .catch(() => {
          if (dead || signal.aborted) return;
          closeFailed = true;
          closeLoading = false;
          syncClose();
          refine();
          render();
        });
    }
    closeScene?.update(use, controls.target);
    skyDome.visible = status !== "model";
    buildings.visible = showBuildings && status !== "satellite";
    if (streets)
      streets.visible =
        streetVisible() && status !== "model" && status !== "satellite";
    if (use && patchAbort) {
      patchAbort.abort();
      patchAbort = null;
      lastPatch = "";
    }
  }
  delete container.dataset.closeView;

  function cancelMotion() {
    cancelAnimationFrame(motionFrame);
    motionFrame = 0;
  }

  let streets;
  let streetLoading = false;
  function streetVisible() {
    return (
      currentSpan() < 1150 &&
      Math.hypot(controls.target.x, controls.target.z) < 5550
    );
  }
  function updateStreets() {
    if (!isRuiheyuan || (preferPhoto && !showBuildings)) return;
    const visible = streetVisible();
    if (streets) {
      streets.visible =
        visible && closeState !== "model" && closeState !== "satellite";
      container.dataset.streetDetail = visible ? "visible" : "hidden";
    } else if (visible && !streetLoading) {
      streetLoading = true;
      Promise.all([import("./streetLayer.js"), import("./ruihe-streets.json")])
        .then(([{ streetLayer }, data]) => {
          if (dead || signal.aborted) return;
          streets = streetLayer(data.default, ground);
          scene.add(streets);
          updateStreets();
          render();
        })
        .catch(() => {
          streetLoading = false;
        });
    }
  }
  delete container.dataset.streetDetail;

  function render() {
    if (dead || signal.aborted || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (dead) return;
      skyDome.position.copy(camera.position);
      renderer.render(scene, camera);
      cb.draw();
    });
  }

  function size() {
    controls.minDistance = photoLimit();
    const w = container.clientWidth || 360;
    const h = container.clientHeight || 330;
    renderer.setPixelRatio(
      Math.min(devicePixelRatio || 1, 2, Math.sqrt(2600000 / (w * h))),
    );
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (currentSpan() > 1) syncClose();
    render();
  }

  function show(p, span, azimuth = 0, tilt = 39) {
    const { x, z } = project.toLocal(p);
    const dist = T.MathUtils.clamp(
      span / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect),
      controls.minDistance,
      controls.maxDistance,
    );
    const angle = (azimuth * Math.PI) / 180;
    const phi = (tilt * Math.PI) / 180;
    controls.target.set(x, ground(x, z), z);
    camera.position
      .copy(controls.target)
      .add(
        new T.Vector3(
          -Math.sin(angle) * Math.sin(phi),
          Math.cos(phi),
          Math.cos(angle) * Math.sin(phi),
        ).multiplyScalar(dist),
      );
    controls.update();
    render();
  }

  function currentSpan() {
    return (
      camera.position.distanceTo(controls.target) *
      2 *
      Math.tan((camera.fov * Math.PI) / 360) *
      camera.aspect
    );
  }
  function heading() {
    return ((-controls.getAzimuthalAngle() * 180) / Math.PI + 360) % 360;
  }

  function clearLines() {
    for (const item of [...lines.children]) {
      lines.remove(item);
      item.geometry.dispose();
      item.material.dispose();
    }
  }
  function drawLine(points, color, width) {
    if (!points?.length) return;
    const verts = points.map((p) => {
      const { x, z } = project.toLocal(p);
      return new T.Vector3(x, ground(x, z) + 2, z);
    });
    if (width > 1) {
      const geometry = new LineGeometry();
      geometry.setPositions(verts.flatMap((v) => [v.x, v.y, v.z]));
      const material = new LineMaterial({
        color,
        linewidth: width,
        depthTest: false,
        depthWrite: false,
      });
      const line = new Line2(geometry, material);
      line.renderOrder = width > 5 ? 6 : 7;
      lines.add(line);
      return;
    }
    const geometry = new T.BufferGeometry().setFromPoints(verts);
    const material = new T.LineBasicMaterial({
      color,
      linewidth: width,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const obj = new T.Line(geometry, material);
    obj.renderOrder = 5;
    lines.add(obj);
  }

  function changed() {
    const t = controls.target;
    const x = T.MathUtils.clamp(t.x, -half, half);
    const z = T.MathUtils.clamp(t.z, -half, half);
    const dy = ground(x, z) - t.y;
    camera.position.add(new T.Vector3(x - t.x, dy, z - t.z));
    t.set(x, t.y + dy, z);
    render();
    updateStreets();
    syncClose();
    clearTimeout(detailTimer);
    detailTimer = setTimeout(refine, currentSpan() > 2500 ? 600 : 140);
  }
  controls.addEventListener("change", changed);
  controls.addEventListener("start", cancelMotion);

  let press = null;
  function down(e) {
    cancelMotion();
    press = { x: e.clientX, y: e.clientY };
  }
  function up(e) {
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6)
      return;
    press = null;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new T.Vector2(
        (2 * (e.clientX - rect.left)) / rect.width - 1,
        1 - (2 * (e.clientY - rect.top)) / rect.height,
      ),
      camera,
    );
    const hit = raycaster.intersectObject(surface, false)[0];
    if (hit) cb.pick(project.toGeo(hit.point.x, hit.point.z));
  }
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (!dead && !signal.aborted) cb.fail();
  });

  // High-speed cached dual-buffer satellite refinement: keeps previous hi-res level visible while new tiles stream in.
  async function refine() {
    if (dead || signal.aborted || (closeArea() && !preferPhoto && !closeFailed))
      return;
    if (navigator.onLine === false) {
      cb.texture("unavailable");
      return;
    }
    const span = currentSpan();
    const center = project.toGeo(controls.target.x, controls.target.z);
    const rad = Math.PI / 180;
    const circumference = 40075016.68557849 * Math.cos(area.lat * rad);
    const pixels = container.clientWidth * renderer.getPixelRatio();
    if (isRuiheyuan && span / Math.max(1, pixels) >= manifest.sourcePixelsM) {
      patchAbort?.abort();
      lastPatch = "";
      sharedUniforms.detailRect.value.z = -1;
      sharedUniforms.prevDetailRect.value.z = -1;
      delete container.dataset.imageryLevel;
      cb.texture("local");
      render();
      return;
    }
    const z = T.MathUtils.clamp(
      Math.ceil(
        Math.log2(circumference / ((span / Math.max(320, pixels)) * 256)),
      ),
      11,
      19,
    );
    const gridN = 2 ** z;
    const tx = Math.floor(((center.lon + 180) / 360) * gridN);
    const ty = Math.floor(
      ((1 - Math.asinh(Math.tan(center.lat * rad)) / Math.PI) / 2) * gridN,
    );
    const viewportSpan = Math.max(
      span,
      span / camera.aspect / Math.max(0.6, Math.cos(controls.getPolarAngle())),
    );
    const tilesAcross = viewportSpan / (circumference / gridN);
    const halfTiles = T.MathUtils.clamp(Math.ceil(tilesAcross / 2 + 0.6), 2, 5);
    const key = `${z}/${tx}/${ty}/${halfTiles}`;
    if (key === lastPatch) return;
    lastPatch = key;
    delete container.dataset.imageryLevel;
    cb.texture("fetching");
    patchAbort?.abort();
    const controller = new AbortController();
    patchAbort = controller;

    const dim = 2 * halfTiles + 1;
    const left = tx - halfTiles;
    const top = ty - halfTiles;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = dim * 256;
    const context = canvas.getContext("2d");
    const corner = project.toLocal({
      lon: (left / gridN) * 360 - 180,
      lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * top) / gridN))) / rad,
    });

    const tasks = Array.from({ length: dim * dim }, (_, i) => ({
      x: i % dim,
      y: Math.floor(i / dim),
    }));
    tasks.sort(
      (a, b) =>
        Math.hypot(a.x - halfTiles, a.y - halfTiles) -
        Math.hypot(b.x - halfTiles, b.y - halfTiles),
    );

    let uploaded = 0;
    let completed = 0;
    let hasCenter = false;
    let texture = null;
    let refreshTimer;
    const live = () => !dead && !signal.aborted && !controller.signal.aborted;

    function publish() {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      if (!live() || !completed || uploaded === completed) return;
      if (!texture) {
        texture = new T.CanvasTexture(canvas);
        texture.flipY = false;
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = tex.anisotropy;
        // Promote the previous high-res patch to fallback buffer instead of discarding immediately.
        if (patchTexture && patchTexture !== texture) {
          prevPatchTexture?.dispose();
          prevPatchTexture = patchTexture;
          sharedUniforms.prevDetailMap.value = prevPatchTexture;
          sharedUniforms.prevDetailRect.value.copy(sharedUniforms.detailRect.value);
        }
        patchTexture = texture;
        sharedUniforms.detailMap.value = texture;
        sharedUniforms.detailRect.value.set(
          corner.x,
          corner.z,
          (circumference / gridN) * dim,
          (circumference / gridN) * dim,
        );
      }
      texture.needsUpdate = true;
      uploaded = completed;
      if (hasCenter) {
        container.dataset.imageryLevel = String(z);
        cb.texture(completed === dim * dim ? "detail" : "mixed");
      }
      render();
    }

    async function worker() {
      while (tasks.length && live()) {
        const { x, y } = tasks.shift();
        try {
          const urls = resolveTileUrls({
            z,
            x: left + x,
            y: top + y,
            archive: isRuiheyuan,
          });
          const image = await loadTileBitmap(urls, controller.signal);
          try {
            if (live()) {
              context.drawImage(image, 256 * x, 256 * y);
              completed++;
              if (x === halfTiles && y === halfTiles) hasCenter = true;
              if (!uploaded && hasCenter) publish();
              else if (refreshTimer === undefined)
                refreshTimer = setTimeout(publish, 160);
            }
          } finally {
            image.close();
          }
        } catch {
          if (x === halfTiles && y === halfTiles && live()) {
            cb.texture("unavailable");
            tasks.length = 0;
          }
        }
      }
    }

    controller.signal.addEventListener(
      "abort",
      () => clearTimeout(refreshTimer),
      { once: true },
    );
    await Promise.all([
      worker(),
      worker(),
      worker(),
      worker(),
      worker(),
      worker(),
    ]);
    publish();
    if (live() && !hasCenter) {
      lastPatch = "";
      cb.texture("unavailable");
    }
  }

  const api = {
    mode: "model",
    area,
    atPhotoLimit: () =>
      Boolean(
        isRuiheyuan &&
          preferPhoto &&
          camera.position.distanceTo(controls.target) <=
            controls.minDistance * 1.015,
      ),
    retryPhoto() {
      lastPatch = "";
      void refine();
    },
    comparePhoto() {
      preferPhoto = closeState !== "satellite";
      closeFailed = false;
      syncClose();
      refine();
      render();
    },
    lighting() {
      return currentLighting;
    },
    setLighting(presetKey) {
      const applied = applyLightingPreset(sharedUniforms, presetKey);
      currentLighting = applied.id;
      if (closeState !== "model") {
        scene.background = applied.fogColor.clone();
      }
      render();
      return currentLighting;
    },
    cancelMotion,
    approach(p, span, animate) {
      cancelMotion();
      const endHeading = preferPhoto ? 0 : 24;
      const tilt = preferPhoto ? 9 : 54;
      if (!animate) {
        show(p, span, endHeading, tilt);
        return;
      }
      const start = performance.now();
      function tick(now) {
        if (dead || signal.aborted) return;
        const t = Math.min(1, (now - start) / 540);
        const ease = (1 - t) ** 3;
        show(p, span * (1 + 0.19 * ease), endHeading - 12 * ease, tilt - 8 * ease);
        if (t < 1) motionFrame = requestAnimationFrame(tick);
      }
      tick(start);
    },
    toggleBuildings() {
      showBuildings = !showBuildings;
      buildings.visible = showBuildings && closeState !== "satellite";
      renderer.shadowMap.needsUpdate = true;
      render();
      return showBuildings;
    },
    project(p) {
      const { x, z } = project.toLocal(p);
      cursor.set(x, ground(x, z) + 3, z).project(camera);
      return cursor.z > 1 || cursor.z < -1
        ? null
        : {
            x: ((cursor.x + 1) * container.clientWidth) / 2,
            y: ((1 - cursor.y) * container.clientHeight) / 2,
          };
    },
    center() {
      return project.toGeo(controls.target.x, controls.target.z);
    },
    range: currentSpan,
    heading,
    view(p, span) {
      cancelMotion();
      show(
        p,
        span,
        0,
        preferPhoto
          ? 9
          : span >= manifest.radius * 2
            ? 24
            : span <= 180
              ? 60
              : 42,
      );
    },
    zoom(step) {
      cancelMotion();
      show(
        api.center(),
        currentSpan() * 0.6 ** step,
        heading(),
        (controls.getPolarAngle() * 180) / Math.PI,
      );
    },
    rotateBy(degrees) {
      cancelMotion();
      show(
        api.center(),
        currentSpan(),
        heading() + degrees,
        preferPhoto
          ? (controls.getPolarAngle() * 180) / Math.PI
          : Math.min(
              64,
              Math.max(48, (controls.getPolarAngle() * 180) / Math.PI),
            ),
      );
    },
    north() {
      cancelMotion();
      show(
        api.center(),
        currentSpan(),
        0,
        (controls.getPolarAngle() * 180) / Math.PI,
      );
    },
    lines(grid, route) {
      clearLines();
      for (const line of grid) drawLine(line, "#ffe7a0", 1);
      drawLine(route, "#ffffff", 8);
      drawLine(route, "#19764f", 4);
      render();
    },
    resize: size,
    dispose() {
      dead = true;
      cancelMotion();
      closeScene?.dispose();
      cancelAnimationFrame(frame);
      clearTimeout(detailTimer);
      patchAbort?.abort();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      clearLines();
      for (const part of streets?.children || []) {
        part.geometry.dispose();
        part.material.dispose();
      }
      skyDome.geometry.dispose();
      skyDome.material.dispose();
      surface.geometry.dispose();
      for (const m of buildings.children) m.geometry.dispose();
      floorMaterial.dispose();
      wallMaterial.dispose();
      tex.dispose();
      patchTexture?.dispose();
      prevPatchTexture?.dispose();
      baseBitmap.close();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };

  container.dataset.textureResolution = preset ? "preview" : "full";
  async function loadFullTexture() {
    if (!preset || dead || signal.aborted) return;
    return readTexture(preset.full)
      .then((full) => {
        if (dead || signal.aborted) {
          full.close();
          return;
        }
        const previous = baseBitmap;
        baseBitmap = full;
        tex.image = full;
        tex.needsUpdate = true;
        container.dataset.textureResolution = "full";
        render();
        previous.close();
      })
      .catch(() => {
        if (!dead && !signal.aborted) cb.imagery("partial");
      });
  }

  if (startup.mesh && startup.mesh.byteLength > 28) {
    buildings.add(new T.Mesh(buildingGeometrySync(startup.mesh), wallMaterial));
    buildingsLoaded++;
  }
  container.dataset.blocks = String(buildingsLoaded);
  delete container.dataset.imageryLevel;
  size();
  show(area, 3000);
  cb.meta(manifest);
  cb.imagery("ready");

  const pending = manifest.chunks.filter((tile) => tile.file !== startup.first);
  function chunkPriority(tile) {
    const t = controls.target;
    const d = Math.hypot(tile.x - t.x, tile.z - t.z);
    camera.updateMatrixWorld();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);
    tileProbe.set(tile.x, ground(tile.x, tile.z) + 20, tile.z);
    // Prioritize blocks inside the active camera frustum by 4x for immediate visual completion.
    return frustum.containsPoint(tileProbe) ? d * 0.25 : d;
  }

  async function loadBuildings() {
    while (pending.length && !dead && !signal.aborted) {
      pending.sort((a, b) => chunkPriority(a) - chunkPriority(b));
      const tile = pending.shift();
      try {
        const resp = await get(tile.url || prefix + tile.file, signal);
        const compressed = await resp.arrayBuffer();
        const decoded = await decodeBuildingAsync(compressed);
        if (dead || signal.aborted) return;
        const g = geometryFromDecoded(decoded);
        const mesh = new T.Mesh(g, wallMaterial);
        buildings.add(mesh);
        closeScene?.building(mesh);
        renderer.shadowMap.needsUpdate = true;
        buildingsLoaded++;
        render();
      } catch {
        if (dead || signal.aborted) return;
        buildingsFailed++;
      }
      container.dataset.blocks = String(buildingsLoaded);
      if (buildingsFailed) cb.imagery("partial");
    }
  }

  // 4 concurrent fetch + Worker-pool decode streams saturate HTTP/2 without stalling main-thread FPS.
  void loadBuildings();
  void loadBuildings();
  void loadBuildings();
  void loadBuildings();

  requestAnimationFrame(() => requestAnimationFrame(loadFullTexture));
  return api;
}
