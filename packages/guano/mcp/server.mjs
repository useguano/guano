// Guano MCP server (stdio). Exposes a running Guano instance to AI agents over
// the Model Context Protocol. It talks to the instance through the authed HTTP
// API (mcp/api.mjs) and reuses the editor's own DSL logic bundled into
// runtime/mcp-runtime.mjs, so structure edits carry node identity and state
// exactly like the browser editor. It never touches the data dir directly.
//
// The tools themselves live in mcp/tools.mjs (createToolSet) — shared with the
// in-editor assistant (server/agent.mjs). This file is only the stdio wiring.
//
// TARGET MODEL: the agent works on Main or in a draft. Write tools fail until
// the human picks a target via set_target — the store is latest-wins, so a
// write to Main while a human edits can clobber; drafts are the safe mode.
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import * as api from './api.mjs'
import { createProjectRouter } from './projects.mjs'
import { createToolSet, guideInstructions, MCP_VERSION } from './tools.mjs'

// the bundled editor runtime (built by `npm run build:mcp-runtime`)
const RUNTIME_URL = new URL('../runtime/mcp-runtime.mjs', import.meta.url)
let runtime
try {
  runtime = await import(RUNTIME_URL.href)
} catch {
  console.error(
    `guano mcp: runtime bundle missing at ${fileURLToPath(RUNTIME_URL)}\n` +
      `Build it with \`npm run build:mcp-runtime\` (it ships prebuilt in the npm package).`,
  )
  process.exit(1)
}

/**
 * ONE entry, several projects.
 *
 * `guano connect` used to write a `guano-<slug>` entry per project. Claude
 * Desktop launches every entry it has at startup, so each project you were not
 * running that minute failed its handshake and raised its own "could not
 * connect" alert — the normal state of a machine with four sites on it. A map
 * in one entry (GUANO_PROJECTS) means one process, one toolset, one tool list,
 * and nothing to fail for a project that is simply not up.
 *
 * With no map configured this falls back to the single-project env client, so a
 * hand-written GUANO_URL/GUANO_TOKEN entry keeps working untouched.
 */
const router = createProjectRouter()
const multi = router.configured().count > 0

/** the base of the project the last call resolved — `api.base` is read
 *  synchronously by a couple of tools and cannot await a resolution */
let resolvedBase = api.BASE
let resolvedSlug = null

async function liveApi() {
  const project = await router.current()
  resolvedBase = project.api.base
  resolvedSlug = project.slug
  return project
}

/**
 * The api the toolset is built with. Every call resolves the live project
 * first, so a project started (or stopped) mid-session is picked up without a
 * restart — and a refusal to resolve arrives as the tool's own error message
 * naming what to do, not as a dead client.
 */
const forward = (name) =>
  async (...args) => {
    const project = await liveApi()
    return await project.api[name](...args)
  }

const routedApi = multi
  ? {
      health: forward('health'),
      whoami: forward('whoami'),
      storeGetRaw: forward('storeGetRaw'),
      storeGetJson: forward('storeGetJson'),
      storePutRaw: forward('storePutRaw'),
      publish: forward('publish'),
      preview: forward('preview'),
      formsList: forward('formsList'),
      formSubmissions: forward('formSubmissions'),
      integrationsList: forward('integrationsList'),
      mediaIndex: forward('mediaIndex'),
      mediaUpload: forward('mediaUpload'),
      get base() {
        return resolvedBase
      },
      // how the toolset knows the live project changed, so it can drop a target
      // and a baseline that belong to the project before it
      projectKey: () => resolvedSlug,
      // per project, not one GUANO_MCP_TARGET for the whole entry: pinning
      // Main for a landing page must not pin it for a client's live site
      configuredTarget: () => (resolvedSlug ? router.targetFor(resolvedSlug) : ''),
    }
  : { ...api, base: api.BASE }

/**
 * The ONE signal, written only by `guano connect --config <file> --embedded`:
 * this process is the editor's own AI panel, not an outside client. It decides
 * the tool profile, the instructions, and what a write with no target says.
 * → docs/mcp.md (Embedded mode)
 */
const EMBEDDED = process.env.GUANO_MCP_EMBEDDED === '1'

