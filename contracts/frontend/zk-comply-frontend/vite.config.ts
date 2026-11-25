import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  // W11-AUD-010: build Web Worker bundles as ES modules so they can use the
  // same wasm + topLevelAwait plugins and import @aztec/bb.js / @noir-lang/*
  // correctly from inside the worker context.
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
  optimizeDeps: {
    exclude: ["@aztec/bb.js", "@noir-lang/noir_wasm"],
  },
});
