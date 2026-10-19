// `superbird use [slug|--none|--list]` — pick the project the agent works on.
//
// See pin.mjs for why this is a file rather than an env var, and why writing
// it is a human action an agent cannot perform. This module is the UI: it
// resolves a slug against what is actually configured, so a typo is refused
// by name instead of silently pinning nothing.
import { readFile } from 'node:fs/promises'
import { ENTRY_KEY, clientTargets, readIdentity, resolveDataDir } from './connect.mjs'
import { addressOf, identifyEntry, parseProjects } from './projects.mjs'
import { clearPin, pinFile, readPin, writePin } from './pin.mjs'

/** every project across every client config, keyed by slug. The pin is one per
 *  machine, so the union is the right candidate set — a slug configured in
 *  Claude Code is a legitimate thing to pin even if Desktop has not got it. */
async function allProjects() {
  const all = {}
  for (const target of clientTargets()) {
    try {
      const config = JSON.parse(await readFile(target.path, 'utf8'))
      const raw = config?.mcpServers?.[ENTRY_KEY]?.env?.SUPERBIRD_PROJECTS
      if (typeof raw !== 'string' || !raw) continue
      const { projects } = parseProjects(raw)
      for (const [slug, p] of Object.entries(projects)) all[slug] ??= p
    } catch {
      /* missing or unreadable config — the other client may still have one */
    }
  }
  return all
}

/** the slug of the project in this folder, by instance id */
async function slugHere(projects) {
  const dataDir = await resolveDataDir().catch(() => null)
  if (!dataDir) return ''
  const identity = await readIdentity(null, dataDir).catch(() => null)
  if (!identity?.id) return ''
  return Object.keys(projects).find((s) => projects[s].instance === identity.id) ?? ''
}

export async function main(args = []) {
  const flag = (n) => args.includes(n)
  const named = args.find((a) => !a.startsWith('-')) ?? ''
  const projects = await allProjects()
  const slugs = Object.keys(projects)
  const current = readPin()

  if (flag('--none')) {
    clearPin()
    console.log('✓ no project pinned — the agent uses whichever one is running')
    return
  }

  if (flag('--list') || (!named && !current)) {
    if (!slugs.length) {
      console.log('no projects are configured — run `superbird connect` in a project folder')
      return
    }
    console.log(`\nprojects (${pinFile()})\n`)
    for (const slug of slugs) {
      const verdict = await identifyEntry(projects[slug])
      const mark = slug === current ? '→' : ' '
      const state = verdict.ok ? 'running' : verdict.answered ? 'stale  ' : 'stopped'
      console.log(`  ${mark} ${slug.padEnd(20)} ${state}  ${addressOf(projects[slug]) || ''}`)
    }
    console.log(`\npick one with \`superbird use <slug>\`, or \`superbird use --none\` to unpin.`)
    return
  }

  // bare `superbird use` with a pin set reports it; with none it listed, above
  if (!named) {
    const known = projects[current]
    console.log(
      known
        ? `→ ${current} (${addressOf(known) || 'no address'})`
        : `→ ${current} — which is no longer configured; \`superbird use --none\` to clear it`,
    )
    return
  }

  const slug = named === '.' ? await slugHere(projects) : named
  if (named === '.' && !slug) {
    throw new Error(
      'this folder is not a connected project — run `superbird connect` here first, ' +
        'or name one: `superbird use <slug>`',
    )
  }
  if (!projects[slug]) {
    throw new Error(
      `"${slug}" is not a configured project${slugs.length ? ` (${slugs.join(', ')})` : ''}. ` +
        'Run `superbird connect` in its folder first.',
    )
  }

  writePin(slug)
  const verdict = await identifyEntry(projects[slug])
  console.log(`✓ the agent now works on "${slug}" — no restart needed, it takes effect on the next tool call`)
  if (!verdict.ok) {
    // Pinning something that is off is allowed on purpose: it is a statement
    // of intent, and silently working on a DIFFERENT site because this one is
    // down is the one outcome this whole mechanism exists to prevent.
    console.log(`! it is not running right now — ${verdict.why || 'start it when you need it'}`)
  }
}
