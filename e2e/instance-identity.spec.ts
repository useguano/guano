import { test, expect, request as pwRequest } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseProjects } from '../packages/superbird/mcp/projects.mjs'
import { boot, bootUnpinned, exitOf, instances } from './fixtures/server'

// Instance identity: which Superbird project a port is answering for.
//
// The bug this guards is worth stating in full, because every symptom of it
// points somewhere else. Several projects on one machine all default to port
// 4174, so the port names nothing — whichever instance boots first owns it. An
// API token is minted into ONE data dir. So a client configured against
// project A, reaching project B because B won the race, is answered with a 401
// that is indistinguishable from a revoked token; `superbird mcp` then exits
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
const CLI = join(REPO, 'packages', 'superbird', 'bin', 'superbird.js')

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
 * Run `superbird mcp` and read what it says, with stdin held OPEN.
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
    SUPERBIRD_URL: `http://localhost:${srv.port}`,
    SUPERBIRD_INSTANCE: 'f'.repeat(32),
    SUPERBIRD_TOKEN: 'superbird_whatever',
  })
  expect(wrong.code).toBe(1)
  expect(wrong.out).toContain('DIFFERENT Superbird project')
  expect(wrong.out).toContain('ffffffff')
  expect(wrong.out).toContain(real.slice(0, 8))
  expect(wrong.out).toContain('superbird connect')

  // A 401 before the first admin exists is a 401 for an entirely different
  // reason: `superbird connect` mints a PENDING token that the first account binds.
  // Telling that user to re-run connect is the one thing that cannot help.
  const pending = cli(['mcp'], {
    SUPERBIRD_URL: `http://localhost:${srv.port}`,
    SUPERBIRD_INSTANCE: '',
    SUPERBIRD_TOKEN: 'superbird_whatever',
  })
  expect(pending.code).toBe(1)
  expect(pending.out).toContain('still PENDING')
  expect(pending.out).not.toContain('DIFFERENT Superbird project')

  // With an admin in place the same bad token IS just a bad token, and an
  // entry written before instance ids existed carries none — so the 401 is all
  // there is to go on and it must still say what it most likely means.
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'm@example.com', password: 'correct horse battery', name: 'M', projectName: 'Mismatch' },
  })
  expect(setup.ok()).toBeTruthy()
  const legacy = cli(['mcp'], {
    SUPERBIRD_URL: `http://localhost:${srv.port}`,
    SUPERBIRD_INSTANCE: '',
    SUPERBIRD_TOKEN: 'superbird_whatever',
  })
  expect(legacy.code).toBe(1)
  expect(legacy.out).toContain('does not recognise this token')
  expect(legacy.out).toContain('DIFFERENT Superbird project')
  expect(legacy.out).not.toContain('still PENDING')
})

