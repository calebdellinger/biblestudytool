import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: { global: 'globalThis', __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'YHWH — Bible Study',
        short_name: 'YHWH',
        description: 'A quiet Bible reader with deep study tools one tap away.',
        theme_color: '#f4f5f2',
        background_color: '#f4f5f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'data/books.json'],
        navigateFallbackDenylist: [/^\/db\//, /^\/api\//],
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            // Data that grows over time (speakers, red letters, introductions): fetch fresh when online,
            // fall back to the saved copy after a few seconds or when offline. (Stale-while-revalidate
            // meant new data only showed up on the second reload.)
            // "?dl" requests come from Settings › Offline library, which saves files itself, so they skip these rules.
            // No entry limits: the offline library can hold every file, and a limit would quietly delete some.
            urlPattern: ({ url }) => !url.searchParams.has('dl') && /^\/data\/(speakers|redletter|intro\.json|plans|theologians\/(index\.json|refs))/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'growing-data', networkTimeoutSeconds: 4 },
          },
          {
            urlPattern: ({ url }) => !url.searchParams.has('dl') && url.pathname.startsWith('/data/'),
            handler: 'CacheFirst',
            options: { cacheName: 'bible-data' },
          },
        ],
      },
    }),
  ],
  // During development, /db is forwarded to CouchDB on this machine (same as Tailscale does in use).
  server: { host: true, proxy: { '/db': { target: 'http://127.0.0.1:5984', rewrite: p => p.replace(/^\/db/, '') } } },
  preview: { proxy: { '/db': { target: 'http://127.0.0.1:5984', rewrite: p => p.replace(/^\/db/, '') } } },
})
