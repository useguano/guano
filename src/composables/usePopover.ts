import { computed, markRaw, ref, type Component, type MaybeRefOrGetter, type Ref } from 'vue'
import type { Placement } from '@/lib/floating'

export interface PopoverOptions {
  id: string
  component: Component
  props?: Record<string, unknown>
  anchor: HTMLElement
  placement: Placement

  offset?: number
  title: MaybeRefOrGetter<string>

  icon?: Component | Ref<Component | undefined>

  width?: string

  header?: boolean

  scroll?: boolean

  closeOnOutside?: boolean
  closeOnEscape?: boolean
  onClose?: () => void
}

const current = ref<PopoverOptions | null>(null)

export function usePopover() {
  const currentId = computed(() => current.value?.id ?? null)

  function openPopover(opts: PopoverOptions) {
    const prev = current.value
    const next = { ...opts, component: markRaw(opts.component) }
    if (prev && prev.id !== opts.id) {
      current.value = null
      prev.onClose?.()
    }
    current.value = next
  }

  function closePopover() {
    const prev = current.value
    if (!prev) return
    current.value = null
    prev.onClose?.()
  }

  function togglePopover(opts: PopoverOptions) {
    if (current.value?.id === opts.id) closePopover()
    else openPopover(opts)
  }

  return { current, currentId, openPopover, closePopover, togglePopover }
}