test('connect folds every project into ONE entry, and evicts nobody', async () => {
  // Three schemes, two bugs. The fixed key `superbird` EVICTED the previous
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
  // a LEGACY per-project superbird entry, which must be folded in rather than left
  // to keep raising its own alert
  writeFileSync(
    cfg,
    JSON.stringify({
      mcpServers: {
        unrelated: { command: 'node' },
        'superbird-legacy': {
          command: 'node',
          args: ['x'],
          env: {
            SUPERBIRD_URL: 'http://localhost:4180',
            SUPERBIRD_TOKEN: 'superbird_legacytoken0000',
            SUPERBIRD_INSTANCE: 'aaaa1111aaaa1111aaaa1111aaaa1111',
            SUPERBIRD_MCP_TARGET: 'main',
          },
        },
      },
    }),
  )

  try {
    const first = cli(['connect', '--yes', '--config', cfg], { SUPERBIRD_DATA_DIR: srv.dataDir })
    expect(first.code).toBe(0)

    // the second project has never run, so its entry is minted offline — the
    // scaffolder's path, and the one that used to clobber the first
    const second = cli(['connect', '--yes', '--offline', '--config', cfg], {
      SUPERBIRD_DATA_DIR: join(other, 'data'),
    })
    expect(second.code).toBe(0)

    const servers = JSON.parse(readFileSync(cfg, 'utf8')).mcpServers
    // ONE superbird entry, whatever the project count — that is what stops Claude
    // Desktop starting a process per project
    expect(Object.keys(servers).sort()).toEqual(['superbird', 'unrelated'])

    const projects = JSON.parse(servers.superbird.env.SUPERBIRD_PROJECTS)
    // all three: the legacy one folded in, and both of the ones just connected
    expect(Object.keys(projects).sort()).toEqual(['legacy', 'site-a'].concat(
      Object.keys(projects).filter((s) => s !== 'legacy' && s !== 'site-a'),
    ).sort())
    expect(Object.keys(projects)).toHaveLength(3)

    // the legacy entry's token and target survived the fold — losing them
    // would disconnect a project this run never looked at
    expect(projects.legacy.token).toBe('superbird_legacytoken0000')
    expect(projects.legacy.target).toBe('main')

    // each project carries its OWN identity, and nobody shares a token
    const health = await (await srv.api.get('/api/health')).json()
    expect(projects['site-a'].instance).toBe(health.instance)
    expect(projects['site-a'].url).toBe(`http://localhost:${srv.port}`)
    const tokens = Object.values(projects).map((p: any) => p.token)
    expect(new Set(tokens).size).toBe(tokens.length)

    // and the local-path primitive is confined by default: `superbird mcp` could
    // only warn that this was unset, which is also what the worklist WRITER
    // was bounded by
    expect(servers.superbird.env.SUPERBIRD_MCP_FILE_ROOT).toBeTruthy()
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
    SUPERBIRD_PROJECTS: JSON.stringify({
      landing: { url: 'http://localhost:59991', token: 'superbird_aaaaaaaaaaaaaaaa' },
      shop: { url: 'http://localhost:59992', token: 'superbird_bbbbbbbbbbbbbbbb' },
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
    SUPERBIRD_PROJECTS: JSON.stringify({
      down: { url: 'http://localhost:59993', token: 'superbird_cccccccccccccccc' },
      live: { url: `http://localhost:${srv.port}`, token: 'superbird_dddddddddddddddd', instance: health.instance },
    }),
  })
  // the dead one is skipped and the running one is chosen, with no
  // SUPERBIRD_MCP_PROJECT, no dialog and nothing for the agent to decide
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
    SUPERBIRD_PROJECTS: JSON.stringify({
      alpha: { url: `http://localhost:${a.port}`, token: 'superbird_eeeeeeeeeeeeeeee', instance: ha.instance },
      beta: { url: `http://localhost:${b.port}`, token: 'superbird_ffffffffffffffff', instance: hb.instance },
    }),
  })
  expect(out.out).toContain('2 projects are running')
  expect(out.out).toContain('alpha')
  expect(out.out).toContain('beta')
  // `superbird use` replaced the hand-edit-the-config hint (919c0fc); the refusal names
  // the command that fixes it, which is the whole point of the pin
  expect(out.out).toContain('superbird use')
  // still serving: an ambiguity is answered by the tool that needs a project,
  // not by killing the client
  expect(out.out).toContain('ready (stdio)')

  // ...and pinning one settles it with no probe at all
  const pinned = await mcpProbe({
    SUPERBIRD_PROJECTS: JSON.stringify({
      alpha: { url: `http://localhost:${a.port}`, token: 'superbird_eeeeeeeeeeeeeeee', instance: ha.instance },
      beta: { url: `http://localhost:${b.port}`, token: 'superbird_ffffffffffffffff', instance: hb.instance },
    }),
    SUPERBIRD_MCP_PROJECT: 'beta',
  })
  expect(pinned.out).toContain('pinned to beta')
  expect(pinned.out).toContain('working on "beta"')
})

