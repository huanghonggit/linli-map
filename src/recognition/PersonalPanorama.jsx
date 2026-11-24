import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  ImagePlus,
} from "lucide-react";

// Full spherical captures stay on this device. This store is separate from the small saved-place thumbnails.
async function localSphere(id, blob) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("linli-street-photos", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("spheres");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("spheres", blob ? "readwrite" : "readonly");
      const store = tx.objectStore("spheres");
      const req = blob ? store.put(blob, id) : store.get(id);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function prepare(file) {
  if (!file?.type.startsWith("image/") || file.size > 64 * 1024 * 1024)
    throw Error("请选择小于 64 MB 的全景照片。");
  const bitmap = await createImageBitmap(file);
  try {
    if (
      Math.abs(bitmap.width / bitmap.height - 2) > 0.035 ||
      bitmap.width < 1024
    )
      throw Error(
        "请选择相机导出的 360° 球形全景图，宽高为 2:1，宽度至少 1024 像素。",
      );
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(6144, bitmap.width);
    canvas.height = Math.round(canvas.width / 2);
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok, no) =>
      canvas.toBlob(
        (blob) => (blob ? ok(blob) : no(Error("无法读取这张照片。"))),
        "image/jpeg",
        0.94,
      ),
    );
  } finally {
    bitmap.close();
  }
}
function Sphere({ blob }) {
  const container = useRef(null),
    handle = useRef(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false,
      renderer,
      texture,
      geometry,
      material,
      observer,
      bitmap;
    const el = container.current;
    async function show() {
      const T = await import("three");
      if (disposed) return;
      bitmap = await createImageBitmap(blob);
      if (disposed) {
        bitmap.close();
        return;
      }
      renderer = new T.WebGLRenderer({
        antialias: false,
        powerPreference: "low-power",
      });
      el.append(renderer.domElement);
      const scene = new T.Scene(),
        camera = new T.PerspectiveCamera(72, 1, 0.1, 25);
      camera.rotation.order = "YXZ";
      texture = new T.Texture(bitmap);
      texture.flipY = false;
      texture.colorSpace = T.SRGBColorSpace;
      texture.needsUpdate = true;
      geometry = new T.SphereGeometry(10, 80, 48);
      geometry.scale(-1, 1, 1);
      // ImageBitmap has top-down pixel rows, so invert V on the geometry once.
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      material = new T.MeshBasicMaterial({ map: texture });
      scene.add(new T.Mesh(geometry, material));
      let yaw = 0,
        pitch = 0,
        fov = 72;
      function adjust(dx = 0, dy = 0, dz = 0) {
        yaw += dx;
        pitch = T.MathUtils.clamp(pitch + dy, -82, 82);
        fov = T.MathUtils.clamp(fov + dz, 30, 95);
        camera.rotation.set(
          T.MathUtils.degToRad(pitch),
          T.MathUtils.degToRad(yaw),
          0,
          "YXZ",
        );
        camera.fov = fov;
        camera.aspect = (el.clientWidth || 360) / (el.clientHeight || 280);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      }
      observer = new ResizeObserver(() => {
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        renderer.setSize(el.clientWidth, el.clientHeight, false);
        adjust();
      });
      observer.observe(el);
      handle.current = adjust;
      adjust();
    }
    setFailed(false);
    show().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      handle.current = null;
      texture?.dispose();
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      bitmap?.close();
    };
  }, [blob]);
  const drag = useRef(null);
  return (
    <>
      <div
        className="own-sphere"
        ref={container}
        role="img"
        aria-label="自己拍摄的 360 度全景，可拖动环看"
        onPointerDown={(e) => {
          drag.current = [e.clientX, e.clientY];
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const [x, y] = drag.current;
          handle.current?.((e.clientX - x) * 0.25, (e.clientY - y) * 0.2);
          drag.current = [e.clientX, e.clientY];
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      {failed ? (
        <p className="error">
          这台设备暂时无法显示全景。仍可查看地点照片和路牌。
        </p>
      ) : (
        <div className="sphere-tools">
          <button aria-label="全景向左转" onClick={() => handle.current?.(35)}>
            <ChevronLeft />
          </button>
          <button aria-label="全景向右转" onClick={() => handle.current?.(-35)}>
            <ChevronRight />
          </button>
          <button
            aria-label="放大全景"
            onClick={() => handle.current?.(0, 0, -12)}
          >
            <Plus />
          </button>
          <button
            aria-label="缩小全景"
            onClick={() => handle.current?.(0, 0, 12)}
          >
            <Minus />
          </button>
        </div>
      )}
    </>
  );
}
export default function PersonalPanorama({ place }) {
  const [blob, setBlob] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let valid = true;
    localSphere(place.id)
      .then((v) => {
        if (valid && v) setBlob(v);
      })
      .catch(() => {});
    return () => {
      valid = false;
      mounted.current = false;
    };
  }, [place.id]);
  async function save(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = await prepare(file);
      await localSphere(place.id, data);
      if (mounted.current) setBlob(data);
    } catch (err) {
      if (mounted.current) setError(err.message || "本机储存空间不足。");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <details className="own-pano" open={blob ? true : undefined}>
      <summary>我的街面全景</summary>
      {blob && <Sphere blob={blob} />}
      <p className="fine">可用家人拍的 2:1 全景照，照片只保存在这台设备上。</p>
      <label className="upload">
        <ImagePlus />
        {busy ? "正在保存…" : blob ? "更换本机全景照" : "选择本机全景照"}
        <input
          type="file"
          disabled={busy}
          accept="image/jpeg,image/png,image/webp"
          onChange={save}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}
