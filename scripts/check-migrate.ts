// Validates the v2 schema migration (src/lib/migrate.ts).
//
// Run with:  npm run check:migrate
//
// `check:corpus` already proves the migration renders real projects
// byte-identically — but none of the corpus projects happens to USE the pure
// alias types (`container`, `grid`, `heading`, `dropdown`) or carry an
// unexpanded `:Card:` leaf instance, which are the two steps that actually
// change a tree. So those are built here on purpose and held to the same
// standard: export before, migrate, export after, compare.
//
// The migration is a ONE-WAY rewrite of every project blob on the instance. It
// deletes `page.code`. There is no version of this that is worth shipping on
// "it type-checks".

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateProject, SCHEMA_VERSION } from '../src/lib/migrate'
import { createProject } from '../src/lib/factories'
import { walkNodes } from '../src/lib/tree'
import type { ElementNode, Project } from '../src/types/editor'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

let fails = 0
const ok = (cond: unknown, msg: string, extra?: unknown) => {
  if (!cond) {
    console.error(`FAIL  ${msg}`, extra ?? '')
    fails++
  }
}

const node = (type: string, children: ElementNode[] = [], extra: Partial<ElementNode> = {}) =>
  ({ id: crypto.randomUUID(), type, content: '', children, ...extra }) as ElementNode

