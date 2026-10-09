import type { ComponentDef, ElementNode, Project, VariantAxis } from '@/types/editor'
import { setComponentMeta } from './componentOps'
import { VARIANT_NAME_RE, variantKey } from './variants'
import { walkNodes } from './tree'
import { resolvePicks } from './shared/instances.js'

export type VariantResult = { ok: true } | { ok: false; error: string }

const fail = (error: string): VariantResult => ({ ok: false, error })
const OK: VariantResult = { ok: true }

interface Renames {
  axes?: Record<string, string>
  options?: Record<string, Record<string, string>>
}

function nameError(kind: 'axis' | 'option', name: string): string | null {
  if (VARIANT_NAME_RE.test(name)) return null
  return `An ${kind} name is lowercase letters, digits and dashes, starting with a letter`
}

function instancesOf(project: Project, def: ComponentDef): ElementNode[] {
  const out: ElementNode[] = []
  const collect = (nodes: ElementNode[]) =>
    walkNodes(nodes, (n) => {
      if (n.type === def.name) out.push(n)
    })
  for (const page of project.pages) collect(page.elements)
  for (const other of project.components) if (other !== def) collect(other.root.children)
  return out
}

function rewrite(project: Project, def: ComponentDef, next: VariantAxis[], renames: Renames = {}) {
  const before = def.variants ?? []
  const oldAxisName = (axis: string) => renames.axes?.[axis] ?? axis
  const oldOptionName = (axis: string, option: string) => renames.options?.[axis]?.[option] ?? option

  setComponentMeta(def, { category: def.category, variants: next })

  walkNodes([def.root], (node) => {
    const old = node.variantClasses
    if (!old) return
    const kept: Record<string, string> = {}
    for (const axis of next) {
      for (const option of axis.options) {
        const classes = old[variantKey(oldAxisName(axis.name), oldOptionName(axis.name, option))]?.trim()
        if (classes) kept[variantKey(axis.name, option)] = classes
      }
    }
    if (Object.keys(kept).length) node.variantClasses = kept
    else delete node.variantClasses
  })

  for (const instance of instancesOf(project, def)) {
    const old = instance.variants ?? {}
    const kept: Record<string, string> = {}
    for (const axis of next) {
      const was = before.find((a) => a.name === oldAxisName(axis.name))
      const wore = was ? (old[was.name] ?? was.default) : undefined
      const now = axis.options.find((option) => oldOptionName(axis.name, option) === wore)
      if (now !== undefined && now !== axis.default) kept[axis.name] = now
    }
    if (Object.keys(kept).length) instance.variants = kept
    else delete instance.variants
  }
}

const axesOf = (def: ComponentDef): VariantAxis[] =>
  (def.variants ?? []).map((a) => ({ name: a.name, options: [...a.options], default: a.default }))

export function addVariantAxis(
  project: Project,
  def: ComponentDef,
  name: string,
  options: string[] = ['default'],
): VariantResult {
  const axes = axesOf(def)
  const bad = nameError('axis', name) ?? options.map((o) => nameError('option', o)).find(Boolean)
  if (bad) return fail(bad)
  if (axes.some((a) => a.name === name)) return fail(`This component already has a "${name}" axis`)
  if (!options.length) return fail('An axis needs at least one option')
  if (new Set(options).size !== options.length) return fail('Option names must be unique')
  rewrite(project, def, [...axes, { name, options: [...options], default: options[0]! }])
  return OK
}

export function renameVariantAxis(
  project: Project,
  def: ComponentDef,
  from: string,
  to: string,
): VariantResult {
  const axes = axesOf(def)
  const axis = axes.find((a) => a.name === from)
  if (!axis) return fail(`No "${from}" axis`)
  if (from === to) return OK
  const bad = nameError('axis', to)
  if (bad) return fail(bad)
  if (axes.some((a) => a.name === to)) return fail(`This component already has a "${to}" axis`)
  axis.name = to
  rewrite(project, def, axes, { axes: { [to]: from } })
  return OK
}

export function removeVariantAxis(project: Project, def: ComponentDef, name: string): VariantResult {
  const axes = axesOf(def)
  if (!axes.some((a) => a.name === name)) return fail(`No "${name}" axis`)
  rewrite(
    project,
    def,
    axes.filter((a) => a.name !== name),
  )
  return OK
}

