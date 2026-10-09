import { computed, effectScope, ref, watch } from 'vue'
import { useComponentBoard } from './useComponentBoard'
import { useComponents } from './useComponents'
import { useElement } from './useElement'
import { effectiveClasses, variantKey } from '@/lib/variants'
import type { InstanceMapping } from '@/lib/instances'
import { walkNodes } from '@/lib/tree'
import type { ComponentDef, ElementNode } from '@/types/editor'

const previewPicks = ref<Record<string, Record<string, string>>>({})

const activeLayer = ref<string | null>(null)

const { cards, boardActive } = useComponentBoard()

const boardOwners = computed(() => {
  const owners = new Map<string, ComponentDef>()
  if (!boardActive.value) return owners
  for (const card of cards.value) {
    if (!card.def.variants?.length) continue
    walkNodes([card.def.root], (n) => owners.set(n.id, card.def))
  }
  return owners
})

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

function wear(def: ComponentDef, axis: string, option: string) {
  previewPicks.value = { ...previewPicks.value, [def.id]: picksFor(def, axis, option) }
  drawing.value = { ...drawing.value, [def.id]: variantKey(axis, option) }
  const isDefault = def.variants?.find((a) => a.name === axis)?.default === option
  activeLayer.value = isDefault ? null : variantKey(axis, option)
  wornFor = def.id
}

let wornFor: string | null = null

const drawing = ref<Record<string, string>>({})

function activeDrawing(def: ComponentDef): string | null {
  const first = def.variants?.[0]
  if (!first) return null
  const known = drawing.value[def.id]
  const [axis, option] = (known ?? '').split(':')
  const valid = def.variants?.some((a) => a.name === axis && a.options.includes(option ?? ''))
  return valid ? known! : variantKey(first.name, first.default)
}

function picksFor(def: ComponentDef, axis: string, option: string): Record<string, string> {
  const picks: Record<string, string> = {}
  for (const a of def.variants ?? []) picks[a.name] = a.name === axis ? option : a.default
  return picks
}

function variantContext(
  node: ElementNode,
  mapping: InstanceMapping | null,
  shown?: Record<string, string> | null,
): { def: ComponentDef; master: ElementNode; picks: Record<string, string> } | null {
  if (mapping) return { def: mapping.def, master: mapping.master, picks: mapping.picks }
  const def = boardOwners.value.get(node.id)
  return def ? { def, master: node, picks: shown ?? picksOnBoard(def) } : null
}

function classesFor(
  node: ElementNode,
  mapping: InstanceMapping | null,
  shown?: Record<string, string> | null,
): string {
  const ctx = variantContext(node, mapping, shown)
  if (!ctx) return node.classes ?? ''
  return effectiveClasses(ctx.master, ctx.def, ctx.picks)
}

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

  const selectionContext = computed(() => {
    const node = selectedElement.value
    return node ? variantContext(node, masterFor(node.id)) : null
  })

  const layerOptions = computed(() => {
    const ctx = selectionContext.value
    if (!ctx?.def.variants?.length) return []
    return ctx.def.variants.map((axis) => {
      const option = ctx.picks[axis.name] ?? axis.default
      return { key: variantKey(axis.name, option), axis: axis.name, option }
    })
  })

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
