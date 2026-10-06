import { computed, onBeforeUnmount, ref } from 'vue'
import { useProject } from './useProject'
import { setSelectionScope, useElement } from './useElement'
import { findNode } from '@/lib/tree'
import type { ComponentDef } from '@/types/editor'

/**
 * The components board: what the canvas shows while the Components column is
 * open. Every component of the project is on it, once, in its own card.
 */

export const UNCATEGORIZED = 'Uncategorized'

export interface BoardCard {
  /** the component id */
  key: string
  def: ComponentDef
  category: string
}

/** the drawer asks the board to bring a card into view */
const focusRequest = ref<{ key: string; tick: number } | null>(null)

/** the card the user is working in — set by focusing one, and by selecting
 *  any element inside one */
const focusedKey = ref<string | null>(null)

/** true while the board is on the canvas. What decides that structural edits
 *  target a component master rather than the page — derived from the session
 *  actually being mounted, not from the view mode, so there is no render where
 *  the two disagree. */
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

  /** cards by category, alphabetically, Uncategorized last */
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

  /** the component being edited: whichever card owns the selection, else the
   *  focused one */
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

/**
 * Everything that must hold only WHILE the board is on the canvas. Call from
 * the board component's setup: it tears itself down on unmount.
 */
export function useComponentBoardSession() {
  const { cards } = useComponentBoard()
  boardActive.value = true

  // selection resolves against the component masters instead of the page, so
  // Style / Data / Interactions edit a master node like any page node
  setSelectionScope(() => cards.value.map((c) => c.def.root))

  onBeforeUnmount(() => {
    boardActive.value = false
    focusedKey.value = null
    setSelectionScope(null)
  })
}
