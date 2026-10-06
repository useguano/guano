import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { mitBanner } from './scripts/mit-banner'

// Browser build for the published site's motion runtime. Bundles
// src/motion/runtime.ts + the shared engine (src/lib/shared/motion.js) into one
// self-executing script that server/export.mjs copies to assets/motion.js.
//
// Why a build (unlike server/site-runtime.js, which is hand-written ES5 and
// shipped verbatim): the tween math MUST be the same module the editor runs, so
// the published site and the canvas can't drift. Bundling is what lets one
// source serve both. The output is committed so `npm run serve` works on a
// fresh checkout; `npm run build:motion` regenerates it.
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
      entry: fileURLToPath(new URL('./src/motion/runtime.ts', import.meta.url)),
      // IIFE: a plain <script> the page can load with no module plumbing
      formats: ['iife'],
      name: 'GuanoMotion',
      fileName: () => 'motion-runtime.js',
    },
  },
})
