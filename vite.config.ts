import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

// pdf.js loads its JBIG2 / JPEG 2000 / colour-profile decoders from a wasmUrl
// directory at runtime. Serve them in dev and emit them into the build (so
// they're precached) straight from the installed pdfjs-dist version.
function pdfjsWasm(): Plugin {
  const dir = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'wasm')
  const files = ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']
  return {
    name: 'pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use('/pdfjs-wasm/', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0]
        if (!files.includes(name)) return next()
        res.setHeader('Content-Type', 'application/wasm')
        res.end(readFileSync(join(dir, name)))
      })
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({ type: 'asset', fileName: `pdfjs-wasm/${name}`, source: readFileSync(join(dir, name)) })
      }
    },
  }
}

// Long-lived vendor code in its own chunks: smaller app chunk, and a deploy
// that only changes app code leaves these cached.
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return
  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react'
  if (/node_modules\/(react-router|react-router-dom|@remix-run\/router)\//.test(id)) return 'vendor-router'
  if (/node_modules\/(dexie|dexie-react-hooks)\//.test(id)) return 'vendor-dexie'
}

export default defineConfig({
  build: {
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
  plugins: [
    react(),
    pdfjsWasm(),
    VitePWA({
      registerType: 'prompt',
      // Custom worker (src/sw.ts) for notification clicks and periodic sync;
      // workbox still injects the precache manifest.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Clinic Register',
        short_name: 'Clinic',
        description: 'Offline-first outpatient register for a homeopathy clinic: patients, visits, prescriptions, billing and stock.',
        lang: 'en-IN',
        scope: '/',
        categories: ['medical', 'productivity'],
        theme_color: '#17805e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        // PNGs come from scripts/make-icons.mjs.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // Install dialog previews (demo data).
        screenshots: [
          { src: 'screenshots/desktop-dashboard.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'Dashboard' },
          { src: 'screenshots/mobile-dashboard.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Dashboard on a phone' },
        ],
      },
      injectManifest: {
        // mjs/wasm: the lazy PDF chunk's pdf.js worker and decoders, so
        // attachments can be compressed offline. (navigateFallback lives in
        // src/sw.ts.)
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm}'],
        globIgnores: ['screenshots/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
})
