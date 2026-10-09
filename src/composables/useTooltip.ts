import { ref } from 'vue'
import type { Side } from '@/lib/floating'

export interface TooltipState {
  el: HTMLElement
  text: string
  side: Side
}

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
