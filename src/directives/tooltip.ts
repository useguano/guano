import type { Directive } from 'vue'
import type { Side } from '@/lib/floating'
import { useTooltip } from '@/composables/useTooltip'

export type TooltipValue = string | { text: string; side?: Side } | false | null | undefined

interface TooltipBinding {
  text: string
  side: Side
  timer: number | null
  suppressed: boolean
  enter: () => void
  leave: () => void
  click: () => void
}

const KEY = Symbol('tooltip')
const SHOW_DELAY = 100

type TooltipEl = HTMLElement & { [KEY]?: TooltipBinding }

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

function resolve(value: TooltipValue, modifiers: Partial<Record<string, boolean>>): { text: string; side: Side } {
  const modSide = SIDES.find((s) => modifiers[s])
  if (typeof value === 'string') return { text: value, side: modSide ?? 'top' }
  if (value && typeof value === 'object') return { text: value.text, side: value.side ?? modSide ?? 'top' }
  return { text: '', side: modSide ?? 'top' }
}

/**
 * v-tooltip — hover label rendered by the app-level TooltipHost (never the
 * native title attribute). Value: a string, `{ text, side }`, or a falsy value
 * for no tooltip; side also via modifier (`v-tooltip.bottom="…"`). Shows after
 * a short delay; a click suppresses it until the pointer leaves (clicking
 * usually opens something).
 *
 * Also reachable by KEYBOARD, and described to assistive tech. It used to bind
 * pointer events only, so a tooltip-only control said nothing to a screen
 * reader and showed nothing to someone tabbing through — which for an icon
 * button whose tooltip IS its label meant an unlabelled control.
 */
export const tooltip: Directive<TooltipEl, TooltipValue> = {
  mounted(el, binding) {
    const { show, hide } = useTooltip()
    const state: TooltipBinding = {
      ...resolve(binding.value, binding.modifiers),
      timer: null,
      suppressed: false,
      enter() {
        if (!state.text || state.suppressed) return
        state.timer = window.setTimeout(() => {
          state.timer = null
          if (!state.text || state.suppressed) return
          el.setAttribute('aria-describedby', 'guano-tooltip')
          show(el, state.text, state.side)
        }, SHOW_DELAY)
      },
      leave() {
        if (state.timer !== null) window.clearTimeout(state.timer)
        state.timer = null
        state.suppressed = false
        el.removeAttribute('aria-describedby')
        hide(el)
      },
      click() {
        state.suppressed = true
        if (state.timer !== null) window.clearTimeout(state.timer)
        state.timer = null
        hide(el)
      },
    }
    el[KEY] = state
    el.addEventListener('mouseenter', state.enter)
    el.addEventListener('mouseleave', state.leave)
    el.addEventListener('focus', state.enter)
    el.addEventListener('blur', state.leave)
    el.addEventListener('click', state.click)
  },

  updated(el, binding) {
    const state = el[KEY]
    if (!state) return
    const next = resolve(binding.value, binding.modifiers)
    state.text = next.text
    state.side = next.side
    const { active, show, hide } = useTooltip()
    if (active.value?.el === el) {
      // reactive text change while shown (e.g. save-status pill)
      if (state.text) show(el, state.text, state.side)
      else hide(el)
    }
  },

  unmounted(el) {
    const state = el[KEY]
    if (!state) return
    if (state.timer !== null) window.clearTimeout(state.timer)
    el.removeEventListener('mouseenter', state.enter)
    el.removeEventListener('mouseleave', state.leave)
    el.removeEventListener('focus', state.enter)
    el.removeEventListener('blur', state.leave)
    el.removeEventListener('click', state.click)
    useTooltip().hide(el)
    delete el[KEY]
  },
}
