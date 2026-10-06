import { computed, ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

// Content editing on the Play render, for CONTRIBUTORS only. A contributor is
// pinned to Play (useViewMode), so this is where they change a page's copy and
// images; for an admin or editor Play stays the site as a visitor gets it, and
// content is edited on the Edit canvas. Shared across the recursive
// PreviewRenderer instances and SitePreview's "Edit content" menu.
//
// Only content is reachable from here — text, media src, background media —
// which is exactly what the server's contributor merge keeps.

/** what a menu item asks a renderer to do */
export type PreviewEditKind = 'content' | 'background'

export interface PreviewMenuState {
  x: number
  y: number
  nodeId: string
  /** text or media the node can edit in place */
  content: boolean
  /** a background the node can replace */
  background: boolean
}

// the open "Edit content" context menu, or null
const menu = ref<PreviewMenuState | null>(null)
// a node id (and action) whose renderer instance should begin editing — the
// context-menu path; double-click edits directly
const editRequest = ref<{ nodeId: string; kind: PreviewEditKind } | null>(null)

export function usePreviewEditing() {
  const { canBuild, canEditContent } = useAuth()
  /** whether Play edits content at all for this account: a contributor's
   * surface. A builder edits on the canvas; a reviewer edits nothing. */
  const contentEditing = computed(() => !canBuild.value && canEditContent.value)

  function openMenu(
    e: MouseEvent,
    nodeId: string,
    can: { content: boolean; background: boolean },
  ) {
    e.preventDefault()
    e.stopPropagation()
    menu.value = { x: e.clientX, y: e.clientY, nodeId, ...can }
  }
  function closeMenu() {
    menu.value = null
  }
  function requestEdit(nodeId: string, kind: PreviewEditKind) {
    editRequest.value = { nodeId, kind }
    menu.value = null
  }
  /** a renderer claims a pending edit request for its node (one-shot) */
  function consumeEditRequest(nodeId: string): PreviewEditKind | null {
    const request = editRequest.value
    if (request?.nodeId !== nodeId) return null
    editRequest.value = null
    return request.kind
  }
  return { contentEditing, menu, editRequest, openMenu, closeMenu, requestEdit, consumeEditRequest }
}
