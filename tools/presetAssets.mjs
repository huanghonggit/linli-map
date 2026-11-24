import { startMapPreview } from "./openingPreview.mjs";
// Content-addressed preset assets can be cached independently of the HTML entry.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

function areaTargets() {
  const areas = JSON.parse(readFileSync("tools/model/areas.json", "utf-8"));
  const list = [];
  for (const area of areas) {
    if (Array.isArray(area.radiiKm)) {
      for (const km of area.radiiKm) {
        list.push({ id: `${area.id}-${km}`, focus: [250, -380] });
      }
    } else {
      list.push({ id: area.id, focus: [0, 0] });
    }
  }
  return list;
}

export function presetAssets() {
  const assets = new Map();
  const presets = {};
  function add(stem, suffix, bytes) {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const url = `/assets/${stem}-${hash}.${suffix}`;
    assets.set(url, bytes);
    return url;
  }

  for (const { id, focus } of areaTargets()) {
    const dir = `public/models/v1/${id}`;
    if (!existsSync(`${dir}/manifest.json`) || !existsSync(`${dir}/preview.webp`)) {
      continue;
    }
    const read = (name) => readFileSync(`${dir}/${name}`);
    const manifest = JSON.parse(read("manifest.json"));
    if (!Array.isArray(manifest.chunks) || !manifest.chunks.length) continue;

    // Pick the nearest central building block to deliver inside the single opening bundle.
    const [fx, fz] = focus;
    const first = [...manifest.chunks].sort(
      (a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz),
    )[0];
    const mesh = gunzipSync(read(first.file));
    for (const tile of manifest.chunks) {
      if (tile !== first) tile.url = add(`${id}-mesh`, "bin", read(tile.file));
    }
    const heights = gunzipSync(read("terrain.i16.gz"));
    const header = Buffer.from(JSON.stringify({ manifest, first: first.file }));
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32LE(header.length, 0);
    lengths.writeUInt32LE(heights.length, 4);
    presets[id] = {
      preview: add(`${id}-preview`, "webp", read("preview.webp")),
      start: add(
        `${id}-start`,
        "bin",
        gzipSync(Buffer.concat([lengths, header, heights, mesh]), { level: 9 }),
      ),
      full: add(`${id}-satellite`, "webp", read("satellite.webp")),
    };
  }

  const virtualId = "virtual:neighborhood-presets";
  return {
    name: "neighborhood-presets",
    resolveId: (id) => (id === virtualId ? "\0" + id : null),
    load: (id) =>
      id === "\0" + virtualId ? `export default ${JSON.stringify(presets)}` : null,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        const bytes = assets.get(url);
        if (!bytes) return next();
        res.setHeader(
          "Content-Type",
          url.endsWith(".webp") ? "image/webp" : "application/octet-stream",
        );
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(bytes);
      });
    },
    generateBundle() {
      for (const [url, source] of assets)
        this.emitFile({ type: "asset", fileName: url.slice(1), source });
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const script = `(${startMapPreview.toString()})(${JSON.stringify(presets)})`;
        return html
          .replace("</title>", `</title>\n    <script>${script}</script>`)
          .replace(
            "<script type=\"module\" crossorigin src=",
            "<script type=\"module\" fetchpriority=\"high\" crossorigin src=",
          );
      },
    },
  };
}
