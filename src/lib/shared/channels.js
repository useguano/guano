// The project-wide channel index, shared VERBATIM by the editor
// (useInteraction / useAnimation), the static exporter (server/export.mjs),
// `validateTree` and the MCP tools.
//
// A channel is the one target that is NOT a node id (see `isChannelTarget` in
// interactionKeys.js). Everything else about a binding stays the same; what
// changes is WHERE the two halves can live:
//
//   plain target   — trigger and target are in one tree, and the key carries
//                    the component instance and the entry scope that isolate
//                    one rendering of the pair from its siblings.
//   channel target — trigger and listener are in different trees, possibly on
//                    different routes, possibly one in a master and one on a
//                    page. The key carries NO scope at all.
//
// `buildPlainTargets` in the exporter walks a route's page trees only, which is
// precisely why a master's binding could never reach a page element before. The
// index here walks every page AND every component master, so a listener can be
// found from either side.

import { channelName, isChannelName } from './interactionKeys.js'

/** depth-first over a node list — a local walk so this module stays importable
 *  from the exporter, the browser bundle and the MCP runtime alike */
function walk(nodes, visit) {
  for (const node of nodes ?? []) {
    visit(node)
    walk(node.children, visit)
  }
}

/**
 * Every binding in the project that targets a channel, grouped by channel name.
 *
 * @param {{pages?: any[], components?: any[]}} project
 * @returns {Map<string, {interactions: {binding: any, ownerId: string, inMaster: boolean}[],
 *                        animations:  {binding: any, ownerId: string, inMaster: boolean}[]}>}
 */
export function buildChannelIndex(project) {
  const index = new Map()
  const at = (name) => {
    let entry = index.get(name)
    if (!entry) index.set(name, (entry = { interactions: [], animations: [] }))
    return entry
  }
  const collect = (owner, inMaster) => {
    for (const binding of owner.interactions ?? []) {
      const name = channelName(binding.targetId)
      if (name) at(name).interactions.push({ binding, ownerId: owner.id, inMaster })
    }
    for (const binding of owner.animations ?? []) {
      const name = channelName(binding.targetId)
      if (name) at(name).animations.push({ binding, ownerId: owner.id, inMaster })
    }
  }
  for (const page of project.pages ?? []) walk(page.elements, (n) => collect(n, false))
  for (const component of project.components ?? []) walk([component.root], (n) => collect(n, true))
  return index
}

/**
 * Every element that DECLARES a channel, grouped by name. A listener may live
 * on a page (the modal placed once per page) or on a component master (the
 * modal IS a component, which is the case worth having) — see
 * `channel-declared-twice` for the one thing that goes wrong.
 *
 * @param {{pages?: any[], components?: any[]}} project
 * @returns {Map<string, {nodeId: string, pageId?: string, pageName?: string,
 *                        componentId?: string, componentName?: string}[]>}
 */
export function channelListeners(project) {
  const index = new Map()
  const add = (node, where) => {
    if (!isChannelName(node.channel)) return
    const list = index.get(node.channel) ?? []
    list.push({ nodeId: node.id, ...where })
    index.set(node.channel, list)
  }
  for (const page of project.pages ?? []) {
    walk(page.elements, (n) => add(n, { pageId: page.id, pageName: page.name }))
  }
  for (const component of project.components ?? []) {
    walk([component.root], (n) =>
      add(n, { componentId: component.id, componentName: component.name }),
    )
  }
  return index
}

/**
 * How many times each channel is DECLARED on one route — a component master's
 * declaration counts once per instance the route holds, which is exactly the
 * mistake `channel-declared-twice` names. Two listeners on one channel both
 * open, so the page shows the overlay twice.
 *
 * @param {any[][]} trees the node lists the route renders (the page's, plus
 *   any template bodies a `collection-item` embeds)
 * @param {Map<string, {master: any}>} instanceMap the route's instance map —
 *   a mapped node listens on what its MASTER declares, since a channel is
 *   shared state like classes
 * @returns {Map<string, number>}
 */
export function routeChannelCounts(trees, instanceMap) {
  const counts = new Map()
  for (const tree of trees) {
    walk(tree, (node) => {
      const rendered = instanceMap?.get(node.id)?.master ?? node
      if (!isChannelName(rendered.channel)) return
      counts.set(rendered.channel, (counts.get(rendered.channel) ?? 0) + 1)
    })
  }
  return counts
}
