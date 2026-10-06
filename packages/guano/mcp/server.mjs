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
import { createToolSet, GUIDE_INSTRUCTIONS, MCP_VERSION } from './tools.mjs'

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

const { tools, toolMap } = createToolSet({
  api: { ...api, base: api.BASE },
  runtime,
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
  { capabilities: { tools: {} }, ...(GUIDE_INSTRUCTIONS ? { instructions: GUIDE_INSTRUCTIONS } : {}) },
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

// fail fast on a bad URL/token before speaking MCP
export async function main() {
  try {
    const user = await api.whoami()
    console.error(`guano mcp: connected to ${api.BASE} as ${user.email} (${user.role})`)
    // The tools take local paths for bulk payloads, which is a read-anything
    // primitive whenever an agent can be talked into a path — and its output
    // lands in a project that may get published. A root confines it.
    if (!process.env.GUANO_MCP_FILE_ROOT) {
      console.error(
        'guano mcp: GUANO_MCP_FILE_ROOT is not set — path arguments can read any file this ' +
          'user can. Set it to the directory holding your payloads to confine them.',
      )
    }
  } catch (e) {
    console.error(`guano mcp: ${e.message}`)
    process.exit(1)
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