const { tools, toolMap } = createToolSet({
  api: routedApi,
  runtime,
  embedded: EMBEDDED,
  // `use_project`: switching sites from inside the conversation, which is the
  // only place anybody actually wants to do it. The agent never DECIDES — the
  // human answers an elicitation dialog, the same consent channel set_target
  // uses — but asking the human to quit to a terminal for `guano use` was a
  // worse answer to "work on the other site" than it looked on paper.
  // Absent for a single-project entry, where there is nothing to switch to.
  projects: multi
    ? {
        list: async () => {
          const live = await router.resolve().catch(() => ({}))
          const entries = router.list()
          const states = await Promise.all(entries.map((p) => router.probe(p.slug)))
          return entries.map((p, i) => ({
            slug: p.slug,
            name: p.name || '',
            url: p.url,
            running: !!states[i]?.ok,
            active: p.slug === live.slug,
          }))
        },
        use: (slug) => router.pin(slug),
        active: () => router.activeKey(),
      }
    : null,
  // set_target's consent dialog: put the Main-vs-draft choice in front of the
  // HUMAN via MCP elicitation instead of trusting an agent-passed boolean.
  // `server` is declared below, but this closure only runs at tool-call time —
  // long after connect. Returning null (client never declared the elicitation
  // capability) tells set_target to fall back to the ask-in-chat attestation
  // flow.
  elicit: async (params) => {
    if (!server.getClientCapabilities()?.elicitation) return null
    // a human reading a dialog deserves more than the default 60s RPC timeout
    return server.elicitInput(params, { timeout: 300_000 })
  },
  hasElicitation: () => {
    const caps = server.getClientCapabilities()
    return caps ? !!caps.elicitation : null
  },
})

// ---------- wire up the MCP server ----------

// The golden rules and the workflow recipe ride in the initialize response —
// MCP clients inject `instructions` into the model's context, so an agent knows
// how to work here BEFORE its first tool call. Deliberately NOT the whole
// handbook (~100 KB): a client that injects instructions pays for them on every
// turn, and get_guide serves the rest a section at a time, on demand.
const server = new Server(
  { name: 'guano', version: MCP_VERSION },
  (() => {
    const instructions = guideInstructions(EMBEDDED)
    return { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) }
  })(),
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}))

// A tool result is read by a MODEL, and pretty-printing one is pure cost: the
// indentation of a `get_page` on a 500-line page runs ~15 KB (~4k tokens) of
// whitespace, per call, which dwarfs anything saved on the tool list. Small
// results stay indented so a human watching the traffic can still read them.
const PRETTY_MAX = 2_000
function serializeResult(result) {
  const compact = JSON.stringify(result)
  return compact.length > PRETTY_MAX ? compact : JSON.stringify(result, null, 2)
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name)
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }] }
  }
  try {
    const result = await tool.handler(request.params.arguments ?? {})
    return { content: [{ type: 'text', text: serializeResult(result) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e?.message ?? String(e) }] }
  }
})

/**
 * The wrong-project diagnosis.
 *
 * Several projects on one machine all default to port 4174, so GUANO_URL names
 * an address, not a project — whichever instance booted first owns it. A token
 * is minted into ONE data dir, so reaching the wrong instance is answered with
 * a 401 that looks exactly like a revoked token, and because this process then
 * exits before the MCP handshake the client can only report "not connected".
 * That is a whole afternoon with nothing anywhere naming the cause.
 *
 * `guano connect` bakes GUANO_INSTANCE into the entry, so a mismatch is
 * checkable before the token is even presented. Returns a message to die with,
 * or null when there is nothing to object to — an older instance reports no
 * `instance` at all and must keep working.
 */
async function instanceMismatch(client = api, expected = api.INSTANCE) {
  if (!expected) return null
  const h = await client.health()
  if (!h || typeof h.instance !== 'string' || !h.instance) return null
  if (h.instance === expected) return null
  return (
    `the server at ${client.base ?? api.BASE} is a DIFFERENT Guano project than this entry was ` +
    `connected to (expected instance ${expected.slice(0, 8)}, got ${h.instance.slice(0, 8)}).\n` +
    '  Another project is listening on that port, so its token would be refused.\n' +
    '  Start the right project, or re-run `guano connect` in it to re-point this entry.'
  )
}

/**
 * Say hello, or say why not — but SERVE EITHER WAY when the instance is merely
 * down.
 *
 * This used to `process.exit(1)` on any failure, which is right for a dead
 * token and wrong for the ordinary state of a project you are not running this
 * minute: the process died before the MCP handshake, so the client could only
 * report "could not connect", once per project, every time Claude Desktop
 * started. An unreachable instance is `status === 0` from api.mjs and nothing
 * else, which is what makes the two cases separable.
 *
 * A real misconfiguration — a revoked token, a pending setup, the wrong project
 * on the port — still exits loudly. Those are states a human has to fix, and
 * failing quietly would hide them behind tools that answer 401 one at a time.
 */
