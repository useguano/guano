import { computed, effectScope, ref, watch } from 'vue'
import { useProject } from './useProject'
import type { EffectKind } from '@/lib/effectTriggers'

export type { EffectKind }

export type DrawerKind = EffectKind | 'effect'

export interface DrawerSelection {
  kind: DrawerKind
  id: string
}

const open = ref(false)
const selected = ref<DrawerSelection | null>(null)
const trigger = ref<string | null>(null)
const action = ref<string | null>(null)

const view = computed<'effect' | 'trigger' | 'empty'>(() =>
  selected.value ? 'effect' : trigger.value ? 'trigger' : 'empty',
)

const { project } = useProject()

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
      },
    )
  })
}

export function useEffectsDrawer() {
  startWatchers()

  function openEffect(kind: DrawerKind, id: string) {
    selected.value = { kind, id }
    open.value = true
  }

  function openTrigger(key: string, actionKey: string | null = null) {
    selected.value = null
    trigger.value = key
    action.value = actionKey
    open.value = true
  }

  function closeDrawer() {
    open.value = false
  }

  function toggleDrawer() {
    if (open.value) closeDrawer()
    else open.value = true
  }

  return {
    open,
    selected,
    trigger,
    action,
    view,
    openEffect,
    openTrigger,
    closeDrawer,
    toggleDrawer,
  }
}
