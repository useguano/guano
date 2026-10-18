// Which Guano project this MCP process is working on.
//
// ONE Claude Desktop entry, several projects. `guano connect` used to write a
// `guano-<slug>` entry per project, which Claude Desktop then launched all of
// at once — so every project you were not running that minute failed its
// handshake and raised its own "could not connect" alert. A single entry
// carrying a map of projects (GUANO_PROJECTS) has one process, one toolset and
// so one tool list, whatever the project count.
//
// THE RULE THAT MATTERS: the agent must never be the one that decides which
// site it writes to. A node id addresses one tree and a token is minted into
// one data dir, so a misdirected write is not a smaller version of the right
// write — it is an edit to someone else's site, reported as success. So
// selection reads, in order:
//
//   1. GUANO_MCP_PROJECT — pinned in the entry's env. The human edited a config
//      file, which is the one consent channel a prompt-injected agent cannot
//      reach. Never asked, never overridden.
//   2. the sole REACHABLE project — if exactly one of the mapped projects
//      answers /api/health with its own instance id, that is the one. Starting
//      a server is a human action an agent has no way to perform (it has no
//      shell; its only reach is HTTP to something already running), so this is
//      consent by action and needs no prompt. It is also the whole of the
//      plug-and-play case: one local project, nothing configured.
//   3. otherwise REFUSE and name the candidates. Guessing between two running
//      projects is how "which site am I editing" becomes a question nobody can
//      answer from the outside, which is the bug docs/instance.md exists to end.
//
// A reachable project is one whose health answers AND which that answer
// identifies as THIS project: by the `instance` id `connect` baked in, or,
// when either side has no id to compare, by the instance accepting its token.
// That is what stops another project squatting the port from being mistaken
// for this one — the same check `guano mcp` makes before presenting a token.
//
// AN ENTRY ADDRESSES A DATA DIR, NOT A PORT. `dir` is the authority on where a
// local project is, exactly as it is everywhere else in this product; `url` is
// a cached guess that goes stale the first time a port moves. It moved
// constantly once the desktop launcher started pinning a port per project from
// its .env and stopping the server when a tab closed: every dead entry anyone
// reported was a live project at an address the map still remembered wrong.
// `instance.json` is written AFTER listen() resolves, so the port in it is the
// port the server actually got, and reading it costs one local stat.
//
// `url` stays, for remote instances (which have no local dir) and for entries
// written before this — so an old map keeps working and `connect` upgrades it
// in place.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApi } from './api.mjs'

/**
 * Where this project is listening NOW.
 *
 * A `dir` that cannot be read falls back to the cached `url` rather than
 * failing: the dir may be on a volume that is not mounted this minute, and a
 * stale address is still a better answer than none.
 */
export function addressOf(p) {
  const rec = readInstanceRecord(p.dir)
  return rec?.port ? `http://localhost:${rec.port}` : p.url
}

/** `<dataDir>/instance.json`, or null. Sync: it is one small local file, and
 *  every caller is about to make a network request anyway. */
export function readInstanceRecord(dir) {
  if (!dir) return null
  try {
    const rec = JSON.parse(readFileSync(join(dir, 'instance.json'), 'utf8'))
    return rec && typeof rec === 'object' ? rec : null
  } catch {
    return null
  }
}

/** how long a health probe is trusted. Short enough that starting a project is
 *  picked up within a call or two; long enough that a burst of tool calls does
 *  not probe every project every time. Remote instances are a network hop. */
const PROBE_TTL_MS = 5_000

const slugOk = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)

/**
 * Parse GUANO_PROJECTS: `{"<slug>": {url, token, instance?, target?}}`.
 * Anything malformed is dropped rather than thrown — a typo in one entry must
 * not take out the whole client.
 */
export function parseProjects(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    return { projects: {}, error: 'GUANO_PROJECTS is not valid JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { projects: {}, error: 'GUANO_PROJECTS must be an object of {slug: {url, token}}' }
  }
  const projects = {}
  const dropped = []
  for (const [slug, v] of Object.entries(parsed)) {
    const hasUrl = typeof v?.url === 'string' && v.url
    const hasDir = typeof v?.dir === 'string' && v.dir
    // One of the two is enough to address a project: a local entry can carry
    // only `dir`, a remote one only `url`.
    if (!slugOk(slug) || !v || typeof v !== 'object' || (!hasUrl && !hasDir)) {
      dropped.push(slug)
      continue
    }
    projects[slug] = {
      slug,
      dir: hasDir ? v.dir : '',
      url: hasUrl ? v.url.replace(/\/+$/, '') : '',
      token: typeof v.token === 'string' ? v.token : '',
      instance: typeof v.instance === 'string' ? v.instance : '',
      // the per-project write target, which used to be one GUANO_MCP_TARGET for
      // the whole entry. With several projects behind one entry it has to be
      // per project, or pinning Main for a landing page would pin it for a
      // client's live site too.
      target: typeof v.target === 'string' ? v.target : '',
      name: typeof v.name === 'string' ? v.name : '',
    }
  }
  return { projects, ...(dropped.length ? { dropped } : {}) }
}

