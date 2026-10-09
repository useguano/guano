import type { ComponentDef, ElementNode } from '@/types/editor'
import { mergeClassLayers } from './styles'

export const variantKey = (axis: string, option: string) => `${axis}:${option}`

export const VARIANT_NAME_RE = /^[a-z][a-z0-9-]*$/

export function pickedKeys(def: ComponentDef | undefined, picks: Record<string, string>): string[] {
  return (def?.variants ?? []).map((axis) =>
    variantKey(axis.name, axis.options.includes(picks[axis.name] ?? '') ? picks[axis.name]! : axis.default),
  )
}

export function effectiveClasses(
  node: ElementNode,
  def: ComponentDef | undefined,
  picks: Record<string, string>,
): string {
  const base = node.classes ?? ''
  const overrides = node.variantClasses
  if (!overrides || !def?.variants?.length) return base
  return mergeClassLayers(base, ...pickedKeys(def, picks).map((key) => overrides[key]))
}
