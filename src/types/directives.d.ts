import type { Directive } from 'vue'
import type { TooltipValue } from '@/directives/tooltip'

// registers v-tooltip with vue-tsc for template type-checking
declare module 'vue' {
  interface GlobalDirectives {
    vTooltip: Directive<HTMLElement, TooltipValue>
  }
}

export {}
