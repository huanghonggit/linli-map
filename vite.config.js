import { presetAssets } from "./tools/presetAssets.mjs";
import { defineConfig } from "vite";
import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";

// Serve Cesium's prebuilt workers and terrain decoders with the app, also in static builds.
const engine = resolve("node_modules/cesium/Build/Cesium");
const parts = ["Cesium.js", "Assets", "Workers", "ThirdParty", "Widgets"];
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
export default defineConfig({
  plugins: [
    presetAssets(),
    {
      name: "local-cesium",
      configureServer(server) {
        server.middlewares.use("/cesium", (req, res, next) => {
          const path = resolve(engine, "." + (req.url || "/").split("?")[0]);
          if (
            !path.startsWith(engine + sep) ||
            !existsSync(path) ||
            !statSync(path).isFile()
          )
            return next();
          res.setHeader(
            "Content-Type",
            mime[extname(path)] || "application/octet-stream",
          );
          createReadStream(path)
            .on("error", () => res.destroy())
            .pipe(res);
        });
      },
      writeBundle() {
        for (const part of parts)
          cpSync(resolve(engine, part), resolve("dist/cesium", part), {
            recursive: true,
          });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.LINLI_API_PROXY || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: process.env.LINLI_API_PROXY || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
