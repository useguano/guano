import type { ComponentDef, ElementNode, Page, Project } from '@/types/editor'
import { alignStructure, isComponentType } from './components'
import { createBody } from './factories'
import { ALIAS_OF } from './html/tags'
import { parseLegacyCode } from './legacy/dsl'
import { walkNodes } from './tree'

export const SCHEMA_VERSION = 2

type V1Node = ElementNode & { line?: number; endLine?: number }
type V1Page = Page & { code?: string }

export interface MigrationReport {
  changed: boolean
  from: number
  pages: number
  collapsed: Record<string, number>
  materialized: number

  salvaged: string[]

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
    report.collapsed[node.type] = (report.collapsed[node.type] ?? 0) + 1
    node.type = target
  }

  const dropDsl = (node: ElementNode) => {
    collapse(node)
    delete (node as V1Node).line
    delete (node as V1Node).endLine
  }

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