const short = (id) => (id.length > 8 ? `${id.slice(0, 8)}…` : id)

/**
 * Does the instance on this address accept this project's token?
 *
 * The identity test when either side carries no instance id. "A missing id is
 * never a mismatch" is right for an old SERVER and wrong for an old ENTRY:
 * every entry written before ids existed says :4174, because that was the
 * only default there was, so each one matched whatever project held that port
 * and five dead projects all read as running at one address — the ambiguity
 * the map exists to end, manufactured by the fold.
 *
 * A token is minted into ONE data dir, so an instance that ACCEPTS it is that
 * project, as surely as the id says so. Only a plain 401 is a no. A PENDING
 * token is this instance's token already (the scaffolder mints one before the
 * admin exists, and the first admin binds it), and anything else — 403, a 404
 * from an older build, a 5xx — is not an answer about identity and must not
 * exclude a project that is plainly up.
 */
async function tokenAccepted(api) {
  if (!api.token) return false
  try {
    await api.whoami()
    return true
  } catch (e) {
    return !(e?.status === 401 && !e?.needsSetup)
  }
}

/**
 * Is the instance at this entry's address the project the entry names?
 *
 * Returns `{ok, answered, why, instance}`, not a bare boolean, because the two
 * ways of failing need different advice and the refusal used to give one. A
 * project that is simply not up is fixed by `guano dev`. A project whose
 * ADDRESS answers but whose identity does not check out is a STALE ENTRY, and
 * telling its owner to start a server they are already running is how an
 * afternoon goes: /api/health answers 200 ok, every tool call answers "no
 * configured project is running", and nothing reconciles the two.
 *
 * Shared, because `guano disconnect --stale` decides what to delete on exactly
 * this question and two implementations of it would eventually disagree about
 * which entries are dead.
 */
export async function identifyEntry(p, api = createApi({ base: addressOf(p), token: p.token, instance: p.instance })) {
  const address = addressOf(p)
  // A `dir` that is GONE is proof, with no port involved at all: the project
  // was deleted or moved, and no address will ever be it again. Before this,
  // such an entry could only be disproved by something else answering on its
  // old port — so an entry whose port was simply free was undeletable, and
  // the map could only grow.
  if (p.dir && !existsSync(p.dir)) {
    return {
      ok: false,
      answered: true,
      why: `${p.dir} is gone — the project was deleted or moved`,
      instance: '',
      offline: true,
    }
  }
  const local = readInstanceRecord(p.dir)
  if (local && p.instance && typeof local.id === 'string' && local.id && local.id !== p.instance) {
    return {
      ok: false,
      answered: true,
      why: `${p.dir} now holds a different project (instance ${short(local.id)}, expected ${short(p.instance)})`,
      instance: local.id,
      offline: true,
    }
  }
  const h = await api.health()
  const got = h && typeof h.instance === 'string' ? h.instance : ''
  const answered = !!h
  if (!answered) return { ok: false, answered: false, why: 'nothing is listening there', instance: '' }
  const want = p.instance
  // Both sides know an id: compare them, which costs no extra request.
  // Either side does not: ask the token instead of waving it through.
  if (want && got) {
    return got === want
      ? { ok: true, answered: true, why: '', instance: got }
      : {
          ok: false,
          answered: true,
          why: `a different project holds ${address} (instance ${short(got)}, expected ${short(want)})`,
          instance: got,
        }
  }
  if (await tokenAccepted(api)) return { ok: true, answered: true, why: '', instance: got }
  return {
    ok: false,
    answered: true,
    why:
      `${address} answered${got ? ` as instance ${short(got)}` : ''} but refused this entry's token, ` +
      'and the entry carries no instance id to check against — it is stale',
    instance: got,
  }
}

/**
 * The router. Holds one `createApi` client per mapped project and resolves
 * which is live; `current()` is what the toolset's api wrapper dispatches to.
 */
