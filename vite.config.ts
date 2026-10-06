import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // the admin SPA lives under /admin/ — its bundles ship at /admin/assets/*,
  // leaving root /assets/* to the exported static site
  base: '/admin/',
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    {
      // dev-only: Vite doesn't redirect the bare base path (it serves a 404
      // hint page instead), but LoginView/SetupView hard-navigate to '/admin'
      // after auth — bounce to '/admin/' so that flow works in dev too
      name: 'redirect-bare-admin',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/admin' || req.url?.startsWith('/admin?')) {
            res.writeHead(302, { Location: '/admin/' + req.url.slice('/admin'.length) })
            return res.end()
          }
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // everything outside /admin belongs to the node server (npm run serve):
    // /api, /media library bytes, and the exported static site at / and
    // /assets/* — so dev / previews the real export, same as production.
    // Object form (changeOrigin defaults to false) preserves the browser's
    // Host header so the server's same-origin check (Origin host === Host)
    // passes in dev — the string shorthand rewrites Host to the target and
    // every mutating request 403s with "cross-origin request rejected".
    proxy: {
      '^(?!/admin(?:/|$))': { target: 'http://localhost:4174' },
    },
  },
})
