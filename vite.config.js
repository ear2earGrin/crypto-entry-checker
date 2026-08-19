import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Relative base so the built bundle works under ANY subpath (e.g. pm-brief.com/trading/).
  // Dev keeps '/' — the dev server needs an absolute base.
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  server: {
    proxy: {
      // Binance spot (already working for you, but keep consistent)
      "/binance-spot": {
        target: "https://api.binance.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/binance-spot/, ""),
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