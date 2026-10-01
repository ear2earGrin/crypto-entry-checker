import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

// Serves the Mac mini scout job's snapshot (data/scout/latest.json) to the
// SCOUT tab. Dev server only: static deploys (pm-brief) have no scout data.
function scoutData() {
  return {
    name: "scout-data",
    configureServer(server) {
      server.middlewares.use("/scout-data/latest.json", async (_req, res) => {
        try {
          const body = await readFile(new URL("./data/scout/latest.json", import.meta.url));
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end('{"error":"no scout data yet"}');
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // Relative base so the built bundle works under ANY subpath (e.g. pm-brief.com/trading/).
  // Dev keeps '/' — the dev server needs an absolute base.
  base: command === "build" ? "./" : "/",
  plugins: [react(), scoutData()],
  server: {
    proxy: {
      // Binance spot (already working for you, but keep consistent)
      "/binance-spot": {
        target: "https://api.binance.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-spot/, ""),
      },

      // Binance's public market-data mirror: fallback when api.binance.com
      // answers 451 (US addresses, e.g. a US VPN). Same spot data.
      "/binance-data": {
        target: "https://data-api.binance.vision",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-data/, ""),
      },

      // Binance USDT-M futures
      "/binance-fut": {
        target: "https://fapi.binance.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-fut/, ""),
      },

      // Binance COIN-M futures (optional, but useful later)
      "/binance-dapi": {
        target: "https://dapi.binance.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-dapi/, ""),
      },
    },
  },
}));