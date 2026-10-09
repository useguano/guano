import type {
  AnimProp,
  Animation,
  AnimationBinding,
  AnimationTrack,
  ProjectSettings,
} from '@/types/editor'
import {
  MOTION_PROPS as MOTION_PROPS_DATA,
  EASINGS as EASINGS_DATA,
  EASING_KEYS,
  animationBindingKey,
  animationPlayKey as animationPlayKeyRaw,
  animationStateKey as animationStateKeyRaw,
  ANIMATION_ACTIONS as ANIMATION_ACTIONS_DATA,
  compileAnimation as compileAnimationRaw,
  sampleAnimation as sampleAnimationRaw,
  sampleValues as sampleValuesRaw,
  composeMotionStyle as composeMotionStyleRaw,
  sampleText as sampleTextRaw,
  parseCountText as parseCountTextRaw,
  countToFor as countToForRaw,
  countTargetError as countTargetErrorRaw,
  splitByStagger as splitByStaggerRaw,
  initialStyle as initialStyleRaw,
  primeFirstFrame as primeFirstFrameRaw,
  primeFirstFrameValues as primeFirstFrameValuesRaw,
  bindingDelay as bindingDelayRaw,
  endStyle as endStyleRaw,
  foldReverseTime as foldReverseTimeRaw,
  hasInfinite as hasInfiniteRaw,
  appearRootMargin,
  parseTrackValue as parseTrackValueRaw,
  lerpColor,
  parseColor,
  validateAnimation as validateAnimationRaw,
  validateBinding as validateBindingRaw,
  motionBreakpointId,
  scrubProgress as scrubProgressJs,
  scrubProgressRaw as scrubProgressRawJs,
  MOTION_CSS_PROPS,
  SCRUB_DEFAULTS,
  APPEAR_AT_DEFAULT,
  APPEAR_MODES,
  effectiveAppearMode as effectiveAppearModeRaw,
  resolveTransition as resolveTransitionRaw,
  resolveScrollLerp as resolveScrollLerpRaw,
  validateMotionSettings as validateMotionSettingsRaw,
  TRANSITION_PRESET_IDS,
  TRANSITION_DEFAULTS,
  TRANSITION_EXIT_ID,
  TRANSITION_ENTER_ID,
  SCROLL_LERP_DEFAULT,
  SCROLL_LERP_MIN,
  SCROLL_LERP_MAX,
} from './shared/motion.js'

export interface MotionPropDef {
  kind: 'transform' | 'opacity' | 'filter' | 'color' | 'size' | 'clip' | 'text'
  unit: string
  units: string[]
  css?: string
  def: number | string
  label: string
}

export interface CompiledTrack {
  prop: AnimProp
  from?: number | string
  to: number | string
  format?: AnimationTrack['format']
  start: number
  duration: number
  easing: string
  stagger: number
  repeat: number
  yoyo: boolean
  stepIndex: number
}

export interface CompiledAnimation {
  tracks: CompiledTrack[]
  duration: number
}

export type MotionStyle = Record<string, string | number>

export interface MotionValue {
  n?: number
  unit?: string
  color?: string
  format?: AnimationTrack['format']
}
export type MotionValues = Record<string, MotionValue>

export interface StaggerSplit {
  element: CompiledAnimation
  staggered: CompiledAnimation
  hasStagger: boolean
  selector: string
}

export interface SampleOptions {
  childIndex?: number
  current?: Partial<Record<AnimProp, number | string>>

