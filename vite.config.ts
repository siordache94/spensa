import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// shown in Settings so a phone can tell which deploy it runs
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? 'dev' } })()
const build = `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // SW is build-only (devOptions.enabled defaults to false). Data is cached by the query persister, not here.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Spensa',
        short_name: 'Spensa',
        description: "Plan the week's meals, track the pantry and get the shopping list that follows.",
        display: 'standalone',
        start_url: '/',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // push + notificationclick handlers live in public/push-sw.js; the generated caching worker is unchanged
        importScripts: ['push-sw.js'],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  define: { __BUILD__: JSON.stringify(build) },
  server: { host: true }, // reachable from a phone on the same network
})
