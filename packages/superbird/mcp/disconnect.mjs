// `superbird disconnect` — take a project OUT of the shared Claude entry.
//
// The map had no remove. `connect` adds a key and folds legacy ones in, and
// that was the whole of it, so a project that was deleted, renamed, rebuilt or
// moved to another port stayed in SUPERBIRD_PROJECTS forever. The only way out was
// to hand-edit claude_desktop_config.json — which Claude Desktop rewrites from
// memory on quit, so the edit silently reverts, and the next attempt is a
// bigger hand-edit. Ten dead entries later, nine of them claiming :4174, no
// tool call can resolve a project and nothing in the config says which entry
// is the real one.
//
// So: removal is a command, it goes through the same client list and the same
// quit guard as `connect`, and `--stale` decides what is dead with the
// router's own identity test (`identifyEntry`) rather than a second opinion.
//
// What it never does is remove an entry it cannot DISPROVE. A project that is
// simply not running this minute looks identical to one that no longer exists,
// and deleting the first costs a token the user has to re-mint. Only an entry
// whose address ANSWERS — and answers as somebody else, or refuses the entry's
// own token — is provably unusable from this config.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './fsx.mjs'
import { join } from 'node:path'
import readline from 'node:readline/promises'
import { ENTRY_KEY, claudeDesktopRunning, clientTargets, readIdentity, resolveDataDir } from './connect.mjs'
import { addressOf, identifyEntry, parseProjects } from './projects.mjs'

/** the SUPERBIRD_PROJECTS map inside one client config file, or null */
function readMap(config) {
  const entry = config?.mcpServers?.[ENTRY_KEY]
  const raw = entry?.env?.SUPERBIRD_PROJECTS
  if (typeof raw !== 'string' || !raw) return null
  const { projects } = parseProjects(raw)
  return projects
}

async function loadTarget(target) {
  try {
    const config = JSON.parse(await readFile(target.path, 'utf8'))
    return { config, projects: readMap(config) }
  } catch {
    return { config: null, projects: null }
  }
}

/**
 * Which key in this map is the project in `dataDir`.
 *
 * By INSTANCE ID, never by slug: the slug is a display name chosen when the
 * entry was written (a folder name, before the project had one), so matching
 * on it would delete a different site that happens to be called the same
 * thing.
 *
 * Then by TOKEN, which is the case that matters here: an entry written before
 * `connect` minted an id for a never-booted project carries none, and those
 * are precisely the entries somebody is trying to clean up. A token is minted
 * into ONE data dir, so an entry whose token hashes to one of THIS dir's
 * records is this project — the same proof the router's token test makes, done
 * offline against api-tokens.json instead of over HTTP, so it works for a
 * project that is not running and for one whose port somebody else holds.
 *
 * Matching nothing returns '' and the user names the slug. Deleting the wrong
 * entry costs a token they have to re-mint, so a guess is worse than a prompt.
 */
async function keyForProject(projects, id, dataDir) {
  const byId = id ? Object.keys(projects).find((s) => projects[s].instance === id) : ''
  if (byId) return byId
  let records = []
  try {
    records = JSON.parse(await readFile(join(dataDir, 'api-tokens.json'), 'utf8'))
  } catch {
    /* no token has ever been minted here */
  }
  if (!Array.isArray(records) || !records.length) return ''
  const mine = new Set(records.map((r) => r?.tokenHash).filter(Boolean))
  return (
    Object.keys(projects).find(
      (s) => projects[s].token && mine.has(createHash('sha256').update(projects[s].token).digest('hex')),
    ) ?? ''
  )
}

