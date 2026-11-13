import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [react(), tsconfigPaths(), cesium()],
  base: "/",
  server: {
    port: 5173,
    open: false,
    proxy: {
      // FastAPI backend (see citypulse-ai-backend/app.py)
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
