import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only static handler for the local terrain tile cache (populated by
 * scripts/fetch-terrain.mjs). Kept out of public/ so it never ships in dist.
 */
function terrainCache(): Plugin {
  const root = path.resolve(process.cwd(), "terrain-cache");
  return {
    name: "terrain-cache",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/terrain-cache/")) return next();
        const rel = req.url.slice("/terrain-cache/".length).split("?")[0];
        const file = path.resolve(root, rel);
        if (!file.startsWith(root + path.sep)) {
          res.statusCode = 403;
          return res.end();
        }
        try {
          const data = await readFile(file);
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Cache-Control", "max-age=3600");
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [terrainCache()],
  build: {
    // Vendor libraries in their own long-cached chunks (maplibre alone is ~800 kB).
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ["maplibre-gl"], astronomy: ["astronomy-engine"] },
      },
    },
    chunkSizeWarningLimit: 1100,
  },
});
