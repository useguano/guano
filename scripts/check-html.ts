// Validates the agent-facing HTML layer (src/lib/html/).
//
// Run with:  npm run check:html
//
// Two halves, both of which earn their keep:
//
// 1. THE ROUND-TRIP PROPERTIES, over every project in the corpus
//    (.corpus/inputs — see scripts/corpus.mjs). For each page and each
//    component master:
//      - `parse(serialize(x))` applied back to `x` is a NO-OP: the same JSON,
//        nothing created, nothing removed;
//      - serializing twice is a fixed point;
//      - with every `data-id` stripped, adoption is still total — the fallback
//        (ref, then a tree LCS) carries identity on its own.
//    This is what stands between an agent's write and silent data loss: the
//    HTML does not carry interactions, animations, translations, slider config
//    or `listQuery`, so a node the write fails to ADOPT loses all of it.
//
// 2. THE BEHAVIOUR AND THE REFUSALS, on small built-to-order projects: what
//    the parser accepts, what it refuses and where, how identity is carried,
//    and the component-instance rules. A refusal that stops being a refusal is
//    how "the tool reported success for a write that renders nowhere" comes
//    back, which is the bug class this whole format exists to remove.
//
// There is no unit-test runner in this repo; this is the gate.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { pageToHtml, masterToHtml } from '../src/lib/html/serialize'
import { parseHtml } from '../src/lib/html/parse'
import { applyHtml, contextFromProject } from '../src/lib/html/apply'
import { setStyleTokens } from '../src/lib/styles'
import { setColorTokens } from '../src/lib/colors'
import { walkNodes } from '../src/lib/tree'
import { createProject } from '../src/lib/factories'
import type { ElementNode, Project } from '../src/types/editor'

let fails = 0
const fail = (msg: string) => { console.error(`FAIL  ${msg}`); fails++ }

const load = (name: string) =>
  JSON.parse(readFileSync(`.corpus/inputs/${name}.json`, 'utf8')) as Project

// the one normalization a write performs: `classes: ""` means no classes, and
// the editor's own class writer deletes the key too. Compared away, not
// papered over — a real project carries one such node.
const norm = (json: string) => json.replace(/,"classes":""/g, '')

function firstDiff(a: string, b: string) {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return `@${i}\n    - ${a.slice(Math.max(0, i - 90), i + 150)}\n    + ${b.slice(Math.max(0, i - 90), i + 150)}`
}

