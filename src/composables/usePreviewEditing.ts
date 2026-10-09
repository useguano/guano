import { computed, ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

export type PreviewEditKind = 'content' | 'background'

export interface PreviewMenuState {
  x: number
  y: number
  nodeId: string
  content: boolean
  background: boolean
}

const menu = ref<PreviewMenuState | null>(null)
const editRequest = ref<{ nodeId: string; kind: PreviewEditKind } | null>(null)

export function usePreviewEditing() {
  const { canBuild, canEditContent } = useAuth()

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
  function consumeEditRequest(nodeId: string): PreviewEditKind | null {
    const request = editRequest.value
    if (request?.nodeId !== nodeId) return null
    editRequest.value = null
    return request.kind
  }
  return { contentEditing, menu, editRequest, openMenu, closeMenu, requestEdit, consumeEditRequest }
}
