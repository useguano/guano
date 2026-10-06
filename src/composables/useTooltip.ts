import { ref } from 'vue'
import type { Side } from '@/lib/floating'

export interface TooltipState {
  el: HTMLElement
  text: string
  side: Side
}

/**
 * Singleton state behind the app-level TooltipHost. The v-tooltip directive
 * calls show/hide; TooltipHost renders the single floating label. hide() is
 * identity-guarded so a late mouseleave from one element can't clobber the
 * tooltip another element just opened.
 */
const active = ref<TooltipState | null>(null)

export function useTooltip() {
  function show(el: HTMLElement, text: string, side: Side) {
    active.value = { el, text, side }
  }

  function hide(el: HTMLElement) {
    if (active.value?.el === el) active.value = null
  }

  return { active, show, hide }
}