console.log('--- round-trip properties, over the corpus ---')
if (!existsSync('.corpus/inputs')) {
  console.log('(no corpus — run `node scripts/corpus.mjs build` to include it)')
}
for (const file of existsSync('.corpus/inputs') ? readdirSync('.corpus/inputs') : []) {
  const name = file.replace(/\.json$/, '')
  const project = load(name)
  // the class vocabulary the project's tokens imply, as useSettings feeds it
  const tokens = project.settings?.tokens ?? []
  setStyleTokens(tokens.map((t) => t.name))
  setColorTokens(Object.fromEntries(tokens.map((t) => [t.name, t.value ?? '#000'])))
  const ctx = contextFromProject(project)

  let pages = 0, noop = 0, fixed = 0, idless = 0, masters = 0, masterNoop = 0
  const refusals: string[] = []
  const errors: string[] = []

  for (const page of project.pages) {
    pages++
    const body = page.elements.find((n) => n.type === 'body')!
    const before = norm(JSON.stringify(page.elements))
    const html = pageToHtml(page, project)

    // (2) serializing twice is a fixed point
    const again = pageToHtml(page, project)
    if (html === again) fixed++
    else fail(`${name}/${page.name}: serialize is not stable ${firstDiff(html, again)}`)

    // (1) parse → apply is a no-op
    const parsed = parseHtml(html, ctx.componentNames)
    for (const e of parsed.errors) errors.push(`${page.name} ${e.line}:${e.col} ${e.message}`)
    const res = applyHtml(body, parsed.roots, { project, validate: ctx })
    for (const r of res.refused) refusals.push(`REFUSED ${page.name} ${r.path}: ${r.message}`)
    for (const r of res.warnings) refusals.push(`warn    ${page.name} ${r.path}: ${r.message}`)
    const after = norm(JSON.stringify(page.elements))
    if (before === after && res.created === 0 && res.removed === 0) noop++
    else if (before !== after) {
      fail(`${name}/${page.name}: round-trip changed the tree ${firstDiff(before, after)}`)
    } else {
      fail(`${name}/${page.name}: created ${res.created} removed ${res.removed}`)
    }

    // (3) with every data-id stripped, adoption is still total
    const stripped = pageToHtml(page, project, { ids: false })
    const reparsed = parseHtml(stripped, ctx.componentNames)
    const treeBefore = norm(JSON.stringify(page.elements))
    const res2 = applyHtml(body, reparsed.roots, { project, validate: ctx })
    if (res2.created === 0 && res2.removed === 0 && norm(JSON.stringify(page.elements)) === treeBefore) {
      idless++
    } else {
      fail(
        `${name}/${page.name}: without data-id, created ${res2.created} removed ${res2.removed}` +
          (norm(JSON.stringify(page.elements)) === treeBefore ? '' : ` ${firstDiff(treeBefore, norm(JSON.stringify(page.elements)))}`),
      )
    }
  }

  for (const def of project.components ?? []) {
    masters++
    const before = norm(JSON.stringify(def.root))
    const html = masterToHtml(def, project)
    const parsed = parseHtml(html, ctx.componentNames)
    for (const e of parsed.errors) errors.push(`${def.name} ${e.line}:${e.col} ${e.message}`)
    const res = applyHtml(def.root, parsed.roots, { project, def, validate: ctx })
    for (const r of res.refused) refusals.push(`REFUSED ${def.name} ${r.path}: ${r.message}`)
    for (const r of res.warnings) refusals.push(`warn    ${def.name} ${r.path}: ${r.message}`)
    if (norm(JSON.stringify(def.root)) === before && !res.created && !res.removed) masterNoop++
    else fail(`${name}/${def.name}: master round-trip changed ${firstDiff(before, norm(JSON.stringify(def.root)))} (created ${res.created} removed ${res.removed})`)
  }

  console.log(
    `${name}: pages ${noop}/${pages} no-op, ${fixed}/${pages} stable, ${idless}/${pages} id-less; ` +
      `masters ${masterNoop}/${masters}`,
  )
  if (errors.length) { console.log(`  parse errors (${errors.length}):`); errors.slice(0, 8).forEach((e) => console.log(`    ${e}`)) }
  if (refusals.length) { console.log(`  refusals (${refusals.length}):`); [...new Set(refusals)].slice(0, 10).forEach((r) => console.log(`    ${r}`)) }
}


// ===================== 2. behaviour and refusals =====================

console.log('--- behaviour and refusals ---')

