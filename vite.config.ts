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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "editor-core",
              test: /[\\/]node_modules[\\/]@tiptap[\\/](?:react|core)[\\/]/,
              priority: 40,
              maxSize: 240000
            },
            {
              name: "editor-extensions",
              test: /[\\/]node_modules[\\/]@tiptap[\\/](?:extension-[^\\/]+|starter-kit|suggestion)[\\/]/,
              priority: 35,
              maxSize: 220000
            },
            {
              name: "editor-prosemirror",
              test: /[\\/]node_modules[\\/](?:@tiptap[\\/]pm|prosemirror|orderedmap|rope-sequence)[\\/]/,
              priority: 30,
              maxSize: 220000
            },
            {
              name: "charts-drawing",
              test: /[\\/]node_modules[\\/]lightweight-charts-drawing[\\/]/,
              priority: 25
            },
            {
              name: "charts-core",
              test: /[\\/]node_modules[\\/]lightweight-charts[\\/]/,
              priority: 20
            },
            {
              name: "supabase",
              test: /[\\/]node_modules[\\/]@supabase[\\/]/,
              priority: 15
            },
            {
              name: "tauri",
              test: /[\\/]node_modules[\\/]@tauri-apps[\\/]/,
              priority: 15
            },
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 50
            },
          ]
        }
      }
    }
  }
});
