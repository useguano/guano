import type {
  Animation,
  Breakpoint,
  Collection,
  Comment,
  CommentReply,
  ComponentDef,
  Effect,
  Interaction,
  Page,
  Project,
  ProjectSettings,
} from '@/types/editor'
import { deepClone } from './tree'

export type Resolution = 'mine' | 'theirs'

export interface MergeConflict {
  key: string
  label: string
  kind: 'changed' | 'deleted-in-branch' | 'deleted-in-main'
  theirs:
    | Page
    | ComponentDef
    | Collection
    | Interaction
    | Animation
    | Breakpoint[]
    | LocalePack
    | ProjectSettings
    | null
}

export interface LocalePack {
  locales: string[]
  defaultLocale: string
}

export interface MergeResult {
  merged: Project
  conflicts: MergeConflict[]
}

const sig = (value: unknown) => JSON.stringify(value ?? null)

function mergeItemList<T extends { id: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  keyPrefix: string,
  labelFn: (item: T) => string,
): { merged: T[]; conflicts: MergeConflict[] } {
  const baseMap = new Map(base.map((x) => [x.id, x]))
  const mineMap = new Map(mine.map((x) => [x.id, x]))
  const theirMap = new Map(theirs.map((x) => [x.id, x]))
  const merged: T[] = []
  const conflicts: MergeConflict[] = []
  const conflict = (item: T, kind: MergeConflict['kind'], theirsSide: T | null) =>
    conflicts.push({
      key: `${keyPrefix}${item.id}`,
      label: labelFn(item),
      kind,
      theirs: theirsSide as MergeConflict['theirs'],
    })

  for (const mineItem of mine) {
    const baseItem = baseMap.get(mineItem.id)
    const theirItem = theirMap.get(mineItem.id)
    if (!baseItem) {
      merged.push(mineItem)
      continue
    }
    const mineChanged = sig(mineItem) !== sig(baseItem)
    if (theirItem) {
      const theirsChanged = sig(theirItem) !== sig(baseItem)
      if (theirsChanged && !mineChanged) {
        merged.push(theirItem)
      } else if (theirsChanged && mineChanged && sig(mineItem) !== sig(theirItem)) {
        merged.push(mineItem)
        conflict(mineItem, 'changed', theirItem)
      } else {
        merged.push(mineItem)
      }
    } else if (!mineChanged) {
    } else {
      merged.push(mineItem)
      conflict(mineItem, 'deleted-in-branch', null)
    }
  }

  for (const theirItem of theirs) {
    if (mineMap.has(theirItem.id)) continue
    const baseItem = baseMap.get(theirItem.id)
    if (!baseItem) {
      merged.push(theirItem)
    } else if (sig(theirItem) !== sig(baseItem)) {
      conflict(theirItem, 'deleted-in-main', theirItem)
    }
  }

  return { merged, conflicts }
}

function unionReplies(mine: CommentReply[] = [], theirs: CommentReply[] = []): CommentReply[] {
  if (sig(mine) === sig(theirs)) return mine
  const have = new Set(mine.map((r) => r.id))
  const extra = theirs.filter((r) => !have.has(r.id))
  if (!extra.length) return mine
  return [...mine, ...extra].sort((a, b) => a.createdAt - b.createdAt)
}

function mergeComment(base: Comment | undefined, mine: Comment, theirs: Comment): Comment {
  const mineChanged = sig(mine) !== sig(base)
  const theirsChanged = sig(theirs) !== sig(base)
  const picked = theirsChanged && !mineChanged ? theirs : mine
  const replies = unionReplies(mine.replies, theirs.replies)
  return sig(replies) === sig(picked.replies) ? picked : { ...picked, replies }
}

function mergeComments(base: Comment[], mine: Comment[], theirs: Comment[]): Comment[] {
  const baseMap = new Map(base.map((c) => [c.id, c]))
  const mineMap = new Map(mine.map((c) => [c.id, c]))
  const theirMap = new Map(theirs.map((c) => [c.id, c]))
  const merged: Comment[] = []

  for (const mineItem of mine) {
    const baseItem = baseMap.get(mineItem.id)
    const theirItem = theirMap.get(mineItem.id)
    if (theirItem) {
      merged.push(mergeComment(baseItem, mineItem, theirItem))
    } else if (baseItem && sig(mineItem) === sig(baseItem)) {
    } else {
      merged.push(mineItem)
    }
  }
  for (const theirItem of theirs) {
    if (mineMap.has(theirItem.id)) continue
    if (!baseMap.has(theirItem.id)) merged.push(theirItem)
  }
  return merged
}