const ok = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL  ${msg}`)
    fails++
  }
}

const fresh = () => createProject('T') as unknown as Project
const bodyOf = (p: Project) => p.pages[0]!.elements.find((n) => n.type === 'body')!
const write = (p: Project, html: string, def: any = null) => {
  const ctx = contextFromProject(p)
  const parsed = parseHtml(html, ctx.componentNames)
  const root = def ? def.root : bodyOf(p)
  const res = applyHtml(root, parsed.roots, { project: p, def, validate: ctx })
  return { ...res, errors: parsed.errors, notes: parsed.notes }
}
const ids = (n: ElementNode) => { const out: string[] = []; walkNodes([n], (x) => out.push(x.id)); return out }

// ---------- parser refusals ----------
{
  const p = fresh()
  const cases: [string, RegExp, string][] = [
    ['<script>alert(1)</script>', /never allowed/, '<script> refused'],
    ['<div onclick="x()" />', /event handlers/, 'on* handler refused'],
    ['<blink />', /unknown element/, 'unknown tag refused'],
    ['<div><span /></p>', /does not close/, 'mismatched close refused'],
    ['<div><span />', /never closed/, 'unclosed tag refused'],
    ['<div class="a" class="b" />', /written twice/, 'duplicate attribute refused'],
    ['<div class=a />', /must be quoted/, 'unquoted value refused'],
    ['<section>hello</section>', /container/, 'loose text in a container refused'],
    ['<style>x{}</style>', /never allowed/, '<style> refused'],
  ]
  for (const [html, re, label] of cases) {
    const parsed = parseHtml(html, [])
    const hit = parsed.errors.find((e) => re.test(e.message))
    ok(hit && hit.line >= 1 && hit.col >= 1, `${label} (${hit ? `${hit.line}:${hit.col}` : parsed.errors.map((e) => e.message).join('|') || 'no error'})`)
  }
  // caps
  ok(parseHtml('x'.repeat(2_000_001), []).errors[0]?.message.includes('the limit is'), 'input cap refused')
  let deep = ''
  for (let i = 0; i < 70; i++) deep += '<div>'
  ok(parseHtml(deep, []).errors.some((e) => /deeper than/.test(e.message)), 'depth cap refused')
  void p
}

// ---------- custom-code: raw HTML, escaped on read, never sanitized ----------
{
  const p = fresh()
  const code = '<script src="https://w.example/x.js"></script><div id="w"></div>'
  // a write with real tags inside: taken as written, the <script> never
  // reaching the tokenizer (it is a leaf's raw interior)
  const res = write(p, `<custom-code class="my-4">${code}</custom-code>`)
  ok(res.refused.length === 0 && res.errors.length === 0, `custom-code with real tags is accepted (${[...res.refused.map((r) => r.message), ...res.errors.map((e) => e.message)].join('|')})`)
  const node = bodyOf(p).children[0]!
  ok(node.type === 'custom-code' && node.content === code, 'and stored verbatim, unsanitized')
  // a read escapes it, so the echo carries no tag
  const html = pageToHtml(p.pages[0]!, p)
  ok(html.includes('&lt;script') && !html.includes('<script'), 'a read prints the code escaped')
  // the echo round-trips to the same bytes
  const before = JSON.stringify(bodyOf(p))
  const again = write(p, html.split('\n').slice(1, -1).join('\n'))
  ok(again.created === 0 && again.removed === 0 && JSON.stringify(bodyOf(p)) === before, 'and the echo is a no-op')
}

// ---------- parser leniency ----------
{
  ok(parseHtml('<img src="/media/x.png">', []).errors.length === 0, 'a void tag may omit the slash')
  const promoted = parseHtml('<div>Hello &amp; welcome</div>', [])
  ok(promoted.errors.length === 0 && promoted.roots[0]!.type === 'text', 'a <div> of plain text becomes a text block')
  const lower = parseHtml('<card />', ['Card'])
  ok(lower.roots[0]!.type === 'Card' && lower.notes.length === 1, 'a lowercase component resolves, with a note')
  ok(parseHtml('<!-- note --><div />', []).errors.length === 0, 'comments are dropped')
  const named = parseHtml('<Input><input /></Input>', ['Input'])
  ok(named.errors.length === 0 && named.roots[0]!.children.length === 1,
     'a component named Input is not the void <input>')
}

// ---------- adoption ----------
{
  // by id: the same document, reordered
  const p = fresh()
  write(p, '<section data-ref="a"><h2>One</h2></section><section data-ref="b"><h2>Two</h2></section>')
  const body = bodyOf(p)
  const before = ids(body)
  const html = pageToHtml(p.pages[0]!, p)
  const lines = html.split('\n')
  // swap the two sections, keeping their data-ids
  const reordered = [lines[0]!, ...lines.slice(4, 7), ...lines.slice(1, 4), lines[7]!].join('\n')
  const res = write(p, reordered)
  ok(res.created === 0 && res.removed === 0, `reordering by data-id adopts everything (created ${res.created})`)
  ok(ids(body).sort().join() === before.sort().join(), 'and keeps every id')
  ok(body.children[0]!.ref === 'b', 'in the new order')
}
{
  // by ref, with the ids stripped
  const p = fresh()
  write(p, '<section data-ref="a"><h2>One</h2></section>')
  const body = bodyOf(p)
  const kept = body.children[0]!.id
  const res = write(p, '<section data-ref="a"><h2>One</h2><p>added</p></section>')
  ok(res.created === 1 && res.removed === 0, `a ref adopts its node (created ${res.created})`)
  ok(body.children[0]!.id === kept, 'and the id survives')
}
{
  // by LCS: no ids, no refs, an element inserted in the middle
  const p = fresh()
  write(p, '<h2>A</h2><h3>B</h3><h4>C</h4>')
  const body = bodyOf(p)
  const before = body.children.map((n) => n.id)
  const res = write(p, '<h2>A</h2><p>new</p><h3>B</h3><h4>C</h4>')
  ok(res.created === 1 && res.removed === 0, `an insertion adopts the rest by LCS (created ${res.created}, removed ${res.removed})`)
  const after = body.children.map((n) => n.id)
  ok(after[0] === before[0] && after[2] === before[1] && after[3] === before[2],
     'and every survivor keeps its id')
}
{
  // a removal drops the bindings that pointed into it
  const p = fresh()
  write(p, '<section data-ref="keep" /><div data-ref="gone" />')
  const body = bodyOf(p)
  const gone = body.children[1]!
  body.children[0]!.interactions = [
    { id: 'b1', interactionId: 'i1', trigger: 'click', targetId: gone.id },
  ]
  const res = write(p, '<section data-ref="keep" />')
  ok(res.removed === 1, 'the dropped element is reported as removed')
  ok(!body.children[0]!.interactions, 'and the binding that pointed at it is gone')
}
{
  // B1: two different refs are two different elements. A `<div data-ref="new">`
  // sitting where `#old` sat must NOT adopt the old node — and with it the
  // old node's bindings — because the LCS paired them by position.
  const p = fresh()
  write(p, '<section data-ref="wrap"><div data-ref="old" /><p>t</p></section>')
  const body = bodyOf(p)
  const old = body.children[0]!.children[0]!
  old.animations = [{ id: 'a1', animationId: 'anim', trigger: 'load', targetId: old.id }]
  const res = write(p, '<section data-ref="wrap"><div data-ref="new" /><p>t</p></section>')
  const now = body.children[0]!.children[0]!
  ok(now.id !== old.id, 'a differing data-ref is not adopted by position')
  ok(res.created === 1 && res.removed === 1, `it is created new and the old one removed (created ${res.created}, removed ${res.removed})`)
  ok(!now.animations, 'so the old binding did not carry onto the new ref')
  ok(res.carried.length === 0, 'and nothing is reported as carried')
}
{
  // B1: an old ref against NO ref stays adoptable (dropping a name keeps the
  // node), and a positional adoption that kept bindings is REPORTED
  const p = fresh()
  write(p, '<section data-ref="wrap"><div data-ref="old" /><p>t</p></section>')
  const body = bodyOf(p)
  const old = body.children[0]!.children[0]!
  old.interactions = [{ id: 'b1', interactionId: 'i1', trigger: 'click', targetId: old.id }]
  const res = write(p, '<section data-ref="wrap"><div /><p>t</p></section>')
  const now = body.children[0]!.children[0]!
  ok(now.id === old.id, 'dropping the ref keeps the node')
  ok(res.carried.length === 1 && res.carried[0]!.id === old.id && res.carried[0]!.interactions === 1,
     `a positional adoption that kept bindings is reported in carried (${JSON.stringify(res.carried)})`)
  ok(res.carried[0]!.ref === undefined, 'with the ref as it is AFTER the write')
}
{
  // B1: a claim by ref is not "carried" — the agent named the node
  const p = fresh()
  write(p, '<div data-ref="a" />')
  const body = bodyOf(p)
  body.children[0]!.interactions = [{ id: 'b1', interactionId: 'i1', trigger: 'click', targetId: body.children[0]!.id }]
  const res = write(p, '<div data-ref="a" class="p-2" />')
  ok(res.kept === 1 && res.carried.length === 0, 'a ref claim is never reported as carried')
}

