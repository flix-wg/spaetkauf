import { defineConfig } from 'vite'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Dev proxy target; SPK_API lets a second backend run next to the default one.
const duckdbFiles = ['duckdb-mvp.wasm', 'duckdb-eh.wasm', 'duckdb-browser-mvp.worker.js', 'duckdb-browser-eh.worker.js']
const api = process.env.SPK_API ?? 'http://localhost:8710'

export default defineConfig({
  plugins: [
    {
      name: 'duckdb-assets',
      configureServer(server) {
        server.middlewares.use('/duckdb', (req, res, next) => {
          const file = req.url?.split('?')[0].slice(1)
          if (!duckdbFiles.includes(file ?? '')) return next()
          res.setHeader('Content-Type', file!.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
          res.end(readFileSync(resolve('node_modules/@duckdb/duckdb-wasm/dist', file!)))
        })
      },
      closeBundle() {
        mkdirSync('dist/duckdb', { recursive: true })
        for (const file of duckdbFiles) copyFileSync(resolve('node_modules/@duckdb/duckdb-wasm/dist', file), resolve('dist/duckdb', file))
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Kurt',
        short_name: 'Kurt',
        description: 'Buy the cheap ticket for the train that is usually late. Ride the better one.',
        theme_color: '#FD4F00',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], globIgnores: ['data/**', 'duckdb/**', '**/duckdb-browser-*.js'] },
    }),
  ],
  server: {
    port: Number(process.env.SPK_PORT ?? 5710),
    proxy: {
      '/api': api,
      '/hooks': api,
    },
  },
})
