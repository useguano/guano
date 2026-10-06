// The Interactions panel's vocabulary: WHEN an effect runs.
//
// The panel is trigger-first — you say when, then what — so the trigger list is
// one table rather than two per-engine lists. The user never picks an engine:
// `kinds` is how the action picker silently offers only effects the trigger can
// actually run — which, after the two engines were brought level, is everything
// except a class change on `scrub`.
//
// The keys ARE the stored trigger values. The two enums
// (`InteractionTrigger` and `AnimationBinding['trigger']`) share one namespace
// and now agree on everything but ONE row: a `scrub` is continuous progress and
// a class is on or off, so there is nothing for a class change to follow. Every
// other trigger runs either engine, which is why `kinds` is nearly always both.
import { ChevronsDown, Eye, MousePointer2, MousePointerClick, MoveVertical, ToggleLeft, Zap } from 'lucide-vue-next'
import type { Component } from 'vue'

/** which motion system runs an effect. The UI never says these words. */
export type EffectKind = 'interaction' | 'animation'

export interface UiTrigger {
  /** the value stored on the binding */
  key: string
  /** the "+ Trigger" menu label */
  label: string
  /** the section heading */
  sentence: string
  /** the one word a collapsed row leads with */
  word: string
  icon: Component
  /** the engines this trigger can drive — the action picker's filter */
  kinds: EffectKind[]
  /** one line in the menu, so the choice doesn't need the guide */
  hint: string
}

const BOTH: EffectKind[] = ['interaction', 'animation']

/**
 * Reading order, most-reached first. Sections render in this order whatever
 * order the bindings were added in, so the panel looks the same every time.
 */
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
    // the one engine split left: a scrub is CONTINUOUS progress and a class is
    // on or off, so there is nothing for a class change to follow
    kinds: ['animation'],
    hint: 'Progress follows the scroll position, both ways.',
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

/** the section heading for a stored trigger (falls back to the raw value) */
export function triggerSentence(key: string): string {
  return BY_KEY.get(key)?.sentence ?? key
}

/** can this trigger run that engine? */
export function triggerAllows(key: string, kind: EffectKind): boolean {
  return !!BY_KEY.get(key)?.kinds.includes(kind)
}

/** sort comparator putting trigger sections in reading order */
export function triggerOrder(key: string): number {
  const i = UI_TRIGGERS.findIndex((t) => t.key === key)
  return i === -1 ? UI_TRIGGERS.length : i
}

/** only `click` is discrete, so only it can be aimed with a verb */
export function isDiscreteTrigger(key: string): boolean {
  return key === 'click'
}

/** what a click does to the state it drives, said as a verb */
export const ACTION_VERBS = [
  { label: 'Toggle', value: 'toggle' },
  { label: 'Open', value: 'on' },
  { label: 'Close', value: 'off' },
]
