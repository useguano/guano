import type { InjectionKey, Ref } from 'vue'

/**
 * The variant options a stretch of the components board is SHOWING.
 *
 * A component with variants is drawn once per option, side by side, and every
 * one of those drawings renders the same master nodes. What differs is which
 * options they wear — so that travels down the tree like a frame's breakpoint
 * does, rather than living on the nodes.
 */
export const VARIANT_PICKS: InjectionKey<Ref<Record<string, string>>> = Symbol('variant-picks')

/**
 * Whether this drawing is the one being edited. Every drawing renders the same
 * nodes, so without it one selection would outline in all of them at once —
 * the same problem a breakpoint frame solves with FRAME_BREAKPOINT.
 */
export const VARIANT_ACTIVE: InjectionKey<Ref<boolean>> = Symbol('variant-active')
