import { computed, onBeforeUnmount, ref } from 'vue'
import { useProject } from './useProject'
import { setSelectionScope, useElement } from './useElement'
import { findNode } from '@/lib/tree'
import type { ComponentDef } from '@/types/editor'

export const UNCATEGORIZED = 'Uncategorized'

export interface BoardCard {
  key: string
  def: ComponentDef
  category: string
}

const focusRequest = ref<{ key: string; tick: number } | null>(null)

const focusedKey = ref<string | null>(null)

const boardActive = ref(false)

export function focusCard(key: string) {
  focusRequest.value = { key, tick: (focusRequest.value?.tick ?? 0) + 1 }
  focusedKey.value = key
}

export function useComponentBoard() {
  const { project } = useProject()
  const { selectedElement } = useElement()

  const cards = computed<BoardCard[]>(() =>
    project.value.components.map((def) => ({
      key: def.id,
      def,
      category: def.category?.trim() || UNCATEGORIZED,
    })),
  )

  const groups = computed<{ name: string; cards: BoardCard[] }[]>(() => {
    const byName = new Map<string, BoardCard[]>()
    for (const card of cards.value) {
      const list = byName.get(card.category)
      if (list) list.push(card)
      else byName.set(card.category, [card])
    }
    const rank = (name: string) => (name === UNCATEGORIZED ? 1 : 0)
    return [...byName.entries()]
      .map(([name, list]) => ({ name, cards: list }))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  })

  const activeCard = computed<BoardCard | null>(() => {
    const selected = selectedElement.value
    if (selected) {
      const owner = cards.value.find((c) => !!findNode([c.def.root], selected.id))
      if (owner) return owner
    }
    return cards.value.find((c) => c.key === focusedKey.value) ?? null
  })

  return { cards, groups, focusRequest, focusedKey, activeCard, boardActive }
}

export function useComponentBoardSession() {
  const { cards } = useComponentBoard()
  boardActive.value = true

  setSelectionScope(() => cards.value.map((c) => c.def.root))

  onBeforeUnmount(() => {
    boardActive.value = false
    focusedKey.value = null
    setSelectionScope(null)
  })
}