test('a remote instance is connected by approving a code in its own editor', async () => {
  // The local flow proves authority by writing a nonce into the data dir, on a
  // route that is loopback-only besides — neither of which another machine can
  // do, so a VPS could not be connected at all. The remote stand-in for "I
  // hold the data dir" is "I can sign in to this instance's /admin as an
  // admin", which is what the device flow asks for.
  const srv = await boot('device', 4391)
  const setup = await srv.api.post('/api/auth/setup', {
    data: {
      email: 'owner@example.com',
      password: 'correct horse battery',
      name: 'Owner',
      projectName: 'Remote Site',
    },
  })
  expect(setup.ok()).toBeTruthy()

  // 1. the CLI's side needs no credential — that is the point of the flow
  const started = await (
    await srv.api.post('/api/auth/device', { data: { name: 'Claude Desktop' } })
  ).json()
  expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  expect(started.deviceCode).toMatch(/^[0-9a-f]{64}$/)
  expect(started.verifyPath).toContain('/admin/authorize?code=')

  // 2. before approval there is nothing to collect
  expect((await (await srv.api.post('/api/auth/device/token', {
    data: { deviceCode: started.deviceCode },
  })).json()).status).toBe('pending')

  // 3. the approval screen is admin + SESSION only. An API token must never be
  //    able to approve one: that would let an agent authorize another client to
  //    the instance it is already talking to.
  const anon = await pwRequest.newContext({ baseURL: `http://localhost:${srv.port}` })
  expect((await anon.get(`/api/auth/device/${started.userCode}`)).status()).toBe(401)

  // 4. the admin approves, choosing what it may do — the same two switches the
  //    local flow takes as --main/--publish, asked here in a UI instead
  const approved = await srv.api.post(`/api/auth/device/${started.userCode}/approve`, {
    data: { policy: { allowMainWrites: true } },
  })
  expect(approved.ok()).toBeTruthy()

  // 5. the CLI collects it, ONCE: the record is spent as it is handed over
  await new Promise((r) => setTimeout(r, 2200))
  const granted = await (
    await srv.api.post('/api/auth/device/token', { data: { deviceCode: started.deviceCode } })
  ).json()
  expect(granted.status).toBe('granted')
  expect(granted.token).toMatch(/^superbird_[0-9a-f]+$/)
  expect(granted.agentPolicy.allowMainWrites).toBe(true)
  expect(granted.projectName).toBe('Remote Site')
  expect(granted.instance).toBe((await (await srv.api.get('/api/health')).json()).instance)

  const spent = await srv.api.post('/api/auth/device/token', {
    data: { deviceCode: started.deviceCode },
  })
  expect(spent.status()).toBe(404)

  // 6. and the token it handed over actually works on that instance
  const me = await anon.get('/api/auth/me', {
    headers: { authorization: `Bearer ${granted.token}` },
  })
  expect(me.ok()).toBeTruthy()
  await anon.dispose()
})

test('remote connect refuses plain http and an unusable token', async () => {
  // The token travels on every request; over plain http anything on the path
  // reads it. localhost is exempted because that is a loopback, not a network.
  const http = cli(['connect', '--url', 'http://example.com', '--token', 'superbird_' + '0'.repeat(32)])
  expect(http.code).toBe(1)
  expect(http.out).toContain('must be an https: address')

  const srv = await boot('remote-refuse', 4392)
  const bad = cli(['connect', '--url', `http://localhost:${srv.port}`, '--token', 'not-a-token'])
  expect(bad.code).toBe(1)
  expect(bad.out).toContain('does not look like a Superbird API token')
})

