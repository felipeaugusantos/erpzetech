// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  vite: {
    // Keep Radix hook consumers in the initial dependency graph instead of adding
    // a second optimized React graph when a lazy screen first opens.
    optimizeDeps: { include: ["@radix-ui/react-slot", "@radix-ui/react-compose-refs"] },
    plugins: [
      VitePWA({
        strategies: "generateSW",
        filename: "sw.js",
        injectRegister: null,
        outDir: "dist/client",
        registerType: "autoUpdate",
        devOptions: { enabled: false },
        manifest: false,
        workbox: {
          globPatterns: ["**/*.{js,css,png,woff2}"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallback: null,
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/_serverFn/],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" &&
                url.origin === self.location.origin &&
                !/^\/(~oauth|api|_serverFn)/.test(url.pathname),
              handler: "NetworkFirst",
              options: {
                cacheName: "zt-pages",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 30, maxAgeSeconds: 86400 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /^\/assets\/.+-[a-zA-Z0-9_-]{8,}\.(js|css|png|woff2)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "zt-assets",
                expiration: { maxEntries: 600, maxAgeSeconds: 2592000 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
