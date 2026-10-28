import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pocket Hotel",
        short_name: "Pocket Hotel",
        description: "Hotel app for small hotels in Nepal. Works offline.",
        theme_color: "#0f6b5c",
        background_color: "#f6f4ef",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,png,svg}"] },
    }),
  ],
  build: { sourcemap: false },
  test: { environment: "node", include: ["src/tests/**/*.test.ts"] },
});