export function unionComments(mine: Comment[], theirs: Comment[]): Comment[] {
  const theirMap = new Map(theirs.map((c) => [c.id, c]))
  const mineMap = new Map(mine.map((c) => [c.id, c]))
  const merged = mine.map((c) => {
    const other = theirMap.get(c.id)
    if (!other) return c
    const replies = unionReplies(c.replies, other.replies)
    return sig(replies) === sig(c.replies) ? c : { ...c, replies }
  })
  for (const c of theirs) if (!mineMap.has(c.id)) merged.push(c)
  return merged
}

function applyToList<T extends { id: string }>(list: T[], id: string, theirs: T | null) {
  const at = list.findIndex((x) => x.id === id)
  if (theirs === null) {
    if (at !== -1) list.splice(at, 1)
  } else if (at !== -1) {
    list[at] = theirs
  } else {
    list.push(theirs)
  }
}

export function computeMerge(base: Project, mine: Project, theirs: Project): MergeResult {
  const pages = mergeItemList(base.pages, mine.pages, theirs.pages, 'page:', (p) => p.name)
  const components = mergeItemList(
    base.components,
    mine.components,
    theirs.components,
    'component:',
    (c) => `Component ${c.name}`,
  )
  const collections = mergeItemList(
    base.collections,
    mine.collections,
    theirs.collections,
    'collection:',
    (c) => `Collection ${c.name}`,
  )
  const interactions = mergeItemList(
    base.interactions ?? [],
    mine.interactions ?? [],
    theirs.interactions ?? [],
    'interaction:',
    (i) => `Interaction ${i.name}`,
  )
  const animations = mergeItemList(
    base.animations ?? [],
    mine.animations ?? [],
    theirs.animations ?? [],
    'animation:',
    (a) => `Animation ${a.name}`,
  )
  const effects = mergeItemList(
    base.effects ?? [],
    mine.effects ?? [],
    theirs.effects ?? [],
    'effect:',
    (e) => `Effect ${e.name}`,
  )
  const conflicts: MergeConflict[] = [
    ...pages.conflicts,
    ...components.conflicts,
    ...collections.conflicts,
    ...interactions.conflicts,
    ...animations.conflicts,
    ...effects.conflicts,
  ]

  let mergedBreakpoints = mine.breakpoints
  const bpMineChanged = sig(mine.breakpoints) !== sig(base.breakpoints)
  const bpTheirsChanged = sig(theirs.breakpoints) !== sig(base.breakpoints)
  if (bpTheirsChanged && !bpMineChanged) {
    mergedBreakpoints = theirs.breakpoints
  } else if (bpTheirsChanged && bpMineChanged && sig(mine.breakpoints) !== sig(theirs.breakpoints)) {
    conflicts.push({
      key: 'breakpoints',
      label: 'Breakpoints',
      kind: 'changed',
      theirs: theirs.breakpoints,
    })
  }

  const localePack = (p: Project): LocalePack => ({
    locales: p.locales,
    defaultLocale: p.defaultLocale,
  })
  let mergedLocales = localePack(mine)
  const locMineChanged = sig(localePack(mine)) !== sig(localePack(base))
  const locTheirsChanged = sig(localePack(theirs)) !== sig(localePack(base))
  if (locTheirsChanged && !locMineChanged) {
    mergedLocales = localePack(theirs)
  } else if (
    locTheirsChanged &&
    locMineChanged &&
    sig(localePack(mine)) !== sig(localePack(theirs))
  ) {
    conflicts.push({
      key: 'locales',
      label: 'Locales',
      kind: 'changed',
      theirs: localePack(theirs),
    })
  }

  let mergedSettings = mine.settings
  const setMineChanged = sig(mine.settings) !== sig(base.settings)
  const setTheirsChanged = sig(theirs.settings) !== sig(base.settings)
  if (setTheirsChanged && !setMineChanged) {
    mergedSettings = theirs.settings
  } else if (setTheirsChanged && setMineChanged && sig(mine.settings) !== sig(theirs.settings)) {
    conflicts.push({
      key: 'settings',
      label: 'Project settings',
      kind: 'changed',
      theirs: theirs.settings,
    })
  }

  const merged: Project = {
    ...mine,
    pages: pages.merged,
    components: components.merged,
    collections: collections.merged,
    interactions: interactions.merged,
    animations: animations.merged,
    effects: effects.merged,
    breakpoints: mergedBreakpoints,
    comments: mergeComments(base.comments ?? [], mine.comments ?? [], theirs.comments ?? []),
    locales: mergedLocales.locales,
    defaultLocale: mergedLocales.defaultLocale,
    settings: mergedSettings,
  }
  if (!merged.effects?.length) delete merged.effects
  return { merged, conflicts }
}

