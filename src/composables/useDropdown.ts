import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Open/close state for a dropdown or popover panel: outside-click closes,
 * optionally Escape too. Unlike the store-style composables, this is a
 * per-instance factory — each caller owns its own state, so several
 * dropdowns can coexist and close independently.
 */
export function useDropdown(options?: {
  /** also close on Escape */
  escape?: boolean
  /** skip one outside-click while truthy (e.g. the release click of a palette drag) */
  suppressClick?: Ref<boolean>
  /** don't close on Escape while truthy (e.g. Esc is cancelling a drag) */
  blockEscape?: Ref<unknown>
}) {
  const open = ref(false)
  const root = ref<HTMLElement>()

  function toggle() {
    open.value = !open.value
  }

  function close() {
    open.value = false
  }

  function onClickOutside(e: MouseEvent) {
    if (options?.suppressClick?.value) return
    if (root.value && !root.value.contains(e.target as Node)) close()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !options?.blockEscape?.value) close()
  }

  onMounted(() => {
    document.addEventListener('click', onClickOutside)
    if (options?.escape) window.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside)
    if (options?.escape) window.removeEventListener('keydown', onKeydown)
  })

  return { open, root, toggle, close }
}
