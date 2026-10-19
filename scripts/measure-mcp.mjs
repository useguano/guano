// Measures what an MCP client actually receives from the Guano MCP server, and
// fails when the tool list exceeds its budget.
//
// The files on disk (tools.mjs, mcp-runtime.mjs, GUIDE.md) cost an agent
// nothing — they are server-side. What an agent pays for every turn is the
// `tools/list` payload and the initialize `instructions`. Descriptions grow a
// sentence at a time with every bug fix, so this is a gate, not a report:
// explanation belongs in GUIDE.md (fetched on demand, a section at a time),
// not in a schema the client injects on every turn.
import { createToolSet, guideInstructions } from '../packages/guano/mcp/tools.mjs'

/**
 * tools/list must stay under this. It is set a little above the measured size,
 * so an ordinary fix that adds a sentence passes and a new schema essay does
 * not. Raise it only with a reason, and prefer moving the prose into GUIDE.md.
 *
 * Why not lower: ~48 tools with genuinely nested schemas carry ~22 KB of pure
 * JSON structure (keys, types, enums) before a word of prose. That part is not
 * compressible without dropping the shapes an agent needs to get a call right
 * the first time, so this is close to the floor at the current tool count.
 *
 * Raised 70,000 → 80,000 on 2026-10-05 (the reason: V10–V13 in GAPS-PLAN.md add
 * a channel target, a modal flag and a count-track format, and the list sat 224
 * bytes under the old line). Lazy tool loading via tools/list_changed was
 * weighed and set aside: no client capability says a client honours the
 * notification, so one that caches the first list would call tools it cannot
 * see. ~2,500 more tokens per turn if the room is used; the discipline stays.
 */
const BUDGET = 80_000

const runtime = await import('../packages/guano/runtime/mcp-runtime.mjs').catch(() => null)
if (!runtime) {
  console.error('runtime/mcp-runtime.mjs missing — run `npm run build:mcp-runtime`')
  process.exit(1)
}

/**
 * BOTH profiles. The editor's AI panel is the main integration and gets a
 * smaller list (`PANEL_DROPPED` in tools.mjs), but it is still a real client
 * paying real tokens — and the embedded profile is smaller by construction, so
 * measuring only it would let the external one grow unwatched. The budget is
 * one number for both: it is never raised to fit a new description.
 *
 * createToolSet sets a module-level `embeddedMode`, so the EXTERNAL profile is
 * built last and leaves the module in the state every other importer expects.
 */
const measure = (embedded) => {
  const { tools } = createToolSet({ api: { base: 'http://x' }, runtime, embedded })
  const list = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  return {
    list,
    bytes: JSON.stringify(list).length,
    rows: list
      .map((t) => ({
        name: t.name,
        desc: t.description.length,
        schema: JSON.stringify(t.inputSchema).length,
      }))
      .sort((a, b) => b.desc + b.schema - (a.desc + a.schema)),
  }
}

const panel = measure(true)
const { list, bytes, rows } = measure(false)

const over = bytes > BUDGET || panel.bytes > BUDGET
const show = process.argv.includes('--all') ? rows : rows.slice(0, 10)
if (over || process.argv.includes('--all') || process.argv.includes('--list')) {
  console.log('  total   desc schema  tool')
  for (const r of show) {
    console.log(
      String(r.desc + r.schema).padStart(7),
      String(r.desc).padStart(6),
      String(r.schema).padStart(6),
      ' ' + r.name,
    )
  }
  if (show.length < rows.length) console.log(`  … ${rows.length - show.length} more (--all)`)
}

const tok = (n) => `~${Math.round(n / 4).toLocaleString()} tokens`
const external = guideInstructions(false)
const embeddedInstructions = guideInstructions(true)
console.log(
  `\nexternal client — tools: ${list.length}` +
    `\n  tools/list: ${bytes.toLocaleString()} B (${tok(bytes)}) — budget ${BUDGET.toLocaleString()} B` +
    `\n  instructions: ${external.length.toLocaleString()} B (${tok(external.length)})` +
    `\n  descriptions: ${rows.reduce((a, r) => a + r.desc, 0).toLocaleString()} B` +
    `  schemas: ${rows.reduce((a, r) => a + r.schema, 0).toLocaleString()} B` +
    `\n\neditor AI panel — tools: ${panel.list.length}` +
    `\n  tools/list: ${panel.bytes.toLocaleString()} B (${tok(panel.bytes)}) — budget ${BUDGET.toLocaleString()} B` +
    `\n  instructions: ${embeddedInstructions.length.toLocaleString()} B (${tok(embeddedInstructions.length)})`,
)

// Neither instructions figure is budgeted, and the panel's being the larger of
// the two is a DECISION rather than drift. Printed in words because the next
// person to read these two numbers side by side will otherwise trim the panel
// back to match the external one and undo it.
console.log(
  `\n  ↳ the panel's instructions are deliberately the larger number: it carries` +
    `\n    GUIDE.md's "## Essentials" so a first turn needs no get_guide at all.` +
    `\n    An external client injects instructions on EVERY turn; Claude Code caches` +
    `\n    the system prompt, so the panel pays this once per session (measured:` +
    `\n    cache_read 258k/363k on two turns — docs/agent-panel.md, Startup cost).` +
    `\n    Neither figure is gated. The tools/list budget is, and is never raised.`,
)

if (over) {
  const which = bytes > BUDGET ? 'the external' : 'the panel'
  const size = bytes > BUDGET ? bytes : panel.bytes
  console.error(
    `\nFAIL: ${which} tools/list is ${(size - BUDGET).toLocaleString()} B over budget.` +
      `\nTrim the tools above: a description says WHAT and WHEN in two sentences and points at` +
      `\n\`get_guide {section:"…"}\` for the rest. Move the prose to GUIDE.md, don't delete it.`,
  )
  process.exit(1)
}
