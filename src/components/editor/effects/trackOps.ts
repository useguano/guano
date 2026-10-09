import { MOTION_PROPS } from '@/lib/motion'
import type { AnimProp, AnimationStep, AnimationTrack } from '@/types/editor'

export const PROP_OPTIONS = (Object.keys(MOTION_PROPS) as AnimProp[]).map((p) => ({
  label: MOTION_PROPS[p].label,
  value: p,
}))

export const isColor = (prop: AnimProp) => MOTION_PROPS[prop].kind === 'color'
export const isCount = (prop: AnimProp) => MOTION_PROPS[prop].kind === 'text'

export const numText = (v: number | string | undefined) => (v === undefined ? '' : String(v))

const TRACK_VALUE_RE = /^-?\d+(\.\d+)?(px|%|em|rem|vw|vh|deg)?$/
export const isTrackValue = (text: string) =>
  text.trim() === '' || TRACK_VALUE_RE.test(text.trim())

export function trackValue(text: string): number | string {
  const t = text.trim()
  const n = parseFloat(t)
  return /^-?\d+(\.\d+)?$/.test(t) ? (isFinite(n) ? n : 0) : t
}

export function trackSummary(track: AnimationTrack): string {
  const from = track.from === undefined ? 'auto' : String(track.from)
  return `${from} → ${track.to ?? ''}`
}

export function setFormat<K extends keyof NonNullable<AnimationTrack['format']>>(
  track: AnimationTrack,
  key: K,
  value: NonNullable<AnimationTrack['format']>[K],
) {
  const f = (track.format ??= {})
  if (value === undefined || value === '' || value === false) delete f[key]
  else f[key] = value
  if (!Object.keys(f).length) delete track.format
}

export function addTrack(step: AnimationStep) {
  const used = new Set(step.tracks.map((t) => t.prop))
  const next = (Object.keys(MOTION_PROPS) as AnimProp[]).find((p) => !used.has(p)) ?? 'opacity'
  step.tracks.push({
    prop: next,
    from: isColor(next) ? '#000000' : 0,
    to: isColor(next) ? '#ffffff' : 1,
  })
}

export function duplicateTrack(step: AnimationStep, index: number) {
  const track = step.tracks[index]
  if (!track) return
  step.tracks.splice(index + 1, 0, structuredClone(track))
}

export function removeTrack(step: AnimationStep, index: number) {
  step.tracks.splice(index, 1)
}

export function setTrackProp(step: AnimationStep, index: number, prop: AnimProp) {
  const track = step.tracks[index]
  if (!track) return
  track.prop = prop
  if (isColor(prop)) {
    track.from = '#000000'
    track.to = '#ffffff'
  } else {
    track.from = MOTION_PROPS[prop].def as number
    track.to = prop === 'opacity' || prop === 'scale' ? 1 : 100
  }
  if (!isCount(prop)) delete track.format
}
