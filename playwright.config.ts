import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

// Smoke-only e2e. The server is started on an isolated data dir (GUANO_DATA_DIR)
// and a non-default port so it never touches real dev data or a running
// `npm run serve`. Requires a prior `npm run build` (the SPA is served from
// dist/) — CI runs the build gate first.
const PORT = 4188
// absolute: the exporter's write-path backstop rejects a relative data dir
const DATA_DIR = resolve(import.meta.dirname, '.e2e-data')
// point GUANO_E2E_SERVER at a packaged install's server entry
// (…/node_modules/guano/server/index.mjs) to run the suite against the
// packed tarball instead of the repo layout
const SERVER = process.env.GUANO_E2E_SERVER ?? 'server/index.mjs'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // wipe the throwaway data dir, then serve the built SPA + API on an
    // isolated port/data dir
    command: `node -e "require('fs').rmSync(process.env.GUANO_DATA_DIR,{recursive:true,force:true})" && node ${SERVER}`,
    // TRUST_PROXY so a spec can present its own client address through
    // X-Forwarded-For. The public form endpoint's per-IP limit (5/minute) is a
    // real guard worth testing, and without this every request in the suite
    // shares one socket address — so the limiter, not the endpoint, is what a
    // forms spec would end up measuring. Harmless for every other spec: with
    // no XFF header, clientIp falls back to the socket address exactly as before.
    // LOG_LEVEL=warn silences the per-request access line. `stdout: 'pipe'`
    // means every one of them would print between the test rows, which buries
    // the result; warnings and errors still come through, which is what a
    // failing run needs. Drop this to `info` while debugging a spec.
    env: {
      GUANO_DATA_DIR: DATA_DIR,
      PORT: String(PORT),
      TRUST_PROXY: '1',
      LOG_LEVEL: 'warn',
    },
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
