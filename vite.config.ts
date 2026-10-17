/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'GO Vault',
        short_name: 'GO Vault',
        description: 'Gestor de Pokémon GO: IVs, ligas PvP, equipos y calculadora.',
        lang: 'es',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // El manifest se pide primero a la red (detecta versiones nuevas) y, sin conexión, usa la última copia
            urlPattern: ({ url }) => url.pathname.endsWith('/data/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'govault-manifest', networkTimeoutSeconds: 4, expiration: { maxEntries: 5 } },
          },
          {
            // Datos versionados (?v=<dataVersion>): stale-while-revalidate, disponibles sin conexión
            urlPattern: ({ url }) => url.pathname.includes('/data/') && url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'govault-data', expiration: { maxEntries: 120, purgeOnQuotaError: true } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'raw.githubusercontent.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'govault-sprites',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-dom.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