async function greet(client, { expectInstance = api.INSTANCE } = {}) {
  try {
    // The wrong-project check runs for the project actually resolved, not for
    // whatever the environment named. With several projects behind one entry
    // the router already rules out a mismatch when it has to CHOOSE between
    // them — but a single configured project is chosen without a probe, so
    // this is the only thing standing between a stale id and a bare 401.
    const wrong = await instanceMismatch(client, expectInstance)
    if (wrong) throw new Error(wrong)
    const user = await client.whoami()
    const label = user.instance?.name ? ` — project "${user.instance.name}"` : ''
    console.error(`guano mcp: connected to ${client.base} as ${user.email} (${user.role})${label}`)
  } catch (e) {
    // not running: no credential is in question, so there is nothing to refuse.
    // Serve, and let the first tool call say which project to start.
    if (e?.status === 0 || e?.noProject) {
      console.error(`guano mcp: ${e.message}`)
      console.error(
        'guano mcp: serving anyway — start the project and the next tool call picks it up, ' +
          'with no restart.',
      )
      return
    }
    console.error(`guano mcp: ${e.message}`)
    // A 401 here is nearly always a token minted against a different data dir:
    // the instance check above only fires for an entry carrying
    // GUANO_INSTANCE, and one written before that existed carries none.
    if (e?.needsSetup) {
      console.error(
        `guano mcp: ${client.base} has no admin account yet, so this token is still PENDING.\n` +
          '  Open /admin, create the first account, and the token binds to it automatically —\n' +
          '  there is no need to run `guano connect` again.',
      )
    } else if (e?.status === 401) {
      console.error(
        `guano mcp: the instance at ${client.base} does not recognise this token. It was most\n` +
          '  likely minted by a DIFFERENT Guano project that was holding that port, or it\n' +
          '  has been revoked. Run `guano connect` in the project you meant to edit (quit\n' +
          '  Claude Desktop first) — it re-mints the token and re-points this entry.',
      )
    }
    process.exit(1)
  }
}

export async function main() {
  if (multi) {
    const conf = router.configured()
    const r = await router.resolve()
    console.error(
      `guano mcp: ${conf.count} project${conf.count === 1 ? '' : 's'} configured ` +
        `(${router.list().map((p) => p.slug).join(', ')})` +
        (conf.pinned ? ` — pinned to ${conf.pinned}` : ''),
    )
    if (conf.dropped.length) {
      console.error(`guano mcp: ignored malformed GUANO_PROJECTS entries: ${conf.dropped.join(', ')}`)
    }
    // Resolving is never fatal here. Nothing running is the normal state of a
    // machine with several sites on it, and a client that dies for it is the
    // alert this design exists to remove.
    if (r.error) console.error(`guano mcp: no live project yet — ${r.error}`)
    else {
      const live = await router.current().catch(() => null)
      if (live) {
        console.error(`guano mcp: working on "${live.slug}" at ${live.api.base}`)
        await greet(live.api, { expectInstance: live.instance })
      }
    }
  } else {
    await greet({ whoami: api.whoami, health: api.health, base: api.BASE })
  }
  // The tools take local paths for bulk payloads, which is a read-anything
  // primitive whenever an agent can be talked into a path — and its output
  // lands in a project that may get published. A root confines it.
  if (!process.env.GUANO_MCP_FILE_ROOT) {
    console.error(
      'guano mcp: GUANO_MCP_FILE_ROOT is not set — path arguments can read any file this ' +
        'user can. Set it to the directory holding your payloads to confine them.',
    )
  }
  server.oninitialized = () => {
    // which consent channel set_target gets is decided here, by the client —
    // log it, or "no dialog appeared" is undiagnosable from the outside
    const caps = server.getClientCapabilities() ?? {}
    const client = server.getClientVersion()
    console.error(
      `guano mcp: client ${client?.name ?? '?'} ${client?.version ?? ''} — elicitation ` +
        `${caps.elicitation ? 'supported (set_target shows a dialog)' : 'NOT declared (set_target asks in chat)'}`,
    )
  }
  await server.connect(new StdioServerTransport())
  console.error('guano mcp: ready (stdio)')
}
