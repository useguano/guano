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
// A reachable project is one whose health answers AND whose `instance` matches
// the id `connect` baked in. That is what stops another project squatting the
// port from being mistaken for this one — the same check `guano mcp` makes
// before presenting a token.
import { createApi } from './api.mjs'

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
    if (!slugOk(slug) || !v || typeof v !== 'object' || typeof v.url !== 'string' || !v.url) {
      dropped.push(slug)
      continue
    }
    projects[slug] = {
      slug,
      url: v.url.replace(/\/+$/, ''),
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

  const clientFor = (slug) => {
    if (!clients.has(slug)) {
      const p = projects[slug]
      clients.set(slug, createApi({ base: p.url, token: p.token, instance: p.instance }))
    }
    return clients.get(slug)
  }

  /** does this project answer, and is it the project we were connected to? */
  async function reachable(slug) {
    const cached = probes.get(slug)
    if (cached && now() - cached.at < PROBE_TTL_MS) return cached.ok
    const h = await clientFor(slug).health()
    const want = projects[slug].instance
    // A missing `instance` on either side is never a mismatch: an older server
    // does not report one, and an entry written before ids existed carries
    // none. Refusing those would break setups that work.
    const ok = !!h && (!want || typeof h.instance !== 'string' || !h.instance || h.instance === want)
    probes.set(slug, { at: now(), ok })
    return ok
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
    for (const slug of slugs) if (await reachable(slug)) up.push(slug)
    if (up.length === 1) {
      active = up[0]
      return { slug: up[0], sole: true }
    }
    active = null
    if (!up.length) {
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
    list: () => slugs.map((s) => ({ slug: s, url: projects[s].url, name: projects[s].name })),
    /** the active project's key, for invalidating per-project session state */
    activeKey: () => active,
    /** this project's pinned write target, which is per project rather than one
     *  GUANO_MCP_TARGET for the whole entry */
    targetFor: (slug) => projects[slug]?.target ?? '',
    configured: () => ({ count: slugs.length, pinned: pinned || null, dropped: dropped ?? [] }),
    has: (slug) => !!projects[slug],
  }
}
