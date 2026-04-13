import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2020", "chrome105", "safari13"],
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@tiptap")) {
              return "editor";
            }

            if (id.includes("lightweight-charts")) {
              return "charts";
            }

            if (id.includes("@tauri-apps")) {
              return "tauri";
            }

            if (id.includes("react")) {
              return "react-vendor";
            }
          }

          return undefined;
        }
      }
    }
  }
});
