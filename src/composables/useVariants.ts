import { computed, effectScope, ref, watch } from 'vue'
import { useComponentBoard } from './useComponentBoard'
import { useComponents } from './useComponents'
import { useElement } from './useElement'
import { effectiveClasses, variantKey } from '@/lib/variants'
import type { InstanceMapping } from '@/lib/instances'
import { walkNodes } from '@/lib/tree'
import type { ComponentDef, ElementNode } from '@/types/editor'

/**
 * Variants in the editor: which options a board card is SHOWING, and which
 * layer the Style panel is WRITING.
 *
 * Both are runtime-only, never on the document. A card's preview picks in
 * particular must not be: the board promotes a library preview into the
 * project the moment its JSON changes, so parking view state on the def would
 * copy a component into the project for flipping a select.
 */

/** component id → the option each axis is previewing on the board */
const previewPicks = ref<Record<string, Record<string, string>>>({})

/** the layer the Style panel writes: `'<axis>:<option>'`, or null for the
 *  base classes every option shares */
const activeLayer = ref<string | null>(null)

const { cards, boardActive } = useComponentBoard()

/** on the board a master node renders directly, with no instance to take its
 *  picks from — so which component owns it has to be looked up */
const boardOwners = computed(() => {
  const owners = new Map<string, ComponentDef>()
  if (!boardActive.value) return owners
  for (const card of cards.value) {
    if (!card.def.variants?.length) continue
    walkNodes([card.def.root], (n) => owners.set(n.id, card.def))
  }
  return owners
})

/** the picks a card previews, defaults filled in */
function picksOnBoard(def: ComponentDef): Record<string, string> {
  const chosen = previewPicks.value[def.id] ?? {}
  const picks: Record<string, string> = {}
  for (const axis of def.variants ?? []) {
    const pick = chosen[axis.name]
    picks[axis.name] = pick !== undefined && axis.options.includes(pick) ? pick : axis.default
  }
  return picks
}

function setPreviewPick(def: ComponentDef, axis: string, option: string) {
  previewPicks.value = {
    ...previewPicks.value,
    [def.id]: { ...(previewPicks.value[def.id] ?? {}), [axis]: option },
  }
}

/**
 * Wear an option: the one the board was just pointed at. It becomes the layer
 * the Style panel writes — the option's own overrides, or the base classes
 * when it is the axis default, which is what the base looks like.
 */
function wear(def: ComponentDef, axis: string, option: string) {
  // exactly what that drawing shows — not this option on top of whatever was
  // pointed at before, or the panel would describe a look nothing on screen has
  previewPicks.value = { ...previewPicks.value, [def.id]: picksFor(def, axis, option) }
  drawing.value = { ...drawing.value, [def.id]: variantKey(axis, option) }
  const isDefault = def.variants?.find((a) => a.name === axis)?.default === option
  activeLayer.value = isDefault ? null : variantKey(axis, option)
  wornFor = def.id
}

/** the component `activeLayer` was last set for */
let wornFor: string | null = null

/** component id → the drawing last pointed at, as `'<axis>:<option>'` */
const drawing = ref<Record<string, string>>({})

/** the drawing of a component that is being edited: the one last pointed at,
 *  else its first — so a selection made from the drawer outlines somewhere */
function activeDrawing(def: ComponentDef): string | null {
  const first = def.variants?.[0]
  if (!first) return null
  const known = drawing.value[def.id]
  const [axis, option] = (known ?? '').split(':')
  const valid = def.variants?.some((a) => a.name === axis && a.options.includes(option ?? ''))
  return valid ? known! : variantKey(first.name, first.default)
}

/** what one drawing wears: its own option, and the default everywhere else —
 *  so each drawing shows exactly one thing, whatever was clicked last */
function picksFor(def: ComponentDef, axis: string, option: string): Record<string, string> {
  const picks: Record<string, string> = {}
  for (const a of def.variants ?? []) picks[a.name] = a.name === axis ? option : a.default
  return picks
}

/**
 * The component and picks that decide what `node` wears: its instance's when
 * it is inside one, its card's when it is a master node on the board, and
 * nothing for a plain page element. `shown` is what the drawing `node` is part
 * of wears, when the board draws the component once per option.
 */
function variantContext(
  node: ElementNode,
  mapping: InstanceMapping | null,
  shown?: Record<string, string> | null,
): { def: ComponentDef; master: ElementNode; picks: Record<string, string> } | null {
  if (mapping) return { def: mapping.def, master: mapping.master, picks: mapping.picks }
  const def = boardOwners.value.get(node.id)
  return def ? { def, master: node, picks: shown ?? picksOnBoard(def) } : null
}

/** the classes an element wears, variants applied */
function classesFor(
  node: ElementNode,
  mapping: InstanceMapping | null,
  shown?: Record<string, string> | null,
): string {
  const ctx = variantContext(node, mapping, shown)
  if (!ctx) return node.classes ?? ''
  return effectiveClasses(ctx.master, ctx.def, ctx.picks)
}

// a layer belongs to a component: selecting into ANOTHER one starts from its
// base — unless that selection is the very click that wore an option there
let watching = false
function watchSelection() {
  if (watching) return
  watching = true
  const { selectedElement } = useElement()
  const { masterFor } = useComponents()
  effectScope(true).run(() => {
    watch(
      () => {
        const node = selectedElement.value
        return node ? (variantContext(node, masterFor(node.id))?.def.id ?? null) : null
      },
      (defId) => {
        if (defId !== wornFor) activeLayer.value = null
      },
    )
  })
}

export function useVariants() {
  const { selectedElement } = useElement()
  const { masterFor } = useComponents()
  watchSelection()

  /** what the current selection's component offers the Style panel */
  const selectionContext = computed(() => {
    const node = selectedElement.value
    return node ? variantContext(node, masterFor(node.id)) : null
  })

  /** the layers the Style panel can write for the selection: the option each
   *  axis is currently WEARING. To edit another option, wear it first — a
   *  layer nobody can see being edited is how a panel ends up lying. */
  const layerOptions = computed(() => {
    const ctx = selectionContext.value
    if (!ctx?.def.variants?.length) return []
    return ctx.def.variants.map((axis) => {
      const option = ctx.picks[axis.name] ?? axis.default
      return { key: variantKey(axis.name, option), axis: axis.name, option }
    })
  })

  /** the active layer, if the selection still offers it */
  const layer = computed(() =>
    layerOptions.value.some((l) => l.key === activeLayer.value) ? activeLayer.value : null,
  )

  return {
    previewPicks,
    activeLayer,
    layer,
    layerOptions,
    selectionContext,
    picksOnBoard,
    picksFor,
    activeDrawing,
    setPreviewPick,
    wear,
    variantContext,
    classesFor,
  }
}

export { classesFor as variantClassesFor }
