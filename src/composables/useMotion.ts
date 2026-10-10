import { computed, ref } from 'vue'
import {
  bindingDelay,
  compileAnimation,
  composeMotionStyle,
  countToFor,
  endStyle,
  foldReverseTime,
  hasInfinite,
  primeFirstFrameValues,
  reducedMotion,
  sampleValues,
  scrubProgressRaw,
  mouseProgressRaw,
  approach,
  MOUSE_DEFAULTS,
  MOUSE_REST,
  splitByStagger,
  type CompiledAnimation,
  type MotionStyle,
  type MotionValues,
  type StaggerSplit,
} from '@/lib/motion'
import { animationPlayKey } from '@/lib/motion'
import type { Animation, AnimationBinding } from '@/types/editor'

interface PlayState {
  targetId: string

  scope?: string
  compiled: CompiledAnimation
  split: StaggerSplit
  time: number
  direction: 1 | -1
  scrubbed: boolean

  dist?: number
  running: boolean

  wait?: number

  maxChild?: number
}

function maxStagger(split: StaggerSplit): number {
  let max = 0
  for (const track of split.staggered.tracks) if (track.stagger > max) max = track.stagger
  return max
}

export type MotionScope = string | ReadonlySet<string | undefined>

function playEnd(play: PlayState): number {
  if (!play.split.hasStagger) return play.compiled.duration
  return play.compiled.duration + maxStagger(play.split) * (play.maxChild ?? 0)
}

const plays = ref(new Map<string, PlayState>())
const MOUSE_CENTRE = MOUSE_REST
const mouseSmoothed = new Map<string, number>()
const tick = ref(0)

const compiledCache = new Map<
  string,
  { steps: string; compiled: CompiledAnimation; split: StaggerSplit }
>()

function compiledFor(animation: Animation): { compiled: CompiledAnimation; split: StaggerSplit } {
  const steps = JSON.stringify(animation.steps)
  const hit = compiledCache.get(animation.id)
  if (hit && hit.steps === steps) return hit
  const compiled = compileAnimation(animation)
  const entry = { steps, compiled, split: splitByStagger(compiled) }
  compiledCache.set(animation.id, entry)
  return entry
}

const staggeredTargets = computed<Set<string>>((prev) => {
  const next = new Set<string>()
  for (const play of plays.value.values()) {
    if (play.split.hasStagger) next.add(play.targetId)
  }
  if (prev && prev.size === next.size) {
    let same = true
    for (const id of next) {
      if (!prev.has(id)) {
        same = false
        break
      }
    }
    if (same) return prev
  }
  return next
})

let frame: number | null = null
let last = 0

function loop(now: number) {
  const dt = last ? now - last : 16
  last = now
  let live = false
  let removed = false
  for (const [key, play] of plays.value) {
    if (!play.running || play.scrubbed) continue
    if (play.wait && play.wait > 0) {
      play.wait -= dt
      if (play.wait > 0) {
        live = true
        continue
      }
      play.time = -play.wait
      play.wait = 0
    } else {
      play.time += dt * play.direction
    }
    const end = playEnd(play)
    if (play.direction === 1 && play.time >= end && !hasInfinite(play.compiled)) {
      play.time = end
      play.running = false
    } else if (play.direction === -1 && play.time <= 0) {
      plays.value.delete(key)
      removed = true
      continue
    } else {
      live = true
    }
  }
  if (removed) plays.value = new Map(plays.value)
  tick.value++
  frame = live ? requestAnimationFrame(loop) : ((last = 0), null)
}

function ensureLoop() {
  if (frame === null) {
    last = 0
    frame = requestAnimationFrame(loop)
  }
}

