// `guano use` — which project the agent works on, when more than one is up.
//
// Two running projects is an ordinary state (a client site and a template, a
// site and its test copy), and it used to stop every tool call dead:
// `resolve()` refuses to guess, correctly, but the only two ways out it could
// offer were "stop the other server" and "hand-edit GUANO_MCP_PROJECT into the
// MCP config, then restart your client". Both are wrong for a question whose
// honest form is "this one, for now".
//
// So the pin is a FILE, read on every resolve:
//
//   · no client restart — the env is fixed at spawn, this is not
//   · one per machine, so Desktop and Code agree about what "this one" means
//   · and it is still a HUMAN action, which is the whole safety property. The
//     agent has no shell, and `GUANO_MCP_FILE_ROOT` confines its path
//     arguments to the project folder — this file lives outside every project,
//     in the user's own state dir, so nothing an agent can be talked into
//     reaches it. That is the same reason GUANO_MCP_PROJECT is trusted: the
//     consent channel is one the agent cannot write to.
//
// `GUANO_MCP_PROJECT` still wins. It is a deliberate per-client pin somebody
// put in a config file, and a machine-wide "for now" must not override it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** `~/.guano/active-project.json`, or $GUANO_STATE_DIR for tests. Outside any
 *  project, which is what keeps it out of the agent's reach. */
export function pinFile() {
  const base = process.env.GUANO_STATE_DIR || join(homedir(), '.guano')
  return join(base, 'active-project.json')
}

/** the pinned slug, or '' */
export function readPin() {
  try {
    const rec = JSON.parse(readFileSync(pinFile(), 'utf8'))
    return typeof rec?.slug === 'string' ? rec.slug : ''
  } catch {
    return ''
  }
}

export function writePin(slug) {
  const file = pinFile()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify({ slug, at: Date.now() }, null, 2), { mode: 0o600 })
}

export function clearPin() {
  rmSync(pinFile(), { force: true })
}
