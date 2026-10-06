import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Lib build for the MCP runtime bundle. Bundles src/lib/mcp-runtime.ts and its
// transitive deps into ONE DOM-free ESM file consumed by `guano mcp`
// (packages/guano/mcp/). No Vue plugin — the reachable graph is Vue/DOM-free by
// construction (see src/lib/mcp-runtime.ts). Run via `npm run build:mcp-runtime`;
// packages/guano/scripts/prepack.mjs runs it before packing.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./packages/guano/runtime', import.meta.url)),
    emptyOutDir: true,
    // don't copy the SPA's public/ (favicon.ico) into the
    // runtime dir — this build emits only the MCP bundle
    copyPublicDir: false,
    // node runtime, not a browser — keep modern syntax, no polyfills
    target: 'node20',
    // readable output so MCP-server stack traces point at real function names
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./src/lib/mcp-runtime.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'mcp-runtime.mjs',
    },
    // single lib entry with no dynamic imports → Vite emits one inlined file,
    // which is what the published package needs (it can't reach back into src/).
  },
})
