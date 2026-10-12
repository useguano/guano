import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { boot, bootUnpinned, exitOf, instances } from './fixtures/server'

// Instance identity: which Guano project a port is answering for.
//
// The bug this guards is worth stating in full, because every symptom of it
// points somewhere else. Several projects on one machine all default to port
// 4174, so the port names nothing — whichever instance boots first owns it. An
// API token is minted into ONE data dir. So a client configured against
// project A, reaching project B because B won the race, is answered with a 401
// that is indistinguishable from a revoked token; `guano mcp` then exits
// before the MCP handshake, and the only thing the user is ever told is
// "MCP server not connected" while the token sits there, valid, in a config
// file pointing at a live and healthy server.
//
// Three properties close it: a project has a stable opaque id it reports on
// /api/health, it remembers the port it landed on and reclaims it, and the MCP
// client compares the two before presenting its token.
//
// Every test spawns its OWN server on its own data dir, so this file never
// touches the shared webServer or its first-run state — the same exemption
// lifecycle and auth-kdf have from the "must sort after smoke" rule.

const REPO = resolve(import.meta.dirname, '..')
const CLI = join(REPO, 'packages', 'guano', 'bin', 'guano.js')

test.afterEach(() => {
  for (const i of instances) i.stop()
  instances.length = 0
})

/** run the CLI and capture everything, whatever the exit code */
function cli(args: string[], env: Record<string, string> = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      input: '',
    })
    return { code: 0, out }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

test('a project mints a stable id, reports it on health, and keeps it across a restart', async () => {
  const srv = await boot('identity', 4395)
  const health = await (await srv.api.get('/api/health')).json()

  // opaque and present — this is what a client compares against
  expect(health.instance).toMatch(/^[0-9a-f]{32}$/)
  // the one unauthenticated route must still disclose no path and no name
  expect(JSON.stringify(health)).not.toContain(srv.dataDir)
  expect(health).not.toHaveProperty('name')

  const first = health.instance
  srv.proc.kill('SIGTERM')
  expect(await exitOf(srv.proc)).toBe(0)

  // same data dir, second process: the id is the dir's, not the process's
  const again = await boot('identity-again', 4395, {
    prepare: (dir) => {
      writeFileSync(join(dir, 'instance.json'), readFileSync(join(srv.dataDir, 'instance.json')))
    },
  })
  expect((await (await again.api.get('/api/health')).json()).instance).toBe(first)
})

test('an unpinned project remembers the port it landed on and reclaims it', async () => {
  // Two projects, neither given a PORT, so both want the 4174 default and the
  // second one walks. The walker's address is the thing at stake: before this
  // it was re-decided on every boot, so a client configured for it broke as
  // soon as the two started in a different order.
  const dirA = join(REPO, '.e2e-identity-a')
  const dirB = join(REPO, '.e2e-identity-b')
  for (const d of [dirA, dirB]) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
  }
  try {
    const a = await bootUnpinned(dirA)
    const b = await bootUnpinned(dirB)
    expect(b.port).not.toBe(a.port)
    expect(b.out()).toContain('WAS BUSY')

    const walked = b.port
    expect(JSON.parse(readFileSync(join(dirB, 'instance.json'), 'utf8')).port).toBe(walked)

    // B restarts while A still holds the default: it must come back on its OWN
    // port rather than re-walking to wherever happens to be free today.
    b.proc.kill('SIGTERM')
    expect(await exitOf(b.proc)).toBe(0)
    const again = await bootUnpinned(dirB)
    expect(again.port).toBe(walked)
    expect(again.out()).not.toContain('WAS BUSY') // it asked for its own port and got it
  } finally {
    for (const d of [dirA, dirB]) rmSync(d, { recursive: true, force: true })
  }
})

