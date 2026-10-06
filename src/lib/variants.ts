import type { ComponentDef, ElementNode } from '@/types/editor'
import { mergeClassLayers } from './styles'

/**
 * Variants — how one component's instances differ in look.
 *
 * A component declares axes (`variant`, `size`); each master node may carry
 * class overrides per option (`node.variantClasses['size:sm']`); an instance
 * picks one option per axis (`node.variants` on its wrapper). What an element
 * wears is its base classes with the picked options layered on, in axis order.
 *
 * Which options an instance picks is resolved with the rest of its chain, in
 * `shared/instances.js`. This module is the other half — turning picks into a
 * class string — and lives in TS because it needs the full style catalog. It
 * is bundled into the MCP runtime, which is also where the exporter gets it.
 */

/** the key an option's overrides are stored under on a master node */
export const variantKey = (axis: string, option: string) => `${axis}:${option}`

/** the name rule for an axis or an option: what reads well in a key and a select */
export const VARIANT_NAME_RE = /^[a-z][a-z0-9-]*$/

/** the option `picks` selects on each of a component's axes, defaults filled in */
export function pickedKeys(def: ComponentDef | undefined, picks: Record<string, string>): string[] {
  return (def?.variants ?? []).map((axis) =>
    variantKey(axis.name, axis.options.includes(picks[axis.name] ?? '') ? picks[axis.name]! : axis.default),
  )
}

/**
 * The classes a master node wears for an instance with these picks. A node
 * with no overrides — most of them — costs nothing.
 */
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
