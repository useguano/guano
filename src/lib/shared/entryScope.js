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
      if (root) index.set(n.id, root)
      walk(n.children, isEntryScopeRoot(n) ? n.id : root)
    }
  }
  for (const { tree, root } of trees) walk(tree, root ?? null)
  return index
}

export function isEntryScopeRoot(node) {
  return node.type === 'collection-list' || (node.type === 'slider' && !!node.arg)
}

export function entryScopePart(scopeRoots, ownerId, targetId, entryId) {
  if (!entryId) return null
  const of = (id) => scopeRoots?.get(id) ?? null
  return of(ownerId) === of(targetId) ? `e${entryId}` : null
}

export function bindingScope(instanceId, entryPart) {
  return [instanceId, entryPart].filter(Boolean).join('~') || undefined
}
