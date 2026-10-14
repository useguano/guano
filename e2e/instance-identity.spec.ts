import { test, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
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

/**
 * Run `guano mcp` and read what it says, with stdin held OPEN.
 *
 * It is a long-lived stdio server, so `cli()` cannot drive it: closing stdin
 * ends the transport before the handshake logging has flushed, which reads as
 * silence rather than as the diagnosis under test. Held open for a moment, then
 * killed — what matters is whether it reached `ready (stdio)` at all, since
 * that is exactly what the client sees as "connected".
 */
function mcpProbe(env: Record<string, string>, ms = 2500) {
  return new Promise<{ out: string; exited: number | null }>((done) => {
    const proc = spawn(process.execPath, [CLI, 'mcp'], {
      cwd: REPO,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    let exited: number | null = null
    proc.on('exit', (code) => (exited = code))
    setTimeout(() => {
      proc.kill('SIGKILL')
      done({ out, exited })
    }, ms)
  })
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

test('connect folds every project into ONE entry, and evicts nobody', async () => {
  // Three schemes, two bugs. The fixed key `guano` EVICTED the previous
  // project silently. A key per project fixed that and introduced a nuisance:
  // Claude Desktop launches every entry it has at startup, so each project not
  // running that minute failed its handshake and raised its own "could not
  // connect" alert — the normal state of a machine with several sites on it.
  // One entry carrying a map of projects is the third.
  const srv = await boot('connect-a', 4399)
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'a@example.com', password: 'correct horse battery', name: 'A', projectName: 'Site A' },
  })
  expect(setup.ok()).toBeTruthy()

  const other = join(REPO, '.e2e-identity-other')
  rmSync(other, { recursive: true, force: true })
  mkdirSync(join(other, 'data'), { recursive: true })
  const cfg = join(srv.dataDir, 'client-config.json')
  // a pre-existing entry from an unrelated MCP server, which must survive, and
  // a LEGACY per-project guano entry, which must be folded in rather than left
  // to keep raising its own alert
  writeFileSync(
    cfg,
    JSON.stringify({
      mcpServers: {
        unrelated: { command: 'node' },
        'guano-legacy': {
          command: 'node',
          args: ['x'],
          env: {
            GUANO_URL: 'http://localhost:4180',
            GUANO_TOKEN: 'guano_legacytoken0000',
            GUANO_INSTANCE: 'aaaa1111aaaa1111aaaa1111aaaa1111',
            GUANO_MCP_TARGET: 'main',
          },
        },
      },
    }),
  )

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
    // ONE guano entry, whatever the project count — that is what stops Claude
    // Desktop starting a process per project
    expect(Object.keys(servers).sort()).toEqual(['guano', 'unrelated'])

    const projects = JSON.parse(servers.guano.env.GUANO_PROJECTS)
    // all three: the legacy one folded in, and both of the ones just connected
    expect(Object.keys(projects).sort()).toEqual(['legacy', 'site-a'].concat(
      Object.keys(projects).filter((s) => s !== 'legacy' && s !== 'site-a'),
    ).sort())
    expect(Object.keys(projects)).toHaveLength(3)

    // the legacy entry's token and target survived the fold — losing them
    // would disconnect a project this run never looked at
    expect(projects.legacy.token).toBe('guano_legacytoken0000')
    expect(projects.legacy.target).toBe('main')

    // each project carries its OWN identity, and nobody shares a token
    const health = await (await srv.api.get('/api/health')).json()
    expect(projects['site-a'].instance).toBe(health.instance)
    expect(projects['site-a'].url).toBe(`http://localhost:${srv.port}`)
    const tokens = Object.values(projects).map((p: any) => p.token)
    expect(new Set(tokens).size).toBe(tokens.length)

    // and the local-path primitive is confined by default: `guano mcp` could
    // only warn that this was unset, which is also what the worklist WRITER
    // was bounded by
    expect(servers.guano.env.GUANO_MCP_FILE_ROOT).toBeTruthy()
  } finally {
    rmSync(other, { recursive: true, force: true })
  }
})

