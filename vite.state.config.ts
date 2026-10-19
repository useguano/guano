import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { mitBanner } from './scripts/mit-banner'

// Browser build for the published site's client-state runtime. Bundles
// src/state/runtime.ts + the shared engine (src/lib/shared/state.js) into one
// self-executing script that server/export.mjs copies to assets/state.js.
//
// A build rather than a hand-written file, for the same reason motion.js is
// one: the op semantics and the list query MUST be the modules the editor runs,
// or Preview and the published site drift. It also means the re-render can
// reuse `sanitizeRich` verbatim — golden rule 6 requires the same sanitizer the
// initial render used, and site-runtime.js (served raw, importing nothing)
// could only have repeated it.
//
// The output is committed so `npm run serve` works on a fresh checkout;
// `npm run build:state` regenerates it.
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
      entry: fileURLToPath(new URL('./src/state/runtime.ts', import.meta.url)),
      // IIFE: a plain <script> the page can load with no module plumbing
      formats: ['iife'],
      name: 'SuperbirdState',
      fileName: () => 'state-runtime.js',
    },
  },
})