test('the MCP server refuses a different project instead of failing with a bare 401', async () => {
  const srv = await boot('mismatch', 4397)
  const real = (await (await srv.api.get('/api/health')).json()).instance

  // A client connected to some OTHER project, now reaching this one. The
  // refusal must name both ids: "not connected" is what this replaces.
  const wrong = cli(['mcp'], {
    GUANO_URL: `http://localhost:${srv.port}`,
    GUANO_INSTANCE: 'f'.repeat(32),
    GUANO_TOKEN: 'guano_whatever',
  })
  expect(wrong.code).toBe(1)
  expect(wrong.out).toContain('DIFFERENT Guano project')
  expect(wrong.out).toContain('ffffffff')
  expect(wrong.out).toContain(real.slice(0, 8))
  expect(wrong.out).toContain('guano connect')

  // A 401 before the first admin exists is a 401 for an entirely different
  // reason: `guano connect` mints a PENDING token that the first account binds.
  // Telling that user to re-run connect is the one thing that cannot help.
  const pending = cli(['mcp'], {
    GUANO_URL: `http://localhost:${srv.port}`,
    GUANO_INSTANCE: '',
    GUANO_TOKEN: 'guano_whatever',
  })
  expect(pending.code).toBe(1)
  expect(pending.out).toContain('still PENDING')
  expect(pending.out).not.toContain('DIFFERENT Guano project')

  // With an admin in place the same bad token IS just a bad token, and an
  // entry written before instance ids existed carries none — so the 401 is all
  // there is to go on and it must still say what it most likely means.
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'm@example.com', password: 'correct horse battery', name: 'M', projectName: 'Mismatch' },
  })
  expect(setup.ok()).toBeTruthy()
  const legacy = cli(['mcp'], {
    GUANO_URL: `http://localhost:${srv.port}`,
    GUANO_INSTANCE: '',
    GUANO_TOKEN: 'guano_whatever',
  })
  expect(legacy.code).toBe(1)
  expect(legacy.out).toContain('does not recognise this token')
  expect(legacy.out).toContain('DIFFERENT Guano project')
  expect(legacy.out).not.toContain('still PENDING')
})

test('connect writes one entry per project, and a second project evicts nobody', async () => {
  // The eviction was silent: `connect` wrote the fixed key `guano`, so the
  // second project overwrote the first project's entry and the only evidence
  // was that Claude had stopped reaching a site nobody had touched.
  const srv = await boot('connect-a', 4399)
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'a@example.com', password: 'correct horse battery', name: 'A', projectName: 'Site A' },
  })
  expect(setup.ok()).toBeTruthy()

  const other = join(REPO, '.e2e-identity-other')
  rmSync(other, { recursive: true, force: true })
  mkdirSync(join(other, 'data'), { recursive: true })
  const cfg = join(srv.dataDir, 'client-config.json')
  // a pre-existing entry from an unrelated MCP server, which must survive
  writeFileSync(cfg, JSON.stringify({ mcpServers: { unrelated: { command: 'node' } } }))

  try {
    const first = cli(['connect', '--yes', '--config', cfg], { GUANO_DATA_DIR: srv.dataDir })
    expect(first.code).toBe(0)

    // the second project has never run, so its entry is minted offline — the
    // scaffolder's path, and the one that used to clobber the first
    const second = cli(['connect', '--yes', '--offline', '--config', cfg], {
      GUANO_DATA_DIR: join(other, 'data'),
    })
    expect(second.code).toBe(0)

    const servers = JSON.parse(readFileSync(cfg, 'utf8')).mcpServers
    const keys = Object.keys(servers).sort()
    expect(keys).toContain('unrelated')
    expect(keys.filter((k) => k.startsWith('guano'))).toHaveLength(2)

    // each entry carries its own project's identity, and the first one's
    // token is untouched
    const a = servers['guano-site-a']
    expect(a.env.GUANO_INSTANCE).toBe((await (await srv.api.get('/api/health')).json()).instance)
    expect(a.env.GUANO_URL).toBe(`http://localhost:${srv.port}`)
    const b = keys.find((k) => k.startsWith('guano') && k !== 'guano-site-a')!
    expect(servers[b].env.GUANO_TOKEN).not.toBe(a.env.GUANO_TOKEN)
  } finally {
    rmSync(other, { recursive: true, force: true })
  }
})
