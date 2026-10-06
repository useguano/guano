import { computed, effectScope, ref, watch } from 'vue'
import { useProject } from './useProject'
import type { EffectKind } from '@/lib/effectTriggers'

// Which effect the bottom drawer is editing, if any.
//
// An effect — a style change or a timeline — is PROJECT-level and shared by
// every element using it, so it is edited in the drawer under the canvas rather
// than in the element panel. That is the whole point of the drawer: editing a
// shared thing among per-element rows made a change that retimed the site read
// as a change to the one element, and reaching it used to take over the panel,
// so you lost sight of which element you were on.
//
// The drawer deliberately SURVIVES a selection change and a panel change: you
// open it to tune one effect while clicking around the elements that use it.
// Only the effect going away clears it.
//
// It has TWO views. The effect view edits a shared effect (above). The trigger
// view is where an ELEMENT's actions are managed — what runs on click, on hover
// — for the element currently selected: the panel only lists the element's
// triggers and hands each one here, so the rows, their options, the action
// picker and the state cards all get the width and the stability of the drawer
// instead of a popover that closes under them. The trigger is kept while an
// effect is open, so Cancel or Done on a new effect lands back on the trigger
// the author was filling.
//
// State is IDS, NEVER OBJECTS. Undo, a branch switch and a merge each replace
// the whole `project` ref with a deep clone — object identities change while ids
// survive. A held object would become a detached orphan that silently swallows
// every subsequent keystroke.

export type { EffectKind }

/** what the drawer can be pointed at: a named effect (one or both halves), or
 *  a bare half no effect has claimed */
export type DrawerKind = EffectKind | 'effect'

export interface DrawerSelection {
  kind: DrawerKind
  id: string
}

const open = ref(false)
const selected = ref<DrawerSelection | null>(null)
/** the trigger (a stored trigger value) whose action the trigger view shows */
const trigger = ref<string | null>(null)
/** an effect the trigger view's picker just made — the trigger view offers
 *  Cancel (a cascading discard of the effect AND the binding it applied) until
 *  it is kept, which walking away from the drawer also does */
const fresh = ref<string | null>(null)

/** an open effect wins; a trigger is what the drawer falls back to */
const view = computed<'effect' | 'trigger' | 'empty'>(() =>
  selected.value ? 'effect' : trigger.value ? 'trigger' : 'empty',
)

const { project } = useProject()

/** is the selection still something to edit? */
function resolves(sel: DrawerSelection): boolean {
  const list =
    sel.kind === 'effect'
      ? project.value.effects
      : sel.kind === 'interaction'
        ? project.value.interactions
        : project.value.animations
  return !!list?.some((item) => item.id === sel.id)
}

let watchersStarted = false

function startWatchers() {
  if (watchersStarted) return
  watchersStarted = true
  // detached: this state outlives every component that reads it, so the
  // watcher must outlive them too (same pattern as the component sync)
  effectScope(true).run(() => {
    watch(
      () =>
        [
          selected.value,
          project.value.interactions,
          project.value.animations,
          project.value.effects,
        ] as const,
      () => {
        if (selected.value && !resolves(selected.value)) selected.value = null
        if (fresh.value && !project.value.effects?.some((e) => e.id === fresh.value)) {
          fresh.value = null
        }
      },
    )
  })
}

export function useEffectsDrawer() {
  startWatchers()

  /** open the drawer on an effect (the panel's effect names, the library) */
  function openEffect(kind: DrawerKind, id: string) {
    selected.value = { kind, id }
    open.value = true
  }

  /** open the drawer on the selected element's actions for one trigger — the
   *  panel's rows, and "+ Trigger" */
  function openTrigger(key: string) {
    keepEffect()
    selected.value = null
    trigger.value = key
    open.value = true
  }

  /** a brand-new effect has been accepted: it stops offering Cancel */
  function keepEffect() {
    fresh.value = null
  }

  /** the trigger view's picker made an effect: stay on the trigger (the effect
   *  is edited right there) and offer Cancel until Done */
  function effectCreated(effectId: string) {
    fresh.value = effectId
    open.value = true
  }

  function closeDrawer() {
    open.value = false
    // walking away KEEPS a new effect (only Cancel discards), so it must stop
    // offering Cancel — otherwise reopening later would invite discarding
    // something the author has already lived with.
    keepEffect()
  }

  function toggleDrawer() {
    if (open.value) closeDrawer()
    else open.value = true
  }

  return {
    open,
    selected,
    trigger,
    fresh,
    view,
    openEffect,
    openTrigger,
    effectCreated,
    keepEffect,
    closeDrawer,
    toggleDrawer,
  }
}
