import type { InjectionKey, Ref } from 'vue'

export interface AccordionContext {
  open: Ref<boolean>
  toggle: () => void
}

export const accordionKey: InjectionKey<AccordionContext> = Symbol('accordion')
