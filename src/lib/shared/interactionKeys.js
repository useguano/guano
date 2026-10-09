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

export const CHANNEL_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/

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

export function channelName(targetId) {
  return isChannelTarget(targetId) ? targetId.slice(1) : null
}

export function channelTargetId(name) {
  return `@${name}`
}

export function isChannelName(name) {
  return typeof name === 'string' && CHANNEL_NAME_RE.test(name) && !RESERVED_CHANNEL_NAMES.has(name)
}

export const INTERACTION_ACTIONS = ['toggle', 'on', 'off']

export const INTERACTION_TRIGGERS = ['hover', 'click', 'appear', 'scrolled', 'change', 'load']

export const INTERACTION_CLOSE_ON = ['outside', 'escape']

export const INTERACTION_ONCE = ['session', 'local']

export const DEFAULT_SCROLL_AT = 50

const SYMMETRIC_TRIGGERS = new Set(['hover', 'scrolled', 'change', 'load'])

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
