import { test, expect } from '@playwright/test'
import { computeMerge, unionComments } from '../src/lib/merge'
import type { Comment, Effect, Project } from '../src/types/editor'

// The 3-way draft merge (`computeMerge`) had no coverage at all, which is how
// F3 shipped: every top-level id-keyed list is merged by one helper, but
// `effects` was spread onto the result CONDITIONALLY, so an empty merged list
// — a draft that deleted the last effect — left `...mine` (Main's) in place and
// the deletion read as "nothing changed". Pure, like the merge itself: the
// merge runs client-side in `useBranches`, with no server round-trip to drive.
//
// Comments are the one list that does not follow the id-keyed rule: they are
// review feedback, so they UNION and never conflict. They did not merge at all
// before — whichever side the person applying the draft was sitting on kept
// its list and the other side's threads were destroyed.

const effect = (id: string, name: string): Effect => ({
  id,
  name,
  interactionId: `i-${id}`,
  animationId: `a-${id}`,
})

function project(effects?: Effect[]): Project {
  const base: Project = {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        slug: '',
        status: 'published',
        elements: [{ id: 'b1', type: 'body' }],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
    animations: [],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: { tokens: [] },
  } as unknown as Project
  if (effects) base.effects = effects
  return base
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const comment = (id: string, text: string, extra: Partial<Comment> = {}): Comment => ({
  id,
  pageId: 'p1',
  text,
  author: 'Dana',
  resolved: false,
  createdAt: 1000,
  replies: [],
  ...extra,
})

/** a project carrying a comment list */
function withComments(comments: Comment[]): Project {
  const p = project()
  p.comments = comments
  return p
}

test('a draft that deletes the last effect is applied, not reverted', () => {
  const base = project([effect('e1', 'Fade in')])
  const main = clone(base)
  const branch = project([]) // the draft deleted it

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.effects ?? []).toEqual([])
})

test('a draft that deletes one of two effects keeps the other', () => {
  const base = project([effect('e1', 'Fade in'), effect('e2', 'Slide up')])
  const main = clone(base)
  const branch = project([effect('e2', 'Slide up')])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.effects?.map((e) => e.id)).toEqual(['e2'])
})

test('a draft that adds an effect merges it into an untouched Main', () => {
  const base = project()
  const main = clone(base)
  const branch = project([effect('e1', 'Fade in')])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.effects?.map((e) => e.name)).toEqual(['Fade in'])
})

test('a draft that renames an effect Main also renamed conflicts, defaulting to Main', () => {
  const base = project([effect('e1', 'Fade in')])
  const main = project([{ ...effect('e1', 'Main name') }])
  const branch = project([{ ...effect('e1', 'Draft name') }])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts.map((c) => c.key)).toEqual(['effect:e1'])
  expect(merged.effects?.[0].name).toBe('Main name')
})

test('a project with no effects on any side stays byte-identical', () => {
  // the key is deleted again when the merge finds none, which is what keeps
  // the next merge's JSON.stringify signatures stable
  const base = project()
  const { merged } = computeMerge(base, clone(base), clone(base))
  expect('effects' in merged).toBe(false)
  expect(JSON.stringify(merged)).toBe(JSON.stringify(base))
})

// ---------- comments ----------

test('a thread started in the draft survives the merge', () => {
  const base = withComments([])
  const main = withComments([comment('c-main', 'Main thread')])
  const branch = withComments([comment('c-draft', 'Started while drafting')])

  const { merged, conflicts } = computeMerge(base, main, branch)

  // both sides' feedback, and nothing for the user to resolve
  expect(conflicts).toEqual([])
  expect(merged.comments.map((c) => c.id)).toEqual(['c-main', 'c-draft'])
})

test('both sides replying to one thread keeps both replies, in order', () => {
  const thread = comment('c1', 'Which blue?')
  const base = withComments([thread])
  const main = withComments([
    { ...clone(thread), replies: [{ id: 'r-main', text: 'The darker one', author: 'Ana', createdAt: 2000 }] },
  ])
  const branch = withComments([
    { ...clone(thread), replies: [{ id: 'r-draft', text: 'Tried it, too flat', author: 'Bo', createdAt: 3000 }] },
  ])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.comments[0].replies.map((r) => r.id)).toEqual(['r-main', 'r-draft'])
})

test('resolving a thread in the draft carries over, untouched on Main', () => {
  const thread = comment('c1', 'Typo in the footer')
  const base = withComments([thread])
  const main = withComments([clone(thread)])
  const branch = withComments([{ ...clone(thread), resolved: true }])

  const { merged } = computeMerge(base, main, branch)

  expect(merged.comments[0].resolved).toBe(true)
})

test('a thread the draft deleted goes; one Main deleted stays gone', () => {
  const dropped = comment('c-draft-deleted', 'Fixed, no longer relevant')
  const gone = comment('c-main-deleted', 'Deleted on Main')
  const base = withComments([dropped, gone])
  const main = withComments([clone(dropped)]) // Main deleted `gone`
  const branch = withComments([clone(gone)]) // the draft deleted `dropped`

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.comments).toEqual([])
})

test('an untouched comment list stays byte-identical', () => {
  // the merge runs on every apply, and a list that comes back reordered or
  // rebuilt would move the signatures the NEXT merge compares
  const base = withComments([
    comment('c1', 'One', { replies: [{ id: 'r1', text: 'Sure', author: 'Ana', createdAt: 1500 }] }),
    comment('c2', 'Two'),
  ])
  const { merged } = computeMerge(base, clone(base), clone(base))
  expect(JSON.stringify(merged)).toBe(JSON.stringify(base))
})

test('switching branches unions the shared list rather than overwriting it', () => {
  // no base snapshot exists for a switch, so it errs towards keeping: the
  // overwrite it replaced wiped every thread the branch being opened held
  const here = [comment('c1', 'On this branch')]
  const there = [comment('c2', 'On the one being opened')]
  expect(unionComments(here, there).map((c) => c.id)).toEqual(['c1', 'c2'])
  // and an identical list comes back untouched
  expect(JSON.stringify(unionComments(here, clone(here)))).toBe(JSON.stringify(here))
})
