import { ChevronsDown, Eye, Move3d, MousePointer2, MousePointerClick, MoveVertical, ToggleLeft, Zap } from 'lucide-vue-next'
import type { Component } from 'vue'

export type EffectKind = 'interaction' | 'animation'

export interface UiTrigger {
  key: string
  label: string
  sentence: string
  word: string
  icon: Component
  kinds: EffectKind[]
  hint: string
}

const BOTH: EffectKind[] = ['interaction', 'animation']

export const UI_TRIGGERS: UiTrigger[] = [
  {
    key: 'click',
    label: 'Click',
    sentence: 'On click',
    word: 'Click',
    icon: MousePointerClick,
    kinds: BOTH,
    hint: 'A tap or a click on this element.',
  },
  {
    key: 'hover',
    label: 'Hover',
    sentence: 'On hover',
    word: 'Hover',
    icon: MousePointer2,
    kinds: BOTH,
    hint: 'While the pointer is over this element.',
  },
  {
    key: 'appear',
    label: 'Scroll into view',
    sentence: 'On scroll into view',
    word: 'Appear',
    icon: Eye,
    kinds: BOTH,
    hint: 'The first time this element reaches the viewport.',
  },
  {
    key: 'scrub',
    label: 'While scrolling',
    sentence: 'While scrolling',
    word: 'Scroll',
    icon: ChevronsDown,
    kinds: ['animation'],
    hint: 'Progress follows the scroll position, both ways.',
  },
  {
    key: 'mouse',
    label: 'Mouse move',
    sentence: 'While the mouse moves',
    word: 'Mouse',
    icon: Move3d,
    kinds: ['animation'],
    hint: 'Progress follows the pointer across one axis, both ways.',
  },
  {
    key: 'scrolled',
    label: 'Scrolled past',
    sentence: 'Once scrolled past',
    word: 'Scrolled',
    icon: MoveVertical,
    kinds: BOTH,
    hint: 'While the page is scrolled past a number of pixels.',
  },
  {
    key: 'change',
    label: 'Input change',
    sentence: 'On input change',
    word: 'Change',
    icon: ToggleLeft,
    kinds: BOTH,
    hint: "A form control's checked or non-empty state.",
  },
  {
    key: 'load',
    label: 'Page load',
    sentence: 'On page load',
    word: 'Load',
    icon: Zap,
    kinds: BOTH,
    hint: 'As soon as the page renders.',
  },
]

const BY_KEY = new Map(UI_TRIGGERS.map((t) => [t.key, t]))

export function uiTrigger(key: string): UiTrigger | undefined {
  return BY_KEY.get(key)
}

export function triggerSentence(key: string): string {
  return BY_KEY.get(key)?.sentence ?? key
}

export function triggerAllows(key: string, kind: EffectKind): boolean {
  return !!BY_KEY.get(key)?.kinds.includes(kind)
}

export function triggerOrder(key: string): number {
  const i = UI_TRIGGERS.findIndex((t) => t.key === key)
  return i === -1 ? UI_TRIGGERS.length : i
}

export function isDiscreteTrigger(key: string): boolean {
  return key === 'click'
}

export const ACTION_VERBS = [
  { label: 'Switch', value: 'toggle' },
  { label: 'Turn on', value: 'on' },
  { label: 'Turn off', value: 'off' },
]

