// Agent write policy — the server-side answer to "the agent said a human
// approved it".
//
// Every human-consent gate in the MCP tools (`chosenByUser`, `acknowledgeMain`,
// `forcePurge`) is a boolean the AGENT itself passes, so an agent following a
// prompt-injected instruction — from a comment, page content, an entry value —
// can set them all to true and be believed. These switches are the real
// boundary: they live in the data dir, only a browser SESSION can change them
// (never a token), and they gate requests authenticated by a `guano_` bearer.
//
// Everything is OFF by default. With the defaults an agent works inside a
// draft, cannot publish, and cannot write custom code — so the worst a
// successful injection achieves is a bad draft that a human reviews before it
// ever reaches Main or the live site.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, writeAtomic } from './util.mjs'

const POLICY_FILE = join(DATA_DIR, 'agent-policy.json')

const DEFAULTS = {
  /** may a token write guano-project:main (and its merge base) directly? */
  allowMainWrites: false,
  /** may a token POST /api/published (ship to the live site)? */
  allowPublish: false,
  /** may a token change custom head/body code — raw <script> on every page? */
  allowCustomCode: false,
  /**
   * May a token READ form submissions?
   *
   * These are site visitors' names, email addresses and messages — other
   * people's personal data, held on the operator's server. An injected agent
   * with read access could exfiltrate the whole list through any write it can
   * make (a page's content, a comment, a draft nobody reviews closely). Off by
   * default; a human turns it on when they actually want an agent triaging
   * leads. No switch ever allows DELETING one.
   */
  allowFormSubmissions: false,
}

/** the policy, defaults filled in. Never throws — a missing/corrupt file is
 *  the safe all-off default. */
export async function readAgentPolicy() {
  let parsed = null
  try {
    parsed = JSON.parse(await readFile(POLICY_FILE, 'utf8'))
  } catch {
    /* absent or corrupt — fall through to defaults */
  }
  const out = { ...DEFAULTS }
  if (parsed && typeof parsed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k]
    }
  }
  return out
}

/** merge a patch of known boolean flags and persist (0600 via writeAtomic) */
export async function writeAgentPolicy(patch) {
  const cfg = await readAgentPolicy()
  if (patch && typeof patch === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof patch[k] === 'boolean') cfg[k] = patch[k]
    }
  }
  await writeAtomic(POLICY_FILE, JSON.stringify(cfg))
  return cfg
}

/**
 * Every place a project blob can carry raw script to the published site, as
 * `label → code` pairs. `settings.customCode.head` is injected into every
 * exported <head>; each page's `customCode.head`/`body` becomes a <script> tag
 * on that page (server/export.mjs). Both are real XSS-on-the-live-origin
 * vectors, so both are diffed.
 */
function codeSurface(project) {
  const out = new Map()
  if (!project || typeof project !== 'object') return out
  out.set('settings.customCode.head', String(project.settings?.customCode?.head ?? ''))
  out.set('settings.customCode.body', String(project.settings?.customCode?.body ?? ''))
  if (Array.isArray(project.pages)) {
    for (const page of project.pages) {
      if (!page || typeof page.id !== 'string') continue
      out.set(`page[${page.id}].customCode.head`, String(page.customCode?.head ?? ''))
      out.set(`page[${page.id}].customCode.body`, String(page.customCode?.body ?? ''))
      collectCodeNodes(page.elements, `page[${page.id}]`, out)
    }
  }
  // a component master holds custom-code blocks too, and one there lands on
  // every instance across the site
  if (Array.isArray(project.components)) {
    for (const def of project.components) {
      if (!def || typeof def.id !== 'string') continue
      collectCodeNodes(def.root ? [def.root] : [], `component[${def.id}]`, out)
    }
  }
  return out
}

/** every `custom-code` element in a tree — its content is raw HTML the
 * exporter emits verbatim, so it is as much a script vector as the page's own
 * custom code. The locale overrides ride along: a translation of a code
 * block is still code. */
function collectCodeNodes(nodes, label, out) {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    if (node.type === 'custom-code' && typeof node.id === 'string') {
      out.set(`${label}.custom-code[${node.id}]`, JSON.stringify([node.content ?? '', node.locales ?? null]))
    }
    collectCodeNodes(node.children, label, out)
  }
}

/** where the export is pushed — never an agent's call to change */
const publishTarget = (project) =>
  JSON.stringify(project?.settings?.publishing ?? null)

/**
 * Compare a baseline blob against an incoming one and name the first protected
 * field the write would change, or null when it changes none.
 *
 * A page that only appears in `incoming` (a new page the agent just created)
 * is compared against empty, so custom code cannot ride in on a fresh page.
 *
 * @param {object|null} baseline  the stored blob (or Main, for a new draft)
 * @param {object|null} incoming  the blob the agent wants to persist
 * @returns {{ field: string, kind: 'customCode' | 'publishing' } | null}
 */
export function protectedFieldDelta(baseline, incoming) {
  if (!incoming || typeof incoming !== 'object') return null
  // No baseline at all means there is nothing to protect yet (first write of a
  // brand-new instance); the store's own guards cover that case.
  if (!baseline || typeof baseline !== 'object') return null

  if (publishTarget(baseline) !== publishTarget(incoming)) {
    return { field: 'settings.publishing', kind: 'publishing' }
  }
  const before = codeSurface(baseline)
  const after = codeSurface(incoming)
  for (const [label, value] of after) {
    if ((before.get(label) ?? '') !== value) return { field: label, kind: 'customCode' }
  }
  return null
}
