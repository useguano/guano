export const isComponentType = (type) => /^[A-Z]/.test(type)

/**
 * Does this `:Name` instance wrapper emit NO element of its own?
 *
 * A wrapper is a logical grouping, not a visual box: with nothing to say it
 * renders its children inline (the exporter emits no tag at all; the canvas
 * uses `display: contents`) so `header → component` stays a bare `<header>`
 * rather than `<div><header>`.
 *
 * The RULE lives here because the three renderers each had their own version of
 * it and they checked DIFFERENT things. The exporter tested own classes, the
 * master's background and the master's declared interactions; the canvas tested
 * own classes, the classes an interaction TARGETING it contributes, the
 * master's animations and its background. The exporter's gaps were silent and
 * total: it returns before `attrsFor` runs, so a wrapper it judged bare lost
 * `data-tgt`, `data-anim` and its whole `ctx.fx` / `int-modal` registration.
 * A channel declared on a master ROOT therefore published a modal that nothing
 * could open, intermittently — adding one class to the root "fixed" it.
 *
 * `targeted` is the one part a caller must resolve, because "is anything aimed
 * at this node" comes from a different index in each renderer.
 *
 * @param {object} node the wrapper (any node; false unless it is component-typed)
 * @param {object} master the master root it stands for
 * @param {{classes?: string, targeted?: boolean}} [state]
 * @returns {boolean}
 */
export function isBareWrapper(node, master, state) {
  if (!node || !isComponentType(node.type)) return false
  if (((state && state.classes) || '').trim()) return false
  if (!master) return true
  if (master.background) return false
  if (master.interactions && master.interactions.length) return false
  if (master.animations && master.animations.length) return false
  if (typeof master.channel === 'string' && master.channel) return false
  if (state && state.targeted) return false
  return true
}

/**
 * @typedef {object} Mapping
 * @property {object} master      the master node this page node stands for —
 *                                where its classes, interactions and structure live
 * @property {object} root        the root of that master's component
 * @property {object} def         the component itself
 * @property {string} instanceId  the id of the instance wrapper this node sits
 *                                in: what makes a binding's state unique per instance
 * @property {object[]} mirrors   nodes between this one and its master that may
 *                                also carry its state, most specific first (the
 *                                copies held by the components it is nested in)
 * @property {Record<string,string>} picks  the instance's variant option per axis
 */

/**
 * Map every node that lives in a component instance to its master, by
 * structural position (index + type): the instance block on the page mirrors
 * the master's tree, so the n-th child stands for the master's n-th child.
 *
 * COMPONENTS NEST. A master's tree may hold a node typed as another component
 * — a nested instance, whose subtree there is a MIRROR: the inner component's
 * structure, carrying only what this host says about it (its text, its picks,
 * its hidden parts). So a page node inside `Card > Button` stands for a node
 * of BUTTON's master — that is where its classes and interactions live — and
 * the Card master's mirror of it sits in between, as the first place to look
 * for anything the page node does not set itself.
 *
 * `roots` are the trees to walk — a page's elements, or (on the components
 * board) each master's own children. `components` is the project's list; a
 * name resolves to the FIRST component carrying it, as `findComponent` does.
 *
 * @returns {Map<string, Mapping>}
 */
export function buildInstanceMap(roots, components) {
  const byName = new Map()
  for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def)

  const map = new Map()

  const walk = (inst, master, mirrors, scope) => {
    if (inst.type !== master.type) return
    map.set(inst.id, {
      master,
      root: scope.def.root,
      def: scope.def,
      instanceId: scope.instanceId,
      mirrors,
      picks: scope.picks,
    })
    if (master.slot) {
      visit(inst.children)
      return
    }
    const length = Math.min(inst.children.length, master.children.length)
    for (let i = 0; i < length; i++) {
      const child = inst.children[i]
      const below = master.children[i]
      const childMirrors = mirrors
        .map((mirror) => mirror.children?.[i])
        .filter((mirror) => mirror && mirror.type === child.type)
      const inner = isComponentType(below.type) ? byName.get(below.type) : undefined
      if (inner && inner !== scope.def && child.type === below.type) {
        instance(child, inner, [...childMirrors, below])
      } else {
        walk(child, below, childMirrors, scope)
      }
    }
  }

  const instance = (wrapper, def, mirrors) => {
    walk(wrapper, def.root, mirrors, {
      def,
      instanceId: wrapper.id,
      picks: resolvePicks(def, wrapper, mirrors),
    })
  }

  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      const def = isComponentType(node.type) ? byName.get(node.type) : undefined
      if (def) instance(node, def, [])
      else visit(node.children)
    }
  }
  visit(roots)
  return map
}

export const isInstanceWrapper = (mapping) => !!mapping && mapping.master === mapping.root

export function nestedComponentNames(def) {
  const names = new Set()
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      if (isComponentType(node.type)) names.add(node.type)
      else visit(node.children)
    }
  }
  visit(def.root.children)
  return [...names]
}

export function componentReaches(components, from, to) {
  const byName = new Map()
  for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def)
  const seen = new Set()
  const visit = (name) => {
    if (name === to) return true
    if (seen.has(name)) return false
    seen.add(name)
    const def = byName.get(name)
    return !!def && nestedComponentNames(def).some(visit)
  }
  return visit(from)
}

export function canNest(components, host, inner) {
  return host !== inner && !componentReaches(components, inner, host)
}

export function dependencyOrder(components) {
  const byName = new Map()
  for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def)
  const out = []
  const state = new Map()
  const visit = (def) => {
    if (state.has(def.name)) return
    state.set(def.name, 'open')
    for (const name of nestedComponentNames(def)) {
      const inner = byName.get(name)
      if (inner) visit(inner)
    }
    state.set(def.name, 'done')
    out.push(def)
  }
  for (const def of components ?? []) visit(def)
  for (const def of components ?? []) if (!out.includes(def)) out.push(def)
  return out
}

export function resolvePicks(def, wrapper, mirrors) {
  const picks = {}
  for (const axis of def.variants ?? []) {
    let pick
    for (const source of [wrapper, ...(mirrors ?? [])]) {
      const value = source?.variants?.[axis.name]
      if (value !== undefined && axis.options.includes(value)) {
        pick = value
        break
      }
    }
    picks[axis.name] = pick ?? axis.default
  }
  return picks
}

export function resolveInstanceValue(node, mapping, key) {
  if (node[key] !== undefined) return node[key]
  if (!mapping) return undefined
  for (const mirror of mapping.mirrors) {
    if (mirror[key] !== undefined) return mirror[key]
  }
  return mapping.master[key]
}

export function inheritedInstanceValue(mapping, key) {
  if (!mapping) return undefined
  for (const mirror of mapping.mirrors) {
    if (mirror[key] !== undefined) return mirror[key]
  }
  return mapping.master[key]
}

export function isNodeHidden(node, mapping) {
  return resolveInstanceValue(node, mapping, 'hidden') === true
}

export function setNodeHidden(node, mapping, hidden) {
  const inherited = inheritedInstanceValue(mapping, 'hidden') === true
  if (hidden === inherited) delete node.hidden
  else node.hidden = hidden
}
