import type { InjectionKey, Ref } from 'vue'

export interface TabsContext {
  active: Ref<string>
  select: (id: string) => void
}

export const tabsKey: InjectionKey<TabsContext> = Symbol('tabs')
