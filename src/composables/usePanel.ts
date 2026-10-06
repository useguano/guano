import { ref } from 'vue'

/** which right-sidebar popover is open ('style', 'data', …) */
const activePanelId = ref<string | null>(null)

/** panel that should focus its primary input once it renders */
const pendingFocus = ref<string | null>(null)

/**
 * Runs `focus` once the panel popover can actually take it.
 *
 * The popover host renders `visibility: hidden` until its first positioning
 * frame, and focusing a hidden element silently does nothing — so a plain
 * `nextTick` focus never landed when the panel was opening (it only worked if
 * the popover was already up). Two frames: one for the host to position and
 * flip to visible, one for that style to be applied.
 */
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