/** every exported file, hashed — the same comparison scripts/corpus.mjs makes */
async function exported(project: Project): Promise<Record<string, string>> {
  const dir = mkdtempSync(join(tmpdir(), 'guano-migrate-'))
  try {
    await exportSite(JSON.parse(JSON.stringify(project)), dir)
    const { readdirSync, statSync } = await import('node:fs')
    const out: Record<string, string> = {}
    const walk = (rel: string) => {
      for (const name of readdirSync(join(dir, rel))) {
        const next = rel ? `${rel}/${name}` : name
        if (statSync(join(dir, next)).isDirectory()) walk(next)
        else out[next] = readFileSync(join(dir, next), 'utf8')
      }
    }
    walk('')
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ids = (project: Project) => {
  const out: string[] = []
  for (const page of project.pages) walkNodes(page.elements, (n) => out.push(n.id))
  for (const def of project.components) walkNodes([def.root], (n) => out.push(n.id))
  return out.sort().join()
}

// ---------- the v1 shapes the migration touches ----------

/** the shape a v1 blob had: the DSL text beside the tree, lines on every node */
type V1 = Project & { pages: ({ code?: string } & Project['pages'][number])[] }

/** give every node and effect a deterministic id, so two independently built
 *  copies of the same project export byte-identically (a node id reaches the
 *  HTML through interaction state keys) */
function fixIds(project: Project) {
  let n = 0
  const next = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`
  for (const page of project.pages) {
    page.id = next()
    walkNodes(page.elements, (node) => (node.id = next()))
  }
  for (const def of project.components) {
    def.id = next()
    walkNodes([def.root], (node) => (node.id = next()))
  }
  for (const effect of project.interactions) effect.id = next()
  for (const anim of project.animations) anim.id = next()
  return project
}

function v1Base(): V1 {
  const project = createProject('Migration') as V1
  delete project.schemaVersion // a v1 blob has none
  project.pages = []
  return project
}

const v1Page = (body: ElementNode): V1['pages'][number] => ({
  id: crypto.randomUUID(),
  name: 'Home',
  path: '/',
  status: 'published',
  // the v1 mirror, deliberately STALE: the migration must keep the tree and
  // merely record the disagreement
  code: '@setup\n\tname: Home\n\tslug: /\n\tstatus: published\n\tlocale: en\n:body\n\t:div\nbody:',
  elements: [body],
})

/** every node carried a line/endLine in v1 */
const withLines = (project: V1) => {
  for (const page of project.pages) {
    walkNodes(page.elements, (n) => Object.assign(n, { line: 0, endLine: 0 }))
  }
  for (const def of project.components) {
    walkNodes([def.root], (n) => Object.assign(n, { line: 0, endLine: 0 }))
  }
  return project
}

/** a project using all four pure aliases, each styled so a wrong tag shows */
function aliasProject(): V1 {
  const project = v1Base()
  project.pages = [
    v1Page(
      node('body', [
        node('container', [node('heading', [], { content: 'Aliased heading' })], {
          classes: 'mx-auto max-w-5xl',
        }),
        node('grid', [node('div', [], { classes: 'h-8 bg-muted' })], {
          classes: 'grid grid-cols-2',
        }),
        node(
          'dropdown',
          [node('option', [], { content: 'One' }), node('option', [], { content: 'Two' })],
          { classes: 'appearance-none rounded-lg border' },
        ),
      ]),
    ),
  ]
  return withLines(fixIds(project) as V1)
}

/** a project whose page holds an UNEXPANDED instance: a stored `:Card:` leaf
 *  nothing ever materialized, which therefore rendered as nothing at all */
function unexpandedProject(): V1 {
  const project = v1Base()
  // a Card holds a Button (the mirror in Card's master is Button's structure)
  const button = {
    id: crypto.randomUUID(),
    name: 'Button',
    root: node('Button', [
      node('button', [node('span', [], { content: 'Button' })], { classes: 'rounded-md px-4 py-2' }),
    ]),
  }
  const card = {
    id: crypto.randomUUID(),
    name: 'Card',
    root: node('Card', [
      node(
        'div',
        [
          node('h3', [], { content: 'Card title', classes: 'text-lg font-semibold' }),
          node('Button', [node('button', [node('span')])]),
        ],
        { classes: 'rounded-xl border p-6' },
      ),
    ]),
  }
  project.components.push(button, card)
  project.pages = [v1Page(node('body', [node(card.name, [], { ref: 'promo' })]))]
  return withLines(fixIds(project) as V1)
}

/** the exported files that differ between two renders, with a window on the
 *  first differing character */
function diff(a: Record<string, string>, b: Record<string, string>): string[] {
  const out: string[] = []
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (a[path] === b[path]) continue
    const x = a[path] ?? ''
    const y = b[path] ?? ''
    let at = 0
    while (at < x.length && x[at] === y[at]) at++
    out.push(
      `${path} @${at}\n      - ${x.slice(Math.max(0, at - 70), at + 140)}` +
        `\n      + ${y.slice(Math.max(0, at - 70), at + 140)}`,
    )
  }
  return out
}

// ---------- 1. collapsing the aliases changes NOTHING ----------
{
  // the alias and its target render the same tag and the same shape, which is
  // the whole reason the collapse is safe. The aliases stay in the registry as
  // a fallback, so the BEFORE render resolves them properly.
  const before = aliasProject()
  const after = aliasProject()
  const identityBefore = ids(before)
  const htmlBefore = await exported(before)

  const { report } = migrateProject(after)
  ok(report.changed, 'the migration ran')
  ok(report.collapsed.container === 1, `collapsed container (${report.collapsed.container})`)
  ok(report.collapsed.grid === 1, `collapsed grid (${report.collapsed.grid})`)
  ok(report.collapsed.heading === 1, `collapsed heading (${report.collapsed.heading})`)
  ok(report.collapsed.dropdown === 1, `collapsed dropdown (${report.collapsed.dropdown})`)
  ok(after.schemaVersion === SCHEMA_VERSION, 'schemaVersion set')

  const problems = diff(htmlBefore, await exported(after))
  for (const p of problems) console.error(`FAIL  ${p}`)
  fails += problems.length
  ok(problems.length === 0, `the export is byte-identical (${Object.keys(htmlBefore).length} files)`)
  // the one thing a render check cannot see: a re-minted id breaks comment
  // anchors, interaction targets and the 3-way merge base
  ok(ids(after) === identityBefore, 'every node kept its id')
  // and the collapse really happened, or the render check compared two v1 trees
  const types = after.pages[0]!.elements[0]!.children.map((c) => c.type)
  ok(types.join() === 'div,div,select', `the types collapsed (${types.join()})`)
  ok(
    after.pages[0]!.elements[0]!.children[0]!.children[0]!.type === 'h2',
    'heading → h2',
  )

  // no v1 field survives anywhere
  let leftover = 0
  for (const page of after.pages) {
    if ('code' in page) leftover++
    walkNodes(page.elements, (n) => {
      if ('line' in n || 'endLine' in n) leftover++
    })
  }
  for (const def of after.components) {
    walkNodes([def.root], (n) => {
      if ('line' in n || 'endLine' in n) leftover++
    })
  }
  ok(leftover === 0, `no v1 field survives (${leftover})`)
}

// ---------- 2. materializing an unexpanded instance is an intended FIX ----------
{
  // This is the one step that deliberately changes a render: a `:Card:` leaf
  // nothing ever expanded rendered as NOTHING, so the page was silently
  // missing its card. The migration gives it the component's structure.
  const before = unexpandedProject()
  const after = unexpandedProject()
  const htmlBefore = await exported(before)
  ok(
    !htmlBefore['index.html']!.includes('rounded-xl'),
    'before: the unexpanded instance rendered nothing',
  )

  const identityBefore = new Set(ids(before).split(','))
  const { report } = migrateProject(after)
  ok(report.materialized === 1, `materialized it (${report.materialized})`)
  const promo = after.pages[0]!.elements[0]!.children.find((n) => n.ref === 'promo')
  ok((promo?.children.length ?? 0) > 0, `the instance has its parts (${promo?.children.length})`)

  const htmlAfter = await exported(after)
  ok(
    htmlAfter['index.html']!.includes('rounded-xl'),
    'after: the published page carries the component',
  )
  // nodes were ADDED, but nothing that existed was re-minted
  const stillThere = [...identityBefore].every((id) => ids(after).includes(id))
  ok(stillThere, 'and every id that existed still does')
}

// ---------- 2. it is idempotent, and leaves a v2 project alone ----------
{
  const project = aliasProject()
  migrateProject(project)
  const once = JSON.stringify(project)
  const { report } = migrateProject(project)
  ok(!report.changed, 'a second run reports no change')
  ok(JSON.stringify(project) === once, 'and changes nothing')
}

// ---------- 3. a stale mirror is recorded, never applied ----------
{
  const project = aliasProject()
  const { report } = migrateProject(project, { pageToCode: () => 'something else entirely' })
  ok(report.textDisagreed.length === 1, 'a disagreeing mirror is recorded', report.textDisagreed)
  // the TREE is what survived: the stale code said one bare div, the tree says
  // three elements
  ok(project.pages[0]!.elements[0]!.children.length === 3, 'and the tree is what survived')
}

// ---------- 4. salvage: a page with text but no tree ----------
{
  const project = aliasProject()
  project.pages[0]!.elements = []
  project.pages[0]!.code =
    '@setup\n\tname: Home\n\tslug: /\n\tstatus: published\n\tlocale: en\n:body\n\t:section\n\t\t:h1:\n\tsection:\nbody:'
  const { report } = migrateProject(project)
  ok(report.salvaged.length === 1, 'the page is salvaged from its text', report.salvaged)
  const body = project.pages[0]!.elements[0]
  ok(body?.type === 'body', 'with a body')
  ok(body?.children[0]?.type === 'section', 'and its structure', body?.children.map((c) => c.type))
  ok(body?.children[0]?.children[0]?.type === 'h1', 'all of it')
}

// ---------- 5. a page with neither is not destroyed silently ----------
{
  const project = aliasProject()
  project.pages[0]!.elements = []
  delete project.pages[0]!.code
  const { report } = migrateProject(project)
  ok(report.salvaged[0]?.includes('empty'), 'an unsalvageable page says so', report.salvaged)
  ok(project.pages[0]!.elements[0]?.type === 'body', 'and still has a body to edit')
}

console.log(fails ? `\n${fails} FAILURES` : '\nmigration OK')
process.exit(fails ? 1 : 0)
