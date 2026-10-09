import type { Directive } from 'vue'
import type { TooltipValue } from '@/directives/tooltip'

declare module 'vue' {
  interface GlobalDirectives {
    vTooltip: Directive<HTMLElement, TooltipValue>
  }
}

export {}