export function createProjectRouter({
  raw = process.env.GUANO_PROJECTS,
  pinned = (process.env.GUANO_MCP_PROJECT ?? '').trim(),
  now = () => Date.now(),
} = {}) {
  const { projects, error, dropped } = parseProjects(raw)
  const slugs = Object.keys(projects)
  const clients = new Map()
  const probes = new Map() // slug -> {at, ok}
  let active = null

  // Keyed by the address it was built for: a project that restarts on a new
  // port must not keep being probed at the old one, which is the whole point
  // of addressing a dir rather than a url.
  const clientFor = (slug) => {
    const p = projects[slug]
    const base = addressOf(p)
    const cached = clients.get(slug)
    if (cached && cached.base === base) return cached.api
    const api = createApi({ base, token: p.token, instance: p.instance })
    clients.set(slug, { base, api })
    return api
  }

  /**
   * Does this project answer, and is it the project we were connected to?
   * `identifyEntry` is the shared implementation — see its comment.
   */
  async function probeProject(slug) {
    const cached = probes.get(slug)
    if (cached && now() - cached.at < PROBE_TTL_MS) return cached
    const probe = { at: now(), ...(await identifyEntry(projects[slug], clientFor(slug))) }
    probes.set(slug, probe)
    return probe
  }

  /**
   * Resolve the live project. Returns {slug} or {error, candidates}.
   * Never throws: a dormant client must still complete the MCP handshake, or
   * the alert this whole design removes comes straight back.
   */
  async function resolve() {
    if (error) return { error }
    if (!slugs.length) return { error: 'no projects are configured — run `guano connect`' }
    if (pinned) {
      if (!projects[pinned]) {
        return {
          error:
            `GUANO_MCP_PROJECT is "${pinned}", which is not one of the configured projects ` +
            `(${slugs.join(', ')}). Fix it in the MCP config, or run \`guano connect\` in that project.`,
        }
      }
      active = pinned
      return { slug: pinned, pinned: true }
    }
    if (slugs.length === 1) {
      active = slugs[0]
      return { slug: slugs[0], sole: true }
    }
    const up = []
    // the ones whose ADDRESS answered but whose identity did not check out —
    // a server IS running, so "start one" is the wrong thing to be told
    const stale = []
    for (const slug of slugs) {
      const probe = await probeProject(slug)
      if (probe.ok) up.push(slug)
      else if (probe.answered) stale.push(`${slug} — ${probe.why}`)
    }
    if (up.length === 1) {
      active = up[0]
      return { slug: up[0], sole: true }
    }
    active = null
    if (!up.length) {
      if (stale.length) {
        return {
          error:
            'a Guano server is running, but it is not any of the configured projects:\n  ' +
            stale.join('\n  ') +
            '\nReconnect the project you are working on: quit Claude (it rewrites its config on ' +
            'quit), run `guano connect` in that project\'s folder, then reopen Claude. ' +
            '`guano disconnect --stale` clears entries that can no longer work.',
          candidates: slugs,
        }
      }
      return {
        error:
          `none of the configured projects is running (${slugs.join(', ')}). Start one with ` +
          '`guano dev` in its folder, then try again.',
        candidates: slugs,
      }
    }
    return {
      error:
        `${up.length} projects are running (${up.join(', ')}), so which one to edit is ambiguous ` +
        '— and guessing would mean editing the wrong site and reporting success. Stop the ones ' +
        'you are not working on, or pin one with GUANO_MCP_PROJECT in the MCP config.',
      candidates: up,
    }
  }

  return {
    /** the resolved project's client, or throws the refusal as an Error */
    async current() {
      const r = await resolve()
      if (r.error) {
        const e = new Error(r.error)
        e.noProject = true
        e.candidates = r.candidates ?? []
        throw e
      }
      return { ...projects[r.slug], api: clientFor(r.slug), pinned: !!r.pinned }
    },
    resolve,
    list: () => slugs.map((s) => ({ slug: s, url: addressOf(projects[s]), name: projects[s].name })),
    /** the active project's key, for invalidating per-project session state */
    activeKey: () => active,
    /** this project's pinned write target, which is per project rather than one
     *  GUANO_MCP_TARGET for the whole entry */
    targetFor: (slug) => projects[slug]?.target ?? '',
    configured: () => ({ count: slugs.length, pinned: pinned || null, dropped: dropped ?? [] }),
    has: (slug) => !!projects[slug],
  }
}
