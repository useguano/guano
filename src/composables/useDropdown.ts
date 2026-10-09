import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useDropdown(options?: {
  escape?: boolean
  suppressClick?: Ref<boolean>
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
