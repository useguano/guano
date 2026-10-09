import { computed } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useMotion } from './useMotion'
import { compileAnimation, resolveTransition, reducedMotion, TRANSITION_DEFAULTS } from '@/lib/motion'
import type { Animation, AnimationBinding } from '@/types/editor'

const EXIT = { id: '__t-exit' } as AnimationBinding
const ENTER = { id: '__t-enter' } as AnimationBinding

let leaving = false

export function usePageTransition() {
  const { project } = useProject()
  const { activePage } = usePage()
  const motion = useMotion()

  const resolved = computed(() => {
    const library = Object.fromEntries((project.value.animations ?? []).map((a) => [a.id, a]))
    return resolveTransition(project.value.settings?.motion, library as Record<string, Animation>)
  })

  const enabled = computed(() => !!resolved.value && !reducedMotion())

  const bodyId = () => activePage.value.elements.find((n) => n.type === 'body')?.id ?? null

  function leave(): Promise<void> {
    const exit = resolved.value?.exit
    const target = bodyId()
    if (!enabled.value || !exit || !target || leaving) return Promise.resolve()
    leaving = true
    motion.play(EXIT, exit, target)
    const wait = Math.min(compileAnimation(exit).duration + 50, TRANSITION_DEFAULTS.exitTimeoutMs)
    return new Promise((resolve) => setTimeout(resolve, wait))
  }

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
