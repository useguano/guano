import { inject, provide, type InjectionKey, type Ref } from 'vue'

/**
 * Which rows a surface's search leaves standing: the ids that MATCH plus
 * every ancestor of one, so a hit keeps the nesting that explains where it
 * is. `null` is the ordinary, unfiltered tree.
 *
 * provide/inject rather than a prop, for the same reason the rest of the row
 * state is: a row is instantiated once per element and the tree is deep.
 * Per-surface rather than module-level, so the Components drawer's own trees
 * are untouched by the Pages drawer's search.
 */
const LAYER_FILTER: InjectionKey<Ref<Set<string> | null>> = Symbol('layer-filter')

export function provideLayerFilter(visible: Ref<Set<string> | null>) {
  provide(LAYER_FILTER, visible)
}

export function useLayerFilter() {
  return inject(LAYER_FILTER, null)
}