export function addVariantOption(
  project: Project,
  def: ComponentDef,
  axisName: string,
  option: string,
): VariantResult {
  const axes = axesOf(def)
  const axis = axes.find((a) => a.name === axisName)
  if (!axis) return fail(`No "${axisName}" axis`)
  const bad = nameError('option', option)
  if (bad) return fail(bad)
  if (axis.options.includes(option)) return fail(`"${axisName}" already has a "${option}" option`)
  axis.options.push(option)
  rewrite(project, def, axes)
  return OK
}

export function renameVariantOption(
  project: Project,
  def: ComponentDef,
  axisName: string,
  from: string,
  to: string,
): VariantResult {
  const axes = axesOf(def)
  const axis = axes.find((a) => a.name === axisName)
  if (!axis || !axis.options.includes(from)) return fail(`No "${from}" option on "${axisName}"`)
  if (from === to) return OK
  const bad = nameError('option', to)
  if (bad) return fail(bad)
  if (axis.options.includes(to)) return fail(`"${axisName}" already has a "${to}" option`)
  axis.options = axis.options.map((o) => (o === from ? to : o))
  if (axis.default === from) axis.default = to
  rewrite(project, def, axes, { options: { [axisName]: { [to]: from } } })
  return OK
}

export function removeVariantOption(
  project: Project,
  def: ComponentDef,
  axisName: string,
  option: string,
): VariantResult {
  const axes = axesOf(def)
  const axis = axes.find((a) => a.name === axisName)
  if (!axis || !axis.options.includes(option)) return fail(`No "${option}" option on "${axisName}"`)
  if (axis.options.length === 1) return fail('An axis needs at least one option — remove the axis instead')
  axis.options = axis.options.filter((o) => o !== option)
  if (axis.default === option) axis.default = axis.options[0]!
  rewrite(project, def, axes)
  return OK
}

export function setVariantDefault(
  project: Project,
  def: ComponentDef,
  axisName: string,
  option: string,
): VariantResult {
  const axes = axesOf(def)
  const axis = axes.find((a) => a.name === axisName)
  if (!axis || !axis.options.includes(option)) return fail(`No "${option}" option on "${axisName}"`)
  axis.default = option
  rewrite(project, def, axes)
  return OK
}

export function setVariantAxes(project: Project, def: ComponentDef, axes: VariantAxis[]): VariantResult {
  const seen = new Set<string>()
  for (const axis of axes) {
    const bad =
      nameError('axis', axis.name) ?? axis.options.map((o) => nameError('option', o)).find(Boolean)
    if (bad) return fail(bad)
    if (seen.has(axis.name)) return fail(`Two axes are named "${axis.name}"`)
    seen.add(axis.name)
    if (!axis.options.length) return fail(`"${axis.name}" needs at least one option`)
    if (new Set(axis.options).size !== axis.options.length) {
      return fail(`"${axis.name}" has two options with the same name`)
    }
    if (!axis.options.includes(axis.default)) {
      return fail(`"${axis.name}": the default "${axis.default}" is not one of its options`)
    }
  }
  rewrite(project, def, axes)
  return OK
}

export function setInstancePick(
  def: ComponentDef,
  wrapper: ElementNode,
  axisName: string,
  option: string | null,

  mirrors: ElementNode[] = [],
): VariantResult {
  const axis = def.variants?.find((a) => a.name === axisName)
  if (!axis) return fail(`"${def.name}" has no "${axisName}" axis`)
  if (option !== null && !axis.options.includes(option)) {
    return fail(`"${axisName}" has no "${option}" option — it has ${axis.options.join(', ')}`)
  }
  const picks = { ...(wrapper.variants ?? {}) }
  const inherited = (resolvePicks(def, { variants: {} }, mirrors) as Record<string, string>)[axisName]
  if (option === null || option === inherited) delete picks[axisName]
  else picks[axisName] = option
  const kept: Record<string, string> = {}
  for (const a of def.variants ?? []) if (picks[a.name] !== undefined) kept[a.name] = picks[a.name]!
  if (Object.keys(kept).length) wrapper.variants = kept
  else delete wrapper.variants
  return OK
}

export function setVariantClasses(
  def: ComponentDef,
  node: ElementNode,
  key: string,
  classes: string,
): void {
  const next = { ...(node.variantClasses ?? {}), [key]: classes.trim() }
  const kept: Record<string, string> = {}
  for (const axis of def.variants ?? []) {
    for (const option of axis.options) {
      const k = variantKey(axis.name, option)
      if (next[k]) kept[k] = next[k]
    }
  }
  if (Object.keys(kept).length) node.variantClasses = kept
  else delete node.variantClasses
}
