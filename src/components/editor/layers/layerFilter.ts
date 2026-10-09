import { inject, provide, type InjectionKey, type Ref } from 'vue'

const LAYER_FILTER: InjectionKey<Ref<Set<string> | null>> = Symbol('layer-filter')

export function provideLayerFilter(visible: Ref<Set<string> | null>) {
  provide(LAYER_FILTER, visible)
}

export function useLayerFilter() {
  return inject(LAYER_FILTER, null)
}