  to?: Partial<Record<AnimProp, number>>
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

export const MOTION_PROPS = MOTION_PROPS_DATA as Record<AnimProp, MotionPropDef>
export const EASINGS: Record<string, (t: number) => number> = EASINGS_DATA
export const EASING_NAMES: string[] = EASING_KEYS

export const animationStateKey = animationStateKeyRaw as (
  animationId: string,
  targetId: string,
  scope?: string,
) => string
export const animationPlayKey = animationPlayKeyRaw as (
  binding: AnimationBinding,
  targetId: string,
  scope?: string,
) => string

export const ANIMATION_ACTIONS: string[] = ANIMATION_ACTIONS_DATA

export const compileAnimation = compileAnimationRaw as (a: Animation) => CompiledAnimation
export const sampleAnimation = sampleAnimationRaw as (
  compiled: CompiledAnimation,
  t: number,
  opts?: SampleOptions,
) => MotionStyle
export const endStyle = endStyleRaw as (
  compiled: CompiledAnimation,
  opts?: SampleOptions,
) => MotionStyle
export const validateAnimation = validateAnimationRaw as (a: unknown) => ValidationResult

export const countTargetError = countTargetErrorRaw as (
  animation: Animation | undefined,
  target: {
    type?: string
    isLeaf?: boolean
    isBound?: boolean
    text?: string
    locale?: string
  } | null,
) => string | null
export const validateBinding = validateBindingRaw as (
  b: unknown,
  ctx?: { animationIds?: string[] },
) => ValidationResult
export const scrubProgress = scrubProgressJs as (
  top: number,
  vh: number,
  scrub?: AnimationBinding['scrub'],
) => number
export const scrubProgressRaw = scrubProgressRawJs as (
  top: number,
  vh: number,
  scrub?: AnimationBinding['scrub'],
) => number

export const sampleValues = sampleValuesRaw as (
  compiled: CompiledAnimation,
  t: number,
  opts?: SampleOptions,
) => MotionValues
export const composeMotionStyle = composeMotionStyleRaw as (values: MotionValues) => MotionStyle
export const sampleText = sampleTextRaw as (
  values: MotionValues,
  locale?: string,
) => string | undefined
export const parseCountText = parseCountTextRaw as (
  text: string,
  format?: AnimationTrack['format'],
) => number | null
export const countToFor = countToForRaw as (
  compiled: CompiledAnimation,
  text: string,
) => Partial<Record<AnimProp, number>> | undefined
export const splitByStagger = splitByStaggerRaw as (c: CompiledAnimation) => StaggerSplit
export const initialStyle = initialStyleRaw as (c: CompiledAnimation) => MotionStyle

export const primeFirstFrame = primeFirstFrameRaw as (
  entries: { compiled: CompiledAnimation; delay?: number; entrance?: boolean }[],
) => MotionStyle
export const primeFirstFrameValues = primeFirstFrameValuesRaw as (
  entries: { compiled: CompiledAnimation; delay?: number; entrance?: boolean }[],
) => MotionValues
export const bindingDelay = bindingDelayRaw as (b: { delay?: number } | null | undefined) => number
export const foldReverseTime = foldReverseTimeRaw as (c: CompiledAnimation, t: number) => number
export const hasInfinite = hasInfiniteRaw as (c: CompiledAnimation) => boolean
export const parseTrackValue = parseTrackValueRaw as (
  value: number | string,
  prop: AnimProp,
) => { n: number; unit: string } | null

export type AppearMode = 'once' | 'replay' | 'reverse'
export type SiteMotion = NonNullable<ProjectSettings['motion']>

export const effectiveAppearMode = effectiveAppearModeRaw as (
  bindingMode: AppearMode | undefined,
  siteDefault: AppearMode | undefined,
) => AppearMode
export const resolveTransition = resolveTransitionRaw as (
  motion: SiteMotion | undefined,
  animationsById?: Record<string, Animation>,
) => { exit: Animation | null; enter: Animation | null } | null
export const resolveScrollLerp = resolveScrollLerpRaw as (
  motion: SiteMotion | undefined,
) => number | null
export const validateMotionSettings = validateMotionSettingsRaw as (
  motion: unknown,
  ctx?: { animationIds?: string[] },
) => ValidationResult
export {
  animationBindingKey,
  appearRootMargin,
  lerpColor,
  parseColor,
  motionBreakpointId,
  MOTION_CSS_PROPS,
  SCRUB_DEFAULTS,
  APPEAR_AT_DEFAULT,
  APPEAR_MODES,
  TRANSITION_PRESET_IDS,
  TRANSITION_DEFAULTS,
  TRANSITION_EXIT_ID,
  TRANSITION_ENTER_ID,
  SCROLL_LERP_DEFAULT,
  SCROLL_LERP_MIN,
  SCROLL_LERP_MAX,
}

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