export function applyResolutions(
  result: MergeResult,
  choices: Record<string, Resolution>,
): Project {
  const merged = deepClone(result.merged) as Project
  for (const conflict of result.conflicts) {
    if (choices[conflict.key] !== 'theirs') continue
    if (conflict.key === 'breakpoints') {
      merged.breakpoints = conflict.theirs as Breakpoint[]
      continue
    }
    if (conflict.key === 'locales') {
      const pack = conflict.theirs as LocalePack
      merged.locales = pack.locales
      merged.defaultLocale = pack.defaultLocale
      continue
    }
    if (conflict.key === 'settings') {
      merged.settings = conflict.theirs as ProjectSettings
      continue
    }
    if (conflict.key.startsWith('component:')) {
      applyToList(
        merged.components,
        conflict.key.slice('component:'.length),
        conflict.theirs as ComponentDef | null,
      )
      continue
    }
    if (conflict.key.startsWith('collection:')) {
      applyToList(
        merged.collections,
        conflict.key.slice('collection:'.length),
        conflict.theirs as Collection | null,
      )
      continue
    }
    if (conflict.key.startsWith('interaction:')) {
      applyToList(
        merged.interactions,
        conflict.key.slice('interaction:'.length),
        conflict.theirs as Interaction | null,
      )
      continue
    }
    if (conflict.key.startsWith('animation:')) {
      applyToList(
        merged.animations,
        conflict.key.slice('animation:'.length),
        conflict.theirs as Animation | null,
      )
      continue
    }
    if (conflict.key.startsWith('effect:')) {
      merged.effects ??= []
      applyToList(
        merged.effects,
        conflict.key.slice('effect:'.length),
        conflict.theirs as Effect | null,
      )
      continue
    }
    applyToList(merged.pages, conflict.key.slice('page:'.length), conflict.theirs as Page | null)
  }
  return merged
}

export interface ChangeSummary {
  pages: number
  components: number
  collections: number
  interactions: number
  animations: number
  effects: number
  breakpoints: boolean
  locales: boolean
  settings: boolean
}

function countListChanges<T extends { id: string }>(base: T[], current: T[]): number {
  const baseMap = new Map(base.map((x) => [x.id, x]))
  let changes = 0
  for (const item of current) {
    const baseItem = baseMap.get(item.id)
    if (!baseItem || sig(item) !== sig(baseItem)) changes++
    baseMap.delete(item.id)
  }
  return changes + baseMap.size
}

export function summarizeChanges(base: Project, current: Project): ChangeSummary {
  const pack = (p: Project): LocalePack => ({ locales: p.locales, defaultLocale: p.defaultLocale })
  return {
    pages: countListChanges(base.pages, current.pages),
    components: countListChanges(base.components, current.components),
    collections: countListChanges(base.collections, current.collections),
    interactions: countListChanges(base.interactions ?? [], current.interactions ?? []),
    animations: countListChanges(base.animations ?? [], current.animations ?? []),
    effects: countListChanges(base.effects ?? [], current.effects ?? []),
    breakpoints: sig(current.breakpoints) !== sig(base.breakpoints),
    locales: sig(pack(current)) !== sig(pack(base)),
    settings: sig(current.settings) !== sig(base.settings),
  }
}

export function hasChanges(s: ChangeSummary): boolean {
  return (
    s.pages + s.components + s.collections + s.interactions + s.animations + s.effects > 0 ||
    s.breakpoints ||
    s.locales ||
    s.settings
  )
}

export function changeSummaryLabel(s: ChangeSummary): string {
  const count = (n: number, word: string) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : null)
  return [
    count(s.pages, 'page'),
    count(s.components, 'component'),
    count(s.collections, 'collection'),
    count(s.interactions, 'interaction'),
    count(s.animations, 'animation'),
    count(s.effects, 'effect'),
    s.breakpoints ? 'breakpoints' : null,
    s.locales ? 'locales' : null,
    s.settings ? 'settings' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
