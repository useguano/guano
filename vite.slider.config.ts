import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { mitBanner } from './scripts/mit-banner'

// Browser build for the published site's slider runtime. Bundles
// src/slider/runtime.ts + the shared engine (src/lib/shared/slider.js) into one
// self-executing script that server/export.mjs copies to assets/slider.js.
//
// Same reasoning as vite.motion.config.ts: the carousel behaviour MUST be the
// same module the editor's Preview runs, so the published site and the preview
// can't drift. The output is committed so `npm run serve` works on a fresh
// checkout; `npm run build:slider` regenerates it.
export default defineConfig({
  plugins: [mitBanner()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./server', import.meta.url)),
    // server/ holds hand-written files — never wipe it
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'es2018',
    minify: true,
    lib: {
      entry: fileURLToPath(new URL('./src/slider/runtime.ts', import.meta.url)),
      // IIFE: a plain <script> the page can load with no module plumbing
      formats: ['iife'],
      name: 'GuanoSlider',
      fileName: () => 'slider-runtime.js',
    },
  },
})