async function confirm(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

/**
 * Every entry that can be DISPROVED: its address answers as somebody else, or
 * its `dir` is gone / now holds another project. The second case is what made
 * cleanup possible at all — an entry whose port simply has nothing on it is
 * indistinguishable from a project that is merely off, so before entries
 * carried a dir, one whose port had been freed could never be removed and the
 * map could only grow.
 */
async function findStale(projects) {
  const stale = []
  for (const [slug, p] of Object.entries(projects)) {
    const verdict = await identifyEntry(p)
    if (!verdict.ok && verdict.answered) stale.push({ slug, why: verdict.why })
  }
  return stale
}

/** print the map with a live verdict per entry — `--list` */
async function list(targets) {
  for (const target of targets) {
    const { projects } = await loadTarget(target)
    if (!projects) continue
    const slugs = Object.keys(projects)
    console.log(`\n${target.label} — ${slugs.length} project${slugs.length === 1 ? '' : 's'} (${target.path})`)
    if (!slugs.length) console.log('  (none)')
    for (const slug of slugs) {
      const verdict = await identifyEntry(projects[slug])
      const mark = verdict.ok ? '✓ live  ' : verdict.answered ? '✗ stale ' : '· down  '
      const where = addressOf(projects[slug]) || projects[slug].dir || '(no address)'
      console.log(`  ${mark} ${slug.padEnd(20)} ${where}${verdict.why ? `\n           ${verdict.why}` : ''}`)
    }
  }
}

/**
 * @param {string[]} args  CLI flags
 */
export async function main(args = []) {
  const flag = (name) => args.includes(name)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i !== -1 ? args[i + 1] : undefined
  }
  // the positional slug, if any — everything else is a flag, and `--config`
  // eats the token after it
  const named = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--config') ?? ''
  const targets = clientTargets(opt('--config'))

  if (flag('--list')) {
    await list(targets)
    return
  }

  // Which project this is, when none was named: the folder's own data dir,
  // identified the way `connect` identifies it — the data dir is the
  // authority, never the port.
  let selfId = ''
  let selfDir = ''
  if (!named && !flag('--stale')) {
    const dataDir = await resolveDataDir()
    selfDir = dataDir
    process.env.SUPERBIRD_DATA_DIR = dataDir
    const identity = await readIdentity(
      (process.env.SUPERBIRD_URL || `http://localhost:${process.env.PORT || 4174}`).replace(/\/+$/, ''),
      dataDir,
    )
    selfId = identity.id
  }

  let removedAnywhere = false
  let blockedByDesktop = false

  for (const target of targets) {
    const { config, projects } = await loadTarget(target)
    if (!config || !projects) continue

    let doomed = []
    if (flag('--stale')) {
      const found = await findStale(projects)
      for (const { slug, why } of found) console.log(`  ${slug} — ${why}`)
      doomed = found.map((f) => f.slug)
    } else if (named) {
      if (!projects[named]) {
        console.log(`· ${target.label}: no project "${named}" in its map (${Object.keys(projects).join(', ') || 'empty'})`)
        continue
      }
      doomed = [named]
    } else {
      const key = await keyForProject(projects, selfId, selfDir)
      if (!key) {
        console.log(
          `· ${target.label}: could not tell which of its ${Object.keys(projects).length} entries is ` +
            `this project (${selfDir}). Name it: superbird disconnect <slug> — see \`superbird disconnect --list\``,
        )
        continue
      }
      doomed = [key]
    }
    if (!doomed.length) {
      console.log(`· ${target.label}: nothing to remove`)
      continue
    }

    // Claude Desktop flushes its in-memory config on quit, so a write made
    // while it runs is silently reverted — the same guard `connect` has, and
    // the same reason: a removal that reverts is worse than one that refused,
    // because the user believes the entry is gone.
    if (target.needsQuit && !flag('--force') && claudeDesktopRunning()) {
      console.error(
        `\n✗ ${target.label} is running. Quit it completely first (it overwrites its config\n` +
          '  on quit, which would silently undo this), then re-run `superbird disconnect`.',
      )
      blockedByDesktop = true
      continue
    }

    if (!flag('--yes') && !(await confirm(`Remove ${doomed.join(', ')} from ${target.label}?`))) {
      console.log(`· ${target.label}: left alone`)
      continue
    }

    const kept = { ...projects }
    for (const slug of doomed) delete kept[slug]
    const servers = { ...config.mcpServers }
    if (Object.keys(kept).length) {
      // Keep the entry, with the survivors. Each project is {url, token,
      // instance, target, name} — parseProjects normalized them, and writing
      // the normalized shape back is what drops a malformed sibling for good.
      servers[ENTRY_KEY] = {
        ...servers[ENTRY_KEY],
        env: { ...servers[ENTRY_KEY].env, SUPERBIRD_PROJECTS: JSON.stringify(strip(kept)) },
      }
    } else {
      // The last project is out, so the entry has nothing to serve. Leaving an
      // empty one behind is the "could not connect" alert all over again.
      delete servers[ENTRY_KEY]
    }
    await writeJsonAtomic(target.path, { ...config, mcpServers: servers })
    removedAnywhere = true
    console.log(
      `✓ ${target.label}: removed ${doomed.join(', ')} — ${Object.keys(kept).length} project` +
        `${Object.keys(kept).length === 1 ? '' : 's'} left (${target.path})`,
    )
  }

  if (blockedByDesktop && !removedAnywhere) process.exit(1)
  if (removedAnywhere) {
    console.log('\nReopen Claude to pick it up. The project itself is untouched — its data dir,')
    console.log('its token and its site are all still there; only the client entry is gone.')
    console.log('Run `superbird connect` in its folder to put it back.')
  }
}

/** drop the keys parseProjects fills in with empty defaults, so an entry that
 *  never had a target or a name does not gain one just by surviving a removal.
 *  `dir` is NOT one of those: it is the authority on where a local project is
 *  (→ docs/instance.md), and dropping it left every surviving project addressed
 *  by a cached `url` that goes stale the first time a port moves — which is
 *  exactly what the desktop launcher does on every tab it opens. */
function strip(projects) {
  const out = {}
  for (const [slug, p] of Object.entries(projects)) {
    out[slug] = {
      ...(p.dir ? { dir: p.dir } : {}),
      ...(p.url ? { url: p.url } : {}),
      token: p.token,
      ...(p.instance ? { instance: p.instance } : {}),
      ...(p.target ? { target: p.target } : {}),
      ...(p.name ? { name: p.name } : {}),
    }
  }
  return out
}
