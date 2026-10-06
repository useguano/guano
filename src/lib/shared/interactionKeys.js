// Interaction key identity, shared VERBATIM by the editor (useInteraction), the
// static exporter (server/export.mjs) and the published runtime
// (server/site-runtime.js). Plain JS so all three sides key state identically —
// if they ever disagree, the canvas and the live site behave differently.
//
// THE DISTINCTION THAT MATTERS:
//
//   binding key  — one per InteractionBinding (`bindingId@scope`). Identifies an
//                  APPLICATION of an interaction: which element triggers it, on
//                  which breakpoints. Used for breakpoint gating only.
//   state key    — one per (interaction, target) pair (`interactionId:targetId@scope`).
//                  Identifies the EFFECT: whether those classes are currently on.
//
// State used to be keyed by binding id, which meant two bindings of the same
// interaction onto the same target held two independent booleans — so a close
// button could never undo what an open button did (it flipped its own boolean and
// the to-classes were applied twice). Keying state by (interaction, target) is
// what makes "open with A, close with B" work, and it is why modals, drawers,
// overlay dismissals and close buttons are buildable at all.

/**
 * The key interaction STATE is held under: one boolean per (interaction, target)
 * within a scope, so any number of triggers drive the same effect.
 * @param {string} interactionId
 * @param {string} targetId the node the classes land on (never null — callers
 *   resolve `binding.targetId ?? ownerId` first)
 * @param {string} [scope] component instance + collection-list repeat isolation
 * @returns {string}
 */
export function interactionStateKey(interactionId, targetId, scope) {
  const base = `${interactionId}:${targetId}`
  return scope ? `${base}@${scope}` : base
}

/**
 * The key an exclusive GROUP is tracked under. Deliberately scoped to the
 * component INSTANCE only and never to the collection-list repeat: "one
 * accordion open at a time" has to hold ACROSS the repeats of one list (that is
 * the whole point), while two instances of the same component stay independent.
 * @param {string} group author-chosen group name
 * @param {string} [instanceScope] the component instance part of the scope only
 * @returns {string}
 */
export function interactionGroupKey(group, instanceScope) {
  return instanceScope ? `${group}@${instanceScope}` : group
}

// ---------- channels ----------
//
// A CHANNEL is a target that is a NAME rather than a node id: a binding sets
// `targetId: "@start"`, and any element anywhere in the project that declares
// `channel: "start"` listens on it. That is what makes one shared overlay
// openable from a header component on every route — a node id addresses ONE
// tree, and a master's binding keys per instance, so before channels the modal
// had to live inside whatever component opened it.
//
// THE RULE: a channel target is UNSCOPED. No component instance, no entry.
// A channel is site-wide by definition, so attaching either scope would be the
// same mismatch that made a row button and a shared sheet write two different
// keys — the trigger would say `X@<instance>` while the listener, rendered
// somewhere else entirely, listened on `X`.

/** a channel name: lowercase, hyphenated, at most 40 characters */
export const CHANNEL_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/

/** `@` names the format already owns, so neither can be a channel */
const RESERVED_CHANNEL_NAMES = new Set(['item', 'locale'])

/**
 * Is this `targetId` a channel rather than a node id?
 * @param {string|null|undefined} targetId
 * @returns {boolean}
 */
export function isChannelTarget(targetId) {
  if (typeof targetId !== 'string' || targetId[0] !== '@') return false
  const name = targetId.slice(1)
  return CHANNEL_NAME_RE.test(name) && !RESERVED_CHANNEL_NAMES.has(name)
}

/** the name a channel target carries, or null when it is not one */
export function channelName(targetId) {
  return isChannelTarget(targetId) ? targetId.slice(1) : null
}

/** the stored `targetId` for a channel name */
export function channelTargetId(name) {
  return `@${name}`
}

/** is this a name an element may declare as its channel? */
export function isChannelName(name) {
  return typeof name === 'string' && CHANNEL_NAME_RE.test(name) && !RESERVED_CHANNEL_NAMES.has(name)
}

/** what a trigger does to its target's state. `toggle` is the default. */
export const INTERACTION_ACTIONS = ['toggle', 'on', 'off']

/** every trigger an interaction binding can use.
 * hover   — on while the pointer is over the trigger (symmetric, ignores action)
 * click   — on click; honours action
 * appear  — first time the trigger scrolls into view (fires once, never unfires)
 * scrolled— while the page is scrolled past `scrollAt` px (symmetric)
 * change  — an input's checked/non-empty state (symmetric, for conditional fields)
 * load    — on as soon as the page renders, and never off (like appear, without
 *           waiting for the viewport) */
export const INTERACTION_TRIGGERS = ['hover', 'click', 'appear', 'scrolled', 'change', 'load']

/** user gestures that dismiss (force OFF) a fired interaction */
export const INTERACTION_CLOSE_ON = ['outside', 'escape']

/** where a `once` binding remembers its state */
export const INTERACTION_ONCE = ['session', 'local']

/** default scroll offset (px) for the `scrolled` trigger */
export const DEFAULT_SCROLL_AT = 50

/** triggers whose state is derived from a condition and so ignore `action`
 * (firing and unfiring are both driven by the trigger itself). `load` is here
 * too: it has no second direction to force, so an action on it would be a
 * silent no-op. */
const SYMMETRIC_TRIGGERS = new Set(['hover', 'scrolled', 'change', 'load'])

/** true when the trigger drives state in both directions on its own */
export function isSymmetricTrigger(trigger) {
  return SYMMETRIC_TRIGGERS.has(trigger)
}

/**
 * The next state for a binding fired by a discrete gesture (click).
 * @param {string|undefined} action
 * @param {boolean} current
 * @returns {boolean}
 */
export function nextInteractionState(action, current) {
  if (action === 'on') return true
  if (action === 'off') return false
  return !current
}
