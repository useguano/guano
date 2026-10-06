// Measures what an MCP client actually receives from the Guano MCP server, and
// fails when the tool list exceeds its budget.
//
// The files on disk (tools.mjs, mcp-runtime.mjs, GUIDE.md) cost an agent
// nothing — they are server-side. What an agent pays for every turn is the
// `tools/list` payload and the initialize `instructions`. Descriptions grow a
// sentence at a time with every bug fix, so this is a gate, not a report:
// explanation belongs in GUIDE.md (fetched on demand, a section at a time),
// not in a schema the client injects on every turn.
import { createToolSet, GUIDE_INSTRUCTIONS } from '../packages/guano/mcp/tools.mjs'

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

const { tools } = createToolSet({ api: { base: 'http://x' }, runtime })
const list = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
const bytes = JSON.stringify(list).length

const rows = list
  .map((t) => ({
    name: t.name,
    desc: t.description.length,
    schema: JSON.stringify(t.inputSchema).length,
  }))
  .sort((a, b) => b.desc + b.schema - (a.desc + a.schema))

const over = bytes > BUDGET
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
console.log(
  `\ntools: ${list.length}` +
    `\ntools/list: ${bytes.toLocaleString()} B (${tok(bytes)}) — budget ${BUDGET.toLocaleString()} B` +
    `\ninstructions: ${GUIDE_INSTRUCTIONS.length.toLocaleString()} B (${tok(GUIDE_INSTRUCTIONS.length)})` +
    `\ndescriptions: ${rows.reduce((a, r) => a + r.desc, 0).toLocaleString()} B` +
    `  schemas: ${rows.reduce((a, r) => a + r.schema, 0).toLocaleString()} B`,
)

if (over) {
  console.error(
    `\nFAIL: tools/list is ${(bytes - BUDGET).toLocaleString()} B over budget.` +
      `\nTrim the tools above: a description says WHAT and WHEN in two sentences and points at` +
      `\n\`get_guide {section:"…"}\` for the rest. Move the prose to GUIDE.md, don't delete it.`,
  )
  process.exit(1)
}
