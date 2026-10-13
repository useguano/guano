import { computed, ref } from 'vue'
import {
  COLOR_MODE_ACTIONS,
  defaultColorMode,
  nextColorMode,
  resolveColorMode,
  themeLinkAction,
} from '@/lib/shared/colorMode.js'
import { useSettings } from './useSettings'
import { tokenDark } from '@/lib/settings'

/**
 * The colour mode the editor's two render surfaces show — the editor's stand-in
 * for the visitor's stored choice, resolved through the same
 * `resolveColorMode` the published head script uses.
 *
 * Runtime-only, like the active locale and the camera: it is a way of LOOKING
 * at the project, not part of it. `null` is "nothing chosen", which is what
 * makes the site default (and `system`) visible on the canvas at all.
 */
const chosen = ref<'light' | 'dark' | null>(null)

const systemDark = ref(
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false,
)
if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener) {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => (systemDark.value = e.matches))
}

export function useColorMode() {
  const { settings } = useSettings()

  const mode = computed<'light' | 'dark'>(() =>
    resolveColorMode(chosen.value, defaultColorMode(settings.value), systemDark.value),
  )

  /** does this project switch modes at all? — what the canvas control is shown for */
  const used = computed(
    () =>
      defaultColorMode(settings.value) !== 'light' ||
      (settings.value.tokens ?? []).some((t) => tokenDark(t)),
  )

  /** apply a switcher's action, exactly as the published head script would */
  function act(action: string | null) {
    if (!action || !COLOR_MODE_ACTIONS.includes(action)) return
    if (action === 'system') chosen.value = null
    else chosen.value = nextColorMode(action, mode.value)
  }

  function toggle() {
    act('toggle')
  }

  return { mode, used, act, toggle, chosen }
}

export { themeLinkAction }
