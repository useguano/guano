import { ref } from 'vue'

const activePanelId = ref<string | null>(null)

const pendingFocus = ref<string | null>(null)

export function focusWhenPanelVisible(focus: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(focus))
}

export function usePanel() {
  function openPanel(id: string, opts?: { focus?: boolean }) {
    activePanelId.value = id
    if (opts?.focus) pendingFocus.value = id
  }

  function togglePanel(id: string) {
    activePanelId.value = activePanelId.value === id ? null : id
  }

  function closePanel() {
    activePanelId.value = null
    pendingFocus.value = null
  }

  return { activePanelId, pendingFocus, openPanel, togglePanel, closePanel }
}
