import { computed, markRaw, ref, type Component, type MaybeRefOrGetter, type Ref } from 'vue'
import type { Placement } from '@/lib/floating'

export interface PopoverOptions {
  /** stable identity — reopening with the same id updates in place (no onClose) */
  id: string
  /** rendered inside the HostPopover shell */
  component: Component
  props?: Record<string, unknown>
  /** element the popover is positioned against (rAF-tracked, so it may move) */
  anchor: HTMLElement
  placement: Placement
  /** gap in px between the popover and its anchor along the placement axis
   *  (default 8). Rail buttons are inset in the sidebar, so their popovers
   *  bump this up to clear the sidebar edge. */
  offset?: number
  title: MaybeRefOrGetter<string>
  /** a component or a Ref to one — NEVER a getter function: lucide icons ARE
   *  bare functions, so the host resolves with unref (which leaves functions
   *  alone) rather than toValue (which would CALL the icon and crash). Pass a
   *  computed ref when the icon must change while the popover is open. */
  icon?: Component | Ref<Component | undefined>
  /** close when clicking outside the popover/anchor (default false — the
   *  sidebar panels must survive canvas clicks) */
  closeOnOutside?: boolean
  /** close on Escape via the host (default true); opt out to own Escape yourself */
  closeOnEscape?: boolean
  /** fires on every close, including being replaced by a different popover */
  onClose?: () => void
}

/**
 * App-level popover singleton (one at a time), rendered by PopoverHost in
 * App.vue at fixed viewport coordinates. Call sites open imperatively — no
 * absolutely-positioned HostPopover + v-if at the anchor.
 */
const current = ref<PopoverOptions | null>(null)

export function usePopover() {
  const currentId = computed(() => current.value?.id ?? null)

  function openPopover(opts: PopoverOptions) {
    const prev = current.value
    const next = { ...opts, component: markRaw(opts.component) }
    if (prev && prev.id !== opts.id) {
      // replacing a different popover counts as closing it
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
