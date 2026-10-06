import type { InjectionKey } from 'vue'

// The breakpoint id of the frame an element is rendered in. Every breakpoint
// frame renders the same element tree, so selection/highlight outlines are
// scoped to the frame matching the active breakpoint via this injected id —
// otherwise one selection would light up in every frame at once. Absent
// (null) outside the multi-frame canvas (e.g. Preview), where nothing is scoped.
export const FRAME_BREAKPOINT: InjectionKey<string> = Symbol('frameBreakpoint')
