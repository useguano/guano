// Page transitions on the Preview surface: the editor's counterpart to the
// published runtime's link interceptor (src/motion/runtime.ts). Same settings,
// same timelines, same shared resolution — only the navigation differs, since
// Preview switches the active page in state instead of loading a document.
//
// Both sides play on the page's `:body` node, which is where a whole-page
// animation belongs and what the exporter animates as the real <body> tag.
import { computed } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useMotion } from './useMotion'
import { compileAnimation, resolveTransition, reducedMotion, TRANSITION_DEFAULTS } from '@/lib/motion'
import type { Animation, AnimationBinding } from '@/types/editor'

// synthetic bindings: useMotion keys plays by binding id, and a transition has
// no binding of its own. The ids are the reserved ones the exporter uses.
const EXIT = { id: '__t-exit' } as AnimationBinding
const ENTER = { id: '__t-enter' } as AnimationBinding

/** a transition is in flight, so a second click must not restart it */
let leaving = false

export function usePageTransition() {
  const { project } = useProject()
  const { activePage } = usePage()
  const motion = useMotion()

  const resolved = computed(() => {
    const library = Object.fromEntries((project.value.animations ?? []).map((a) => [a.id, a]))
    return resolveTransition(project.value.settings?.motion, library as Record<string, Animation>)
  })

  /** off when disabled, and always off for a visitor who asked for less motion */
  const enabled = computed(() => !!resolved.value && !reducedMotion())

  /** the page's body node — the element a whole-page animation moves */
  const bodyId = () => activePage.value.elements.find((n) => n.type === 'body')?.id ?? null

  /** plays the outgoing animation; resolves when it's time to navigate */
  function leave(): Promise<void> {
    const exit = resolved.value?.exit
    const target = bodyId()
    if (!enabled.value || !exit || !target || leaving) return Promise.resolve()
    leaving = true
    motion.play(EXIT, exit, target)
    // the same hard cap the published runtime uses: a long or looping custom
    // timeline must not hold the navigation open indefinitely
    const wait = Math.min(compileAnimation(exit).duration + 50, TRANSITION_DEFAULTS.exitTimeoutMs)
    return new Promise((resolve) => setTimeout(resolve, wait))
  }

  /** clears the outgoing animation and plays the incoming one. Call it straight
   * after the page switch, before the new tree renders, so its first frame is
   * already in place and nothing paints the page at full strength first. */
  function enter() {
    motion.stop(EXIT)
    leaving = false
    const anim = resolved.value?.enter
    const target = bodyId()
    if (!enabled.value || !anim || !target) return
    motion.play(ENTER, anim, target)
  }

  return { enabled, leave, enter }
}