// ---------- components ----------
{
  const p = fresh()
  // a Card that holds a Button, written the way an agent writes one
  const defOf = (name: string) => ({ id: crypto.randomUUID(), name, root: { id: crypto.randomUUID(), type: name, content: '', children: [] } })
  const button = defOf('Button')
  p.components.push(button)
  write(p, '<button class="inline-flex h-9 items-center rounded-md px-4 text-sm"><span>Button</span></button>', button)
  const card = defOf('Card')
  p.components.push(card)
  write(p, '<div class="rounded-xl border p-6"><h3 class="text-lg font-semibold" /><p class="text-sm" /><Button /></div>', card)
  setStyleTokens(p.settings.tokens.map((t) => t.name))

  // one write lands three filled Cards
  write(p, '<Card data-ref="one" /><Card data-ref="two" /><Card data-ref="three" />')
  const body = bodyOf(p)
  ok(body.children.length === 3, `three instances from one write (${body.children.length})`)
  ok(body.children[0]!.children.length > 0, 'and each is materialized from the master')

  const html = pageToHtml(p.pages[0]!, p)
  ok(!/\bclass=/.test(html.split('<Card')[1] ?? ''), "an instance's interior shows no classes")

  // filling the parts
  const filled = html.replace(/<h3([^>]*)\/>/, '<h3$1>Filled heading</h3>')
  const res = write(p, filled)
  let found = 0
  walkNodes(body.children, (n) => { if (n.content === 'Filled heading') found++ })
  ok(res.refused.length === 0 && found === 1, `a part's text lands (refused ${res.refused.length}, found ${found})`)

  // a class inside an instance is refused, by name
  const styled = html.replace(/<h3/, '<h3 class="text-xl"')
  const res2 = write(p, styled)
  ok(res2.refused.some((r) => /renders nowhere/.test(r.message) && r.path.includes('Card')),
     `a class inside an instance is refused (${res2.refused[0]?.message.slice(0, 60) ?? 'none'})`)

  // an extra element inside an instance is refused, naming the count
  const extra = html.replace('</Card>', '  <p />\n</Card>')
  const res3 = write(p, extra)
  ok(res3.refused.some((r) => /part/.test(r.message) || /were written/.test(r.message)),
     `extra structure inside an instance is refused (${res3.refused[0]?.message.slice(0, 70) ?? 'none'})`)

  // the master round-trips through its own format
  const def = p.components.find((c) => c.name === 'Card')!
  const mHtml = masterToHtml(def, p)
  ok(/class=/.test(mHtml), 'a component read DOES show its classes')
  const before = JSON.stringify(def.root)
  const mRes = write(p, mHtml, def)
  ok(JSON.stringify(def.root) === before && !mRes.created && !mRes.removed,
     'and a master round-trip is a no-op')

  // a component may not hold itself
  const cycle = write(p, `${mHtml.split('\n')[0]!}\n  <Card />\n</Card>`, def)
  ok(cycle.refused.some((r) => /can't hold itself/.test(r.message)), 'a component cannot hold itself')
}

// ---------- the <slot> shorthand ----------
//
// An instance's interior has to match its master node for node, so filling a
// slot three levels down meant re-typing the component's whole skeleton on
// every page that used it — nine times for one funnel shell, each copy stale
// the moment the shell changed. `<Shell><slot>…</slot></Shell>` addresses the
// slot alone and leaves every other part as it was.
{
  const p = fresh()
  const defOf = (name: string) => ({
    id: crypto.randomUUID(),
    name,
    root: { id: crypto.randomUUID(), type: name, content: '', children: [] },
  })
  const shell = defOf('Shell')
  p.components.push(shell as never)
  write(
    p,
    '<div class="flex min-h-screen flex-col">' +
      '<header class="border-b"><span>Step 1 of 6</span></header>' +
      '<main data-slot class="flex-1"><p>default</p></main>' +
      '<footer class="border-t"><span>help</span></footer>' +
      '</div>',
    shell,
  )
  const slotOf = (def: any) => def.root.children[0].children[1]
  ok(slotOf(shell).slot === true, 'the master container is marked as a slot')

  // the shorthand: one child, and it fills the slot three levels down
  const res = write(p, '<Shell data-ref="s1"><slot><h1>Your goal</h1><p>Pick one</p></slot></Shell>')
  ok(res.refused.length === 0, `the shorthand is accepted (${res.refused[0]?.message ?? ''})`)
  const inst = bodyOf(p).children[0]!
  const filled = inst.children[0]!.children[1]!
  ok(
    filled.children.length === 2 && filled.children[0]!.type === 'h1',
    `the slot holds what was written (${filled.children.map((c) => c.type).join(',')})`,
  )
  // and NOTHING else moved: the skeleton around the slot is still the
  // master's, inherited rather than copied (an instance part carries no
  // content of its own, which is why a shadowed copy would be a bug)
  const skeleton = inst.children[0]!
  ok(
    skeleton.children.map((c) => c.type).join(',') === 'header,main,footer' &&
      !skeleton.children[0]!.children[0]!.content,
    `the skeleton around the slot is untouched (${skeleton.children.map((c) => c.type).join(',')})`,
  )

  // identity is carried across a second write, exactly as at any other level
  const keptId = filled.children[0]!.id
  const again = write(p, '<Shell data-ref="s1"><slot><h1>Your goal</h1><p>Pick two</p></slot></Shell>')
  ok(again.refused.length === 0 && filled.children[0]!.id === keptId, 'a re-write keeps the slot children')

  // a slot nobody can identify is refused, by name — never guessed at
  const plain = defOf('Plain')
  p.components.push(plain as never)
  write(p, '<div class="p-4"><span>x</span></div>', plain)
  const none = write(p, '<Plain><slot><h1>x</h1></slot></Plain>')
  ok(
    none.refused.some((r) => /has no slot/.test(r.message)),
    `a component with no slot refuses the shorthand (${none.refused[0]?.message.slice(0, 50) ?? 'none'})`,
  )

  const two = defOf('Two')
  p.components.push(two as never)
  write(p, '<div><div data-slot><p>a</p></div><div data-slot><p>b</p></div></div>', two)
  const ambiguous = write(p, '<Two><slot><h1>x</h1></slot></Two>')
  ok(
    ambiguous.refused.some((r) => /2 slots/.test(r.message)),
    `two slots refuse the shorthand rather than guessing (${ambiguous.refused[0]?.message.slice(0, 50) ?? 'none'})`,
  )

  // and <slot> is a marker, not an element: anywhere else it is refused rather
  // than stored as structure that renders nothing
  const loose = write(p, '<section><slot><h1>x</h1></slot></section>')
  ok(
    loose.refused.some((r) => /only fills a component instance/.test(r.message)),
    `a loose <slot> is refused (${loose.refused[0]?.message.slice(0, 50) ?? 'none'})`,
  )
  const mixed = write(p, '<Shell data-ref="s2"><div><slot><h1>x</h1></slot></div></Shell>')
  ok(mixed.refused.length > 0, 'a <slot> beside written-out parts is refused')

  // the READ still prints the real structure — the shorthand is write-only, so
  // a round-trip of a read is unaffected
  const html = pageToHtml(p.pages[0]!, p)
  ok(!/<slot/.test(html), 'a page read never emits <slot>')
}

// ---------- validation reaches the result ----------
{
  const p = fresh()
  const res = write(p, '<section data-ref="x" /><div data-ref="x" />')
  ok(res.diagnostics.some((d) => /already used/.test(d.message)), 'a duplicate ref is a diagnostic')
  const res2 = write(p, '<Nope />')
  ok(res2.diagnostics.some((d) => /Unknown component/.test(d.message)), 'an unknown component is a diagnostic')
  const res3 = write(p, '<collection-list source="nope"><h2 /></collection-list>')
  ok(res3.diagnostics.some((d) => /Unknown collection/.test(d.message)), 'an unknown collection is a diagnostic')
}

// ---------- a near miss on the binding attributes is refused, not absorbed ----------
{
  // `data-*` is authorable, so these used to land as a custom DOM attribute and
  // bind nothing while the write reported success — the exact bug class this
  // whole format exists to stop. Found by driving the toolset as an agent
  // would.
  const p = fresh()
  const res = write(p, '<collection-list data-source="post"><h2 /></collection-list>')
  ok(res.refused.some((r) => /binds nothing/.test(r.message) && /'source'/.test(r.message)),
     `data-source on a list is refused (${res.refused[0]?.message.slice(0, 70) ?? 'none'})`)
  const res2 = write(p, '<h2 data-source="title" />')
  ok(res2.refused.some((r) => /binds nothing/.test(r.message) && /data-field/.test(r.message)),
     `data-source on a leaf is refused (${res2.refused[0]?.message.slice(0, 70) ?? 'none'})`)
  const res3 = write(p, '<h2 field="title" /><p collection="post" />')
  ok(res3.refused.length === 2, `the other near misses too (${res3.refused.length}/2)`)
  // and the real ones still work
  const res4 = write(p, '<h2 data-field="title" />')
  ok(res4.refused.length === 0 && bodyOf(p).children[0]!.arg === 'title', 'data-field still binds')
}


// ---------- channels ----------
//
// `data-channel` is a CARRIED attribute, not a read-only annotation: a write
// can change it, so it has to round-trip, be refusable by name, and clear when
// the agent drops it. The corpus holds no channels, so the cases are built
// here on purpose.
{
  const p = fresh()
  const res = write(p, '<div data-channel="start" class="hidden" />')
  ok(res.refused.length === 0 && bodyOf(p).children[0]!.channel === 'start',
     `a channel lands (refused ${res.refused.length})`)

  // the read prints it, and writing the read back changes nothing
  const html = pageToHtml(p.pages[0]!, p)
  ok(/data-channel="start"/.test(html), 'and the read prints it')
  const before = JSON.stringify(bodyOf(p))
  const again = write(p, html.replace(/^<body[^>]*>\n/, '').replace(/\n<\/body>$/, ''))
  ok(JSON.stringify(bodyOf(p)) === before && !again.created && !again.removed,
     'a round-trip of a channel is a no-op')

  // dropping it clears it — the document is the whole truth
  write(p, '<div class="hidden" />')
  ok(bodyOf(p).children[0]!.channel === undefined, 'dropping data-channel clears it')

  // a bad name is refused rather than stored as an address nothing reaches
  const bad = write(p, '<div data-channel="Start Modal" />')
  ok(bad.refused.some((r) => /not a channel name/.test(r.message)),
     `a bad channel name is refused (${bad.refused[0]?.message.slice(0, 60) ?? 'none'})`)

  // and it can never arrive as a custom attribute
  const reserved = write(p, '<p data-channel-x="1" />')
  ok(reserved.refused.length === 0, 'a lookalike data-* is still authorable')
}

// ---------- a channel on an instance wrapper is refused ----------
{
  const p = fresh()
  const def = { id: crypto.randomUUID(), name: 'Modal', root: { id: crypto.randomUUID(), type: 'Modal', content: '', children: [] } }
  p.components.push(def as never)
  write(p, '<div class="fixed inset-0 hidden" data-channel="start"><p>Hi</p></div>', def)
  ok((def.root as never as ElementNode).children[0]!.channel === 'start',
     'a master declares the channel')

  write(p, '<Modal data-ref="m" />')
  const html = pageToHtml(p.pages[0]!, p)
  // an instance's interior shows a node's OWN values only, never what it
  // inherits — the channel is the component's, exactly like its classes
  ok(!/data-channel/.test(html.split('<Modal')[1] ?? ''),
     "an instance's interior does not print the component's channel")
  const echo = write(p, html.replace(/^<body[^>]*>\n/, '').replace(/\n<\/body>$/, ''))
  ok(echo.refused.length === 0, `and the round-trip is clean (refused ${echo.refused.length})`)
  // writing one there is the component's business
  const changed = write(
    p,
    (html.replace(/^<body[^>]*>\n/, '').replace(/\n<\/body>$/, '')).replace('<div', '<div data-channel="other"'),
  )
  ok(changed.refused.some((r) => /update_component/.test(r.message)),
     `changing a channel inside an instance is refused (${changed.refused[0]?.message.slice(0, 60) ?? 'none'})`)
  // on the wrapper itself it renders nowhere
  const onWrapper = write(p, '<Modal data-ref="m" data-channel="start" />')
  ok(onWrapper.refused.some((r) => /emits no element/.test(r.message)),
     `a channel on an instance wrapper is refused (${onWrapper.refused[0]?.message.slice(0, 60) ?? 'none'})`)
}


console.log(fails ? `\n${fails} FAILURES` : `\nHTML layer OK`)
process.exit(fails ? 1 : 0)
