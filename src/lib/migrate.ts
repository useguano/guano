import type { ComponentDef, ElementNode, Page, Project } from '@/types/editor'
import { alignStructure, isComponentType } from './components'
import { createBody } from './factories'
import { ALIAS_OF } from './html/tags'
import { parseLegacyCode } from './legacy/dsl'
import { walkNodes } from './tree'

/**
 * The v2 schema: the tree is the only source of truth.
 *
 * v1 carried the indentation DSL beside it — `page.code`, plus a `line` and
 * `endLine` on every node — because the text was authoritative for structure.
 * Nothing reads any of it now, so v2
 * drops it, and with it the pure alias types the DSL's registry carried.
 *
 * This runs ONCE per blob, on the server at boot, over every project blob in
 * the store: the drafts, Main, the `guano-base:*` merge snapshots (which are
 * whole project copies, so a 3-way merge against an unmigrated base would see
 * every page as changed) and the published baseline. It is also applied
 * client-side as a defensive no-op and to anything `/api/project-import`
 * brings in.
 *
 * It is IDEMPOTENT: a project already at v2 is returned untouched, which is
 * what makes "run it on everything, every boot" safe.
 */

export const SCHEMA_VERSION = 2

/**
 * The v1 fields, which the current types no longer carry.
 *
 * The migration's INPUT is a v1 blob, so it is the one place that has to see
 * them. Spelled out here rather than kept in `Page`/`ElementNode`, where every
 * other file would see them too and the deletion would not be real.
 */
type V1Node = ElementNode & { line?: number; endLine?: number }
type V1Page = Page & { code?: string }

export interface MigrationReport {
  /** did anything change? (false for a project already at v2) */
  changed: boolean
  from: number
  pages: number
  /** nodes whose alias type was collapsed, by the type they were */
  collapsed: Record<string, number>
  /** instances that were still an unexpanded leaf and had to be materialized */
  materialized: number
  /** pages whose stored tree had to be SALVAGED from the DSL text — this
   *  should always be empty, and the legacy parser exists only for it */
  salvaged: string[]
  /** pages whose stored text disagreed with the stored tree. The tree wins
   *  (it is what every renderer read), so this is a record, not a problem. */
  textDisagreed: string[]
}

const emptyReport = (): MigrationReport => ({
  changed: false,
  from: 1,
  pages: 0,
  collapsed: {},
  materialized: 0,
  salvaged: [],
  textDisagreed: [],
})

/**
 * Migrate a project in place. Returns the same object, plus a report.
 *
 * Pass `pageToCode` to have the migration compare each page's stored text
 * against the text its tree implies and record the pages that disagree. That
 * is the only reason it would ever want the old serializer, so the caller
 * supplies it rather than this module importing a thing it is deleting.
 */
export function migrateProject(
  project: Project,
  opts: { pageToCode?: (page: Page, locale: string) => string } = {},
): { project: Project; report: MigrationReport } {
  const report = emptyReport()
  if (!project || !Array.isArray(project.pages)) return { project, report }
  report.from = project.schemaVersion ?? 1
  if (report.from >= SCHEMA_VERSION) return { project, report }

  const components: ComponentDef[] = project.components ?? []
  const byName = new Map<string, ComponentDef>()
  for (const def of components) if (!byName.has(def.name)) byName.set(def.name, def)

  const collapse = (node: ElementNode) => {
    const target = ALIAS_OF[node.type]
    if (!target) return
    // the alias and its target render the same tag and the same shape, which
    // is why the corpus can prove this changes nothing; the alias existed
    // only to give the insert dock two names for a div
    report.collapsed[node.type] = (report.collapsed[node.type] ?? 0) + 1
    node.type = target
  }

  const dropDsl = (node: ElementNode) => {
    collapse(node)
    delete (node as V1Node).line
    delete (node as V1Node).endLine
  }

  /** an instance that was never materialized (a stored `:Card:` leaf) has no
   *  nodes at all — nothing ever expanded it, so it rendered as nothing */
  const materialize = (node: ElementNode) => {
    if (!isComponentType(node.type) || node.children.length) return
    const def = byName.get(node.type)
    if (!def?.root.children.length) return
    alignStructure(node, def.root)
    report.materialized++
  }

  for (const page of project.pages as V1Page[]) {
    report.pages++
    let body: ElementNode | undefined = (page.elements ?? []).find((n) => n.type === 'body')
    if (!body) {
      // SALVAGE: a page with text but no usable tree. See legacy/dsl.ts — this
      // should never fire, and the parser lives only for the case where it does.
      const salvaged = page.code ? parseLegacyCode(page.code) : []
      body = salvaged.find((n) => n.type === 'body')
      if (body) {
        page.elements = [body]
        report.salvaged.push(page.name || page.id)
      } else {
        body = createBody()
        page.elements = [body]
        report.salvaged.push(`${page.name || page.id} (empty)`)
      }
    } else if (page.elements.length > 1) {
      // only the body is a root; anything else was never rendered
      page.elements = [body]
    }

    if (opts.pageToCode && page.code) {
      const implied = opts.pageToCode(page, project.defaultLocale || 'en')
      if (implied !== page.code) report.textDisagreed.push(page.name || page.id)
    }

    walkNodes([body], materialize)
    walkNodes([body], dropDsl)
    delete page.code
  }

  for (const def of components) walkNodes([def.root], dropDsl)

  project.schemaVersion = SCHEMA_VERSION
  report.changed = true
  return { project, report }
}

/** a one-line summary for a boot log */
export function describeMigration(key: string, report: MigrationReport): string | null {
  if (!report.changed) return null
  const bits = [`${report.pages} page${report.pages === 1 ? '' : 's'}`]
  const collapsed = Object.entries(report.collapsed)
  if (collapsed.length) {
    bits.push(`collapsed ${collapsed.map(([t, n]) => `${n}×${t}`).join(', ')}`)
  }
  if (report.materialized) bits.push(`materialized ${report.materialized} instance(s)`)
  if (report.textDisagreed.length) {
    bits.push(`${report.textDisagreed.length} page(s) whose stored DSL disagreed with the tree (the tree wins)`)
  }
  if (report.salvaged.length) bits.push(`SALVAGED from DSL: ${report.salvaged.join(', ')}`)
  return `${key}: v${report.from} → v${SCHEMA_VERSION} — ${bits.join('; ')}`
}