test('a malformed client config is refused, never rewritten', async () => {
  // The config holds a bearer token for every project connected on this
  // machine — and every OTHER MCP server the user has. A parse failure used to
  // fall through to `{...null, mcpServers}`, replacing the lot with one entry.
  // One trailing comma gets you there.
  const dir = mkdtempSync(join(tmpdir(), 'superbird-cfg-'))
  try {
    const cfg = join(dir, 'claude_code_config.json')
    const malformed = '{\n  "mcpServers": {\n    "other": { "command": "node" },\n  }\n}\n'
    writeFileSync(cfg, malformed)

    // --offline: no server needed, and it still reaches the config writer
    const env = { SUPERBIRD_DATA_DIR: join(dir, 'data') }
    const res = cli(['connect', '--yes', '--offline', '--config', cfg], env)
    expect(res.code).toBe(1)
    expect(res.out).toContain('is not valid JSON')
    // byte-identical: the other server they had configured is still there
    expect(readFileSync(cfg, 'utf8')).toBe(malformed)

    // --print writes nothing, so it still works — it is the escape hatch the
    // refusal points at
    const printed = cli(['connect', '--yes', '--offline', '--print', '--config', cfg], env)
    expect(printed.out).toContain('mcpServers')
    expect(readFileSync(cfg, 'utf8')).toBe(malformed)

    // ...and a config that DOES parse is written, privately
    const good = join(dir, 'good.json')
    writeFileSync(good, '{"mcpServers":{"other":{"command":"node"}}}')
    const ok = cli(['connect', '--yes', '--offline', '--config', good], env)
    expect(ok.code).toBe(0)
    const back = JSON.parse(readFileSync(good, 'utf8'))
    expect(back.mcpServers.other).toBeTruthy()
    expect(back.mcpServers.superbird).toBeTruthy()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The AI panel's own entry. `--embedded` is the ONE signal `superbird mcp` reads
// to stop asking which project and which branch, and `connect` is the only
// thing allowed to write it — the launcher never writes an MCP config itself.
test('the editor\u2019s entry carries SUPERBIRD_MCP_EMBEDDED and the branch it has open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superbird-emb-'))
  try {
    const cfg = join(dir, 'panel.json')
    const env = { SUPERBIRD_DATA_DIR: join(dir, 'data') }
    const draft = 'b1f0c2d3-4e5f-4a6b-8c9d-0e1f2a3b4c5d'

    // --yes leaves the policy alone, so Main is NOT allowed: the target is
    // written anyway, because the editor said it, not the agent
    const res = cli(
      ['connect', '--yes', '--offline', '--config', cfg, '--embedded', '--target', draft],
      env,
    )
    expect(res.code).toBe(0)

    const entry = JSON.parse(readFileSync(cfg, 'utf8')).mcpServers.superbird
    expect(entry.env.SUPERBIRD_MCP_EMBEDDED).toBe('1')
    const { projects } = parseProjects(entry.env.SUPERBIRD_PROJECTS)
    const only = Object.values(projects)[0] as { target: string }
    expect(only.target).toBe(draft)

    // and a re-run on the other branch moves it, in place
    const back = cli(
      ['connect', '--yes', '--offline', '--config', cfg, '--embedded', '--target', 'main'],
      env,
    )
    expect(back.code).toBe(0)
    const after = parseProjects(
      JSON.parse(readFileSync(cfg, 'utf8')).mcpServers.superbird.env.SUPERBIRD_PROJECTS,
    ).projects
    expect((Object.values(after)[0] as { target: string }).target).toBe('main')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--embedded without --config is refused, and so is a target that is neither', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superbird-emb2-'))
  try {
    const env = { SUPERBIRD_DATA_DIR: join(dir, 'data') }
    // the shared Claude configs belong to an outside client; marking one
    // embedded would leave it unable to say which project it meant
    const bare = cli(['connect', '--yes', '--offline', '--embedded'], env)
    expect(bare.code).toBe(1)
    expect(bare.out).toContain('--embedded needs --config')

    const cfg = join(dir, 'panel.json')
    const bad = cli(
      ['connect', '--yes', '--offline', '--config', cfg, '--embedded', '--target', 'new:Draft'],
      env,
    )
    expect(bad.code).toBe(1)
    expect(bad.out).toContain('--target must be "main" or a draft id')

    // neither refusal wrote a byte
    expect(() => readFileSync(cfg, 'utf8')).toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('superbird mcp ignores a .env in whatever directory the client spawned it from', async () => {
  // An MCP client spawns `superbird mcp` with its own cwd — for Claude Code, the
  // directory the session was opened in. Loading .env there let any cloned repo
  // set SUPERBIRD_MCP_TARGET=main (skipping the set_target dialog) or
  // SUPERBIRD_MCP_PROJECT (pinning which site the tools write to).
  const dir = mkdtempSync(join(tmpdir(), 'superbird-env-'))
  try {
    writeFileSync(join(dir, '.env'), 'SUPERBIRD_MCP_TARGET=main\nSUPERBIRD_MCP_PROJECT=theirs\n')
    const out = await new Promise<string>((done) => {
      const proc = spawn(process.execPath, [CLI, 'mcp'], {
        cwd: dir,
        env: { ...process.env, SUPERBIRD_PROJECTS: JSON.stringify({ mine: { url: 'http://localhost:9', token: 'superbird_x' } }) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let seen = ''
      proc.stdout.on('data', (d) => (seen += d))
      proc.stderr.on('data', (d) => (seen += d))
      setTimeout(() => {
        proc.kill('SIGKILL')
        done(seen)
      }, 2000)
    })
    // it works on the project the ENTRY names, and says nothing about "theirs"
    expect(out).toContain('ready (stdio)')
    expect(out).not.toContain('theirs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
