import type { InjectionKey, Ref } from 'vue'

export const VARIANT_PICKS: InjectionKey<Ref<Record<string, string>>> = Symbol('variant-picks')

export const VARIANT_ACTIVE: InjectionKey<Ref<boolean>> = Symbol('variant-active')
