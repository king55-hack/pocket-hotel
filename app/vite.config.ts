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
      // the guest page (opened from a room QR code) is its own page: the staff app must not swallow its address
      workbox: { globPatterns: ["**/*.{js,css,html,png,svg}"], globIgnores: ["guest.html"], navigateFallbackDenylist: [/^\/guest\.html/, /^\/privacy\.html/, /^\/google/] },
    }),
  ],
  build: { sourcemap: false, rollupOptions: { input: { main: "index.html", guest: "guest.html" } } },
  test: { environment: "node", include: ["src/tests/**/*.test.ts"] },
});
