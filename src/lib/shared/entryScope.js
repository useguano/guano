// Shared by the editor (useInteraction), both Vue renderers and
// server/export.mjs. ONE implementation: the canvas and the published site
// must agree on every interaction/animation key, or an effect that works on
// one is inert on the other.

/**
 * Which nodes a route renders under an ENTRY SCOPE, and which scope.
 *
 * A node is in an entry scope when it is repeated or embedded per entry: inside
 * a `:collection-list`, inside a bound `:slider`, or in the template body a
 * `:collection-item` embeds. Everything else renders ONCE per route.
 *
 * This is what decides whether a binding's state key carries the entry part.
 * The entry part is carried only when a binding's OWNER and its TARGET share a
 * scope — both inside one repeat (a per-row effect, independent per row) or
 * both outside every repeat (one shared effect). A row button that opens one
 * sheet outside the list therefore keys its effect exactly the way the sheet
 * keys it. Keyed off the trigger alone, the button wrote `X@e<row>` while the
 * sheet listened on `X`, so the click silently did nothing — which made the
 * "ONE overlay per kind, outside the list" recipe unbuildable.
 *
 * @param {Array<{tree: any[], root: string|null}>} trees
 * @returns {Map<string, string>} node id → scope root id (absent = no scope)
 */
export function buildScopeRoots(trees) {
  const index = new Map()
  const walk = (nodes, root) => {
    for (const n of nodes ?? []) {
      // a repeat's OWN node renders once, under the scope around it — only its
      // children are per-entry
      if (root) index.set(n.id, root)
      walk(n.children, isEntryScopeRoot(n) ? n.id : root)
    }
  }
  for (const { tree, root } of trees) walk(tree, root ?? null)
  return index
}

/** does this node render its children once per entry? */
export function isEntryScopeRoot(node) {
  return node.type === 'collection-list' || (node.type === 'slider' && !!node.arg)
}

/**
 * The entry part of a binding's scope: carried only when owner and target share
 * an entry scope. `entryId` is the entry being rendered, if any.
 */
export function entryScopePart(scopeRoots, ownerId, targetId, entryId) {
  if (!entryId) return null
  const of = (id) => scopeRoots?.get(id) ?? null
  return of(ownerId) === of(targetId) ? `e${entryId}` : null
}

/**
 * Join the two halves of a binding scope into the string the key carries.
 * `instanceId` isolates one component instance from another; the entry part
 * isolates one row of a repeat from the next.
 */
export function bindingScope(instanceId, entryPart) {
  return [instanceId, entryPart].filter(Boolean).join('~') || undefined
}