export function useMotion() {
  function play(
    binding: AnimationBinding,
    animation: Animation,
    targetId: string,
    opts: { scope?: string; reverse?: boolean; restart?: boolean } = {},
  ) {
    const key = animationPlayKey(binding, targetId, opts.scope)
    const { compiled, split } = compiledFor(animation)
    const existing = plays.value.get(key)

    if (reducedMotion()) {
      plays.value.set(key, {
        targetId,
        scope: opts.scope,
        compiled,
        split,
        time: compiled.duration + maxStagger(split) * 256,
        direction: 1,
        scrubbed: false,
        running: false,
      })
      plays.value = new Map(plays.value)
      tick.value++
      return
    }

    const reverse = !!opts.reverse
    plays.value.set(key, {
      targetId,
      scope: opts.scope,
      compiled,
      split,
      time: reverse ? (existing?.time ?? compiled.duration) : opts.restart === false && existing ? existing.time : 0,
      direction: reverse ? -1 : 1,
      scrubbed: false,
      running: true,
      wait: reverse || (opts.restart === false && existing) ? 0 : bindingDelay(binding),
    })
    plays.value = new Map(plays.value)
    ensureLoop()
  }

  function reverse(binding: AnimationBinding, targetId: string, scope?: string) {
    const key = animationPlayKey(binding, targetId, scope)
    const existing = plays.value.get(key)
    if (!existing) return
    existing.time = foldReverseTime(existing.compiled, existing.time)
    existing.direction = -1
    existing.wait = 0
    existing.running = true
    plays.value = new Map(plays.value)
    ensureLoop()
  }

  function stop(binding: AnimationBinding, targetId = binding.targetId ?? '', scope?: string) {
    plays.value.delete(animationPlayKey(binding, targetId, scope))
    plays.value = new Map(plays.value)
    tick.value++
  }

  const isPlaying = (binding: AnimationBinding, targetId: string, scope?: string) =>
    plays.value.has(animationPlayKey(binding, targetId, scope))

  function clickAction(
    binding: AnimationBinding,
    animation: Animation,
    targetId: string,
    scope?: string,
  ) {
    const existing = plays.value.get(animationPlayKey(binding, targetId, scope))
    if (binding.action === 'on') play(binding, animation, targetId, { scope })
    else if (binding.action === 'off') reverse(binding, targetId, scope)
    else if (existing && existing.direction === 1) reverse(binding, targetId, scope)
    else play(binding, animation, targetId, { scope })
  }

  function scrubTo(
    binding: AnimationBinding,
    animation: Animation,
    targetId: string,
    progress: number,
    scope?: string,
  ) {
    const key = animationPlayKey(binding, targetId, scope)
    const { compiled, split } = compiledFor(animation)
    plays.value.set(key, {
      targetId,
      scope,
      compiled,
      split,
      time: Math.max(0, Math.min(1, progress)) * compiled.duration,
      direction: 1,
      scrubbed: true,
      dist: progress < 0 ? -progress : progress > 1 ? progress - 1 : 0,
      running: false,
    })
    plays.value = new Map(plays.value)
    tick.value++
  }

  function scrubProgressFor(binding: AnimationBinding, top: number, viewportHeight: number) {
    return scrubProgressRaw(top, viewportHeight, binding.scrub)
  }

  function mouseProgressFor(
    binding: AnimationBinding,
    point: { x: number; y: number },
    box: { left: number; top: number; width: number; height: number },
    dt: number,
    key: string,
  ): { value: number; settled: boolean } | null {
    const raw = mouseProgressRaw(point, box, binding.mouse?.axis)
    if (raw === null) return null
    const smooth =
      typeof binding.mouse?.smooth === 'number' ? binding.mouse.smooth : MOUSE_DEFAULTS.smooth
    if (!(smooth > 0)) return { value: raw, settled: true }
    const prev = mouseSmoothed.get(key) ?? MOUSE_CENTRE
    const next = approach(prev, raw, dt, smooth)
    mouseSmoothed.set(key, next)
    return { value: next, settled: next === raw }
  }

  function restMouseProgress(key: string) {
    mouseSmoothed.set(key, MOUSE_CENTRE)
  }

  function inScope(play: PlayState, scope?: MotionScope): boolean {
    const own = play.scope
    return scope instanceof Set ? scope.has(own) : own === scope
  }

  function valuesForNode(
    nodeId: string,
    scope?: MotionScope,
    text?: string,
  ): MotionValues | undefined {
    void tick.value
    const matching: PlayState[] = []
    for (const play of plays.value.values()) {
      if (play.targetId !== nodeId || !inScope(play, scope)) continue
      matching.push(play)
    }
    matching.sort((a, b) => (b.dist ?? 0) - (a.dist ?? 0))
    let merged: MotionValues | undefined
    for (const play of matching) {
      const to = text === undefined ? undefined : countToFor(play.split.element, text)
      const values = sampleValues(play.split.element, play.time, { to })
      merged = merged ? { ...merged, ...values } : values
    }
    return merged
  }

  function staggerValuesFor(
    parentId: string,
    childIndex: number,
    scope?: MotionScope,
  ): MotionValues | undefined {
    void tick.value
    let merged: MotionValues | undefined
    for (const play of plays.value.values()) {
      if (play.targetId !== parentId || !play.split.hasStagger || !inScope(play, scope)) continue
      if (childIndex > (play.maxChild ?? 0)) play.maxChild = childIndex
      const values = sampleValues(play.split.staggered, play.time, { childIndex })
      merged = merged ? { ...merged, ...values } : values
    }
    return merged
  }

  /**
   * What an element wears before anything aimed at it plays — per property,
   * the `from` of the timeline that starts earliest. The published export
   * bakes the same frame into the markup from the same helper, so the canvas,
   * Play and the site cannot disagree about a resting state.
   *
   * Merged UNDER the playing values by the caller, and on values rather than
   * styles: two composed styles would have the later `transform` replace the
   * earlier one whole.
   */
  function restValuesFor(
    bindings: { binding: AnimationBinding; animation: Animation }[],
  ): MotionValues | undefined {
    if (!bindings.length) return undefined
    const values = primeFirstFrameValues(
      bindings.map(({ binding, animation }) => ({
        compiled: compiledFor(animation).split.element,
        delay: bindingDelay(binding),
        entrance: binding.trigger === 'load' || binding.trigger === 'appear',
        mid: binding.trigger === 'mouse',
      })),
    )
    return Object.keys(values).length ? values : undefined
  }

  function styleForNode(nodeId: string, scope?: MotionScope): MotionStyle | undefined {
    const values = valuesForNode(nodeId, scope)
    return values ? composeMotionStyle(values) : undefined
  }

  function preview(animation: Animation, targetId: string, scope?: string) {
    const key = scope ? `preview:${animation.id}@${scope}` : `preview:${animation.id}`
    const { compiled, split } = compiledFor(animation)
    plays.value.set(key, {
      targetId,
      scope,
      compiled,
      split,
      time: 0,
      direction: 1,
      scrubbed: false,
      running: true,
    })
    plays.value = new Map(plays.value)
    if (reducedMotion()) {
      const play = plays.value.get(key)!
      play.time = compiled.duration
      play.running = false
      tick.value++
      return
    }
    ensureLoop()
  }

  function previewTime(animationId: string, scope?: string): number | null {
    void tick.value
    const key = scope ? `preview:${animationId}@${scope}` : `preview:${animationId}`
    const play = plays.value.get(key)
    return play ? play.time : null
  }

  function stopAll() {
    if (!plays.value.size) return
    plays.value = new Map()
    tick.value++
  }

  const anyPlaying = computed(() => plays.value.size > 0)

  return {
    play,
    reverse,
    stop,
    stopAll,
    clickAction,
    scrubTo,
    scrubProgressFor,
    mouseProgressFor,
    restMouseProgress,
    MOUSE_CENTRE,
    styleForNode,
    valuesForNode,
    restValuesFor,
    staggerValuesFor,
    staggeredTargets,
    preview,
    previewTime,
    isPlaying,
    anyPlaying,
    endStyleFor: (animation: Animation) => endStyle(compiledFor(animation).compiled),
  }
}