test('the MCP client serves when no project is running, instead of failing its handshake', async () => {
  // THE ALERT. `main()` exited 1 whenever it could not reach the instance, so
  // the process died before the MCP handshake and the client could only report
  // "could not connect" — once per project, every time Claude Desktop started,
  // for every project not running that minute. An unreachable instance is the
  // ordinary state of a project you are not working on; it is not a
  // misconfiguration and must not read like one.
  const dead = await mcpProbe({
    GUANO_PROJECTS: JSON.stringify({
      landing: { url: 'http://localhost:59991', token: 'guano_aaaaaaaaaaaaaaaa' },
      shop: { url: 'http://localhost:59992', token: 'guano_bbbbbbbbbbbbbbbb' },
    }),
  })
  // it reached the handshake and stayed up, rather than exiting 1 on the probe
  expect(dead.exited).toBeNull()
  expect(dead.out).toContain('ready (stdio)')
  expect(dead.out).toContain('none of the configured projects is running')
  expect(dead.out).toContain('landing')
  expect(dead.out).toContain('shop')
})

test('the live project is whichever one is running, with nothing configured', async () => {
  // Selection the agent cannot reach: starting a server is a human action it
  // has no way to perform (no shell; its only reach is HTTP to something
  // already up), so "the one that answers" is consent by action and needs no
  // prompt, no dialog and no config. With several configured and one running,
  // that one is the project — which is the whole plug-and-play case.
  const srv = await boot('router-live', 4397)
  const health = await (await srv.api.get('/api/health')).json()
  const out = await mcpProbe({
    GUANO_PROJECTS: JSON.stringify({
      down: { url: 'http://localhost:59993', token: 'guano_cccccccccccccccc' },
      live: { url: `http://localhost:${srv.port}`, token: 'guano_dddddddddddddddd', instance: health.instance },
    }),
  })
  // the dead one is skipped and the running one is chosen, with no
  // GUANO_MCP_PROJECT, no dialog and nothing for the agent to decide
  expect(out.out).toContain('working on "live"')
  expect(out.out).toContain('(down, live)')
  // The handshake is not asserted here: this instance has no admin yet, so the
  // made-up token is PENDING — a real misconfiguration, which still exits
  // loudly. That separation is the point, and the serving half is covered by
  // the test above.
  expect(out.out).toContain('PENDING')
})

test('two running projects are refused by name rather than guessed between', async () => {
  // Guessing is how "which site am I editing" becomes a question nobody can
  // answer from the outside — the bug this whole file exists for, one layer
  // up. A misdirected write is not a smaller version of the right write; it is
  // an edit to someone else's site, reported as success.
  const a = await boot('router-a', 4393)
  const b = await boot('router-b', 4394)
  const ha = await (await a.api.get('/api/health')).json()
  const hb = await (await b.api.get('/api/health')).json()
  const out = await mcpProbe({
    GUANO_PROJECTS: JSON.stringify({
      alpha: { url: `http://localhost:${a.port}`, token: 'guano_eeeeeeeeeeeeeeee', instance: ha.instance },
      beta: { url: `http://localhost:${b.port}`, token: 'guano_ffffffffffffffff', instance: hb.instance },
    }),
  })
  expect(out.out).toContain('2 projects are running')
  expect(out.out).toContain('alpha')
  expect(out.out).toContain('beta')
  expect(out.out).toContain('GUANO_MCP_PROJECT')
  // still serving: an ambiguity is answered by the tool that needs a project,
  // not by killing the client
  expect(out.out).toContain('ready (stdio)')

  // ...and pinning one settles it with no probe at all
  const pinned = await mcpProbe({
    GUANO_PROJECTS: JSON.stringify({
      alpha: { url: `http://localhost:${a.port}`, token: 'guano_eeeeeeeeeeeeeeee', instance: ha.instance },
      beta: { url: `http://localhost:${b.port}`, token: 'guano_ffffffffffffffff', instance: hb.instance },
    }),
    GUANO_MCP_PROJECT: 'beta',
  })
  expect(pinned.out).toContain('pinned to beta')
  expect(pinned.out).toContain('working on "beta"')
})
