import { computed, ref, type ComputedRef } from 'vue'
import { useElement, type DropPosition } from './useElement'
import { useComponents } from './useComponents'
import { useReorderAnimation } from './useReorderAnimation'
import { useComponentBoard } from './useComponentBoard'
import { useProject } from './useProject'
import { isComponentType } from '@/lib/components'
import { pushMasterStructure } from '@/lib/componentOps'
import {
  acceptsChildren,
  canDropIn,
  cloneSubtree,
  duplicateIn,
  enclosingInstance,
  insertIn,
  isHostRoot,
  masterHost,
  moveIn,
  nudgeTarget,
  pageHost,
  removeFrom,
  retypeIn,
  wrapIn,
  type StructureHost,
} from '@/lib/treeOps'
import { deepClone, findNode, findParent, walkNodes } from '@/lib/tree'
import { canNest, isInstanceWrapper } from '@/lib/instances'
import type { ComponentDef, ElementNode } from '@/types/editor'

/**
 * The one way to change structure, whatever is being edited.
 *
 * Two things have structure in this app — a PAGE and a component MASTER — and
 * both are plain `ElementNode` trees, so `lib/treeOps` is the single
 * implementation of every verb. What lives here is the POLICY around it:
 *
 * - which host is live, which follows the components board SESSION being
 *   mounted rather than the view mode, so there is never a render where the
 *   two disagree;
 * - that a structural edit inside a page instance belongs to the MASTER, is
 *   applied there and pushed back out to every instance — which is what the
 *   old instance-first sync produced indirectly, by letting one instance
 *   diverge and then adopting it;
 * - that structure inside a nested instance is refused on the board, because it
 *   is edited in the inner component's own card;
 * - pushing a master's new shape to every instance after an edit.
 *
 * It also answers the capability questions (`isContainer`, `can`, `canDrop`)
 * that callers — the Layers tree, the canvas drag, the ⌘E dock, the context
 * menu, the shortcuts, the Data panel — need before they offer an action.
 */

/** what an insert puts down */
export type InsertPayload =
  /** `classes` makes a dock entry a PRESET (Container, Grid) rather than a
   *  type of its own — see lib/elementPalette */
  | { kind: 'element'; type: string; classes?: string }
  | { kind: 'component'; name: string }

export type StructureAction =
  | 'move'
  | 'remove'
  | 'duplicate'
  | 'wrap'
  | 'retype'
  | 'ref'
  | 'arg'
  | 'link'

export interface StructureBackend {
  kind: 'page' | 'master'
  /** the tree(s) the Layers panel renders */
  roots: ComputedRef<ElementNode[]>
  /** can this node hold children? */
  isContainer: (node: ElementNode) => boolean
  can: (node: ElementNode, action: StructureAction) => boolean
  canDrop: (ids: string[], targetId: string, position: DropPosition) => boolean
  insert: (payload: InsertPayload, targetId: string | null, position: DropPosition) => ElementNode | null
  move: (ids: string[], targetId: string, position: DropPosition) => void
  /** keyboard move: one visual slot up or down */
  nudge: (dir: 'up' | 'down') => boolean
  remove: (ids: string[]) => void
  duplicate: (ids: string[]) => void
  wrap: (ids: string[]) => void
  retype: (id: string, type: string) => void
  setArg: (id: string, arg: string | null) => void
  setLink: (id: string, link: string | null) => void
  /** refs are page-scope addresses; masters never carry one */
  setRef: (id: string, ref: string | null) => boolean
  copy: (ids: string[]) => void
  paste: (targetId: string) => void
}

/**
 * The app-internal element clipboard — detached subtrees carrying their
 * original ids, so a paste can re-mint them AND retarget the bindings that
 * pointed inside the copy. Module-level so it survives every unmount, and
 * shared by both hosts: copying between a page and a component's card is now
 * just a paste into the other tree.
 */
const clipboard = ref<ElementNode[] | null>(null)

export function useStructure() {
  const el = useElement()
  const { project } = useProject()
  const { components, findComponent, masterFor } = useComponents()
  const { withReorderAnimation } = useReorderAnimation()
  const { activeCard, boardActive } = useComponentBoard()

  // --- shared helpers ---

  /** the type an insert payload lands. Null when the payload can't be placed. */
  function typeFor(payload: InsertPayload): string | null {
    if (payload.kind === 'element') return payload.type
    return findComponent(payload.name) ? payload.name : null
  }

  /** run a change on a host, then push a master's new shape to its instances */
  function runOn(host: StructureHost, fn: () => boolean): boolean {
    if (!fn()) return false
    if (host.def) pushMasterStructure(project.value, host.def)
    return true
  }

  // --- the page backend ---------------------------------------------------
  //
  // A page node inside a component instance is not the page's to restructure:
  // its structure is the master's, shared by every instance. So the two
  // resolvers below translate an operation onto the master's own nodes, and
  // `runOn` pushes the result back out.

  const pageBody = computed(() => el.bodyElement.value)

  /** the component a page node's structure belongs to, or null when it is the
   *  page's own. An instance's `:Name` wrapper is the page's: it carries the
   *  page's ref, htmlId and position. */
  function ownerOf(id: string): ComponentDef | null {
    const mapping = masterFor(id)
    return mapping && !isInstanceWrapper(mapping) ? mapping.def : null
  }

  /** the host a set of page nodes belongs to, with their ids inside it */
  function nodesHost(ids: string[]): { host: StructureHost; ids: string[] } | null {
    const body = pageBody.value
    if (!body) return null
    const owners = new Set(ids.map(ownerOf))
    // a selection that straddles the boundary has no single host: half of it
    // would restructure a component and half a page
    if (owners.size > 1) return null
    const def = ids.length ? [...owners][0] : null
    if (!def) return { host: pageHost(body), ids }
    return { host: masterHost(def), ids: ids.map((id) => masterFor(id)!.master.id) }
  }

  /** the host a drop/insert slot belongs to, with the target's id inside it */
  function targetHost(
    id: string,
    position: DropPosition,
  ): { host: StructureHost; targetId: string } | null {
    const body = pageBody.value
    if (!body) return null
    const mapping = masterFor(id)
    if (!mapping) return { host: pageHost(body), targetId: id }
    if (isInstanceWrapper(mapping)) {
      // the wrapper is a page node, so before/after is a page move — but
      // dropping INSIDE it puts what lands into the component
      return position === 'inside'
        ? { host: masterHost(mapping.def), targetId: mapping.def.root.id }
        : { host: pageHost(body), targetId: id }
    }
    // a slot is the component's element holding the PAGE's content: dropping
    // inside it is a page edit, and so is anything around its children
    if (position === 'inside' && mapping.master.slot) return { host: pageHost(body), targetId: id }
    return { host: masterHost(mapping.def), targetId: mapping.master.id }
  }

  /** nodes and target must resolve to the SAME host, or the move crosses a
   *  boundary that has no meaning (a component node onto a page, or back) */
  function moveHost(ids: string[], targetId: string, position: DropPosition) {
    const from = nodesHost(ids)
    const to = targetHost(targetId, position)
    if (!from || !to || from.host.def !== to.host.def) return null
    return { host: from.host, ids: from.ids, targetId: to.targetId }
  }

  /**
   * The page node standing for a master node — the reverse of `masterFor`.
   *
   * After an edit that was redirected to a master, what the operation returns
   * is a MASTER node; the thing to select is the page node the push just
   * aligned to it.
   */
  function pageNodeFor(master: ElementNode): ElementNode | null {
    let found: ElementNode | null = null
    walkNodes(el.elements.value, (n) => {
      if (!found && masterFor(n.id)?.master === master) found = n
    })
    return found
  }

  /** select what an operation produced, whichever tree it came back from. On
   *  the board the masters ARE the selection scope, so only a page needs the
   *  master → page node lookup. */
  function selectResult(host: StructureHost, node: ElementNode | null) {
    if (!node) return
    const resolved = host.def && !boardActive.value ? pageNodeFor(node) : node
    if (resolved) el.selectElement(resolved.id)
  }

  const page: StructureBackend = {
    kind: 'page',
    roots: computed(() => el.elements.value),

    isContainer(node) {
      // an instance wrapper takes children on a PAGE — they go into the
      // component. (On the board it takes none: that is edited in its own card.)
      const mapping = masterFor(node.id)
      if (mapping && isInstanceWrapper(mapping)) return true
      return acceptsChildren(node)
    },

    can(node, action) {
      if (node.type === 'body') return false
      if (ownerOf(node.id)) {
        // inside an instance: the edit lands on the master, where the node has
        // no page to be unique on
        return action !== 'ref'
      }
      // the `:Name` wrapper is a page node, but it renders no element of its
      // own — there is no tag, binding or link on it to change
      if (isComponentType(node.type)) {
        return ['move', 'remove', 'duplicate', 'wrap', 'ref'].includes(action)
      }
      return true
    },

    canDrop(ids, targetId, position) {
      const resolved = moveHost(ids, targetId, position)
      return !!resolved && canDropIn(resolved.host, resolved.ids, resolved.targetId, position)
    },

    insert(payload, targetId, position) {
      const target = targetId ? el.getElement(targetId) : el.selectedElement.value
      if (!target) return null
      const resolved = targetHost(target.id, position)
      if (!resolved) return null
      // a component may land inside an instance of another — that is nesting —
      // but never where it would end up holding itself, at any distance
      if (payload.kind === 'component') {
        const holder = resolved.host.def?.name
        if (holder && !canNest(components.value, holder, payload.name)) return null
      }
      const type = typeFor(payload)
      if (!type) return null
      let made: ElementNode | null = null
      runOn(resolved.host, () => {
        made = insertIn(
          resolved.host,
          type,
          resolved.targetId,
          position,
          components.value,
          payload.kind === 'element' ? payload.classes : undefined,
        )
        return !!made
      })
      selectResult(resolved.host, made)
      return made
    },

    move(ids, targetId, position) {
      const resolved = moveHost(ids, targetId, position)
      if (!resolved) return
      const run = () =>
        runOn(resolved.host, () =>
          moveIn(resolved.host, resolved.ids, resolved.targetId, position),
        )
      // one element animates on the canvas; a group has no single ghost
      if (ids.length === 1) withReorderAnimation(ids[0]!, run)
      else run()
    },

    nudge(dir) {
      const resolved = nodesHost(el.selectedElementIds.value)
      if (!resolved?.ids.length) return false
      const to = nudgeTarget(resolved.host, resolved.ids, dir)
      if (!to) return false
      // the selection needs no restoring: a tree move keeps every node object,
      // so anchor and focus still resolve to the same siblings
      return runOn(resolved.host, () =>
        moveIn(resolved.host, resolved.ids, to.targetId, to.position),
      )
    },

    remove(ids) {
      const resolved = nodesHost(ids)
      if (!resolved) return
      let next: ElementNode | null = null
      runOn(resolved.host, () => {
        next = removeFrom(resolved.host, resolved.ids)
        return !!next
      })
      selectResult(resolved.host, next)
    },

    duplicate(ids) {
      const resolved = nodesHost(ids)
      if (!resolved) return
      runOn(resolved.host, () => duplicateIn(resolved.host, resolved.ids).length > 0)
    },

    wrap(ids) {
      const resolved = nodesHost(ids)
      if (!resolved) return
      let made: ElementNode | null = null
      runOn(resolved.host, () => {
        made = wrapIn(resolved.host, resolved.ids)
        return !!made
      })
      selectResult(resolved.host, made)
    },

    retype(id, type) {
      const resolved = nodesHost([id])
      if (resolved) runOn(resolved.host, () => retypeIn(resolved.host, resolved.ids[0]!, type))
    },

    setArg(id, arg) {
      const resolved = nodesHost([id])
      if (resolved) runOn(resolved.host, () => setNodeArg(resolved.host, resolved.ids[0]!, arg))
    },

    // A link is PER-INSTANCE with a component default (see adoptCodeOwned):
    // one Button component serves a dozen destinations, so a link set on an
    // instance's element stays on the page node instead of being redirected to
    // the master, where it would re-point every instance on the site. Empty
    // falls back to the master's. Everything else here — classes,
    // interactions, arg — is still the master's.
    setLink(id, link) {
      const body = pageBody.value
      const mapping = masterFor(id)
      if (body && mapping && !isInstanceWrapper(mapping)) {
        setNodeLink(pageHost(body), id, link)
        return
      }
      const resolved = nodesHost([id])
      if (resolved) runOn(resolved.host, () => setNodeLink(resolved.host, resolved.ids[0]!, link))
    },

    setRef: (id, ref) => el.setElementRef(id, ref),

    copy(ids) {
      copyInto(el.elements.value, ids)
    },

    paste(targetId) {
      const resolved = targetHost(targetId, 'after')
      if (resolved) pasteInto(resolved.host, resolved.targetId)
    },
  }

  // --- the master backend: the component on the board --------------------

  const activeDef = computed<ComponentDef | null>(() => activeCard.value?.def ?? null)
  const host = () => (activeDef.value ? masterHost(activeDef.value) : null)

  const master: StructureBackend = {
    kind: 'master',
    roots: computed(() => (activeDef.value ? [activeDef.value.root] : [])),
    isContainer: acceptsChildren,

    can(node, action) {
      const h = host()
      if (!h) return false
      // the wrapper IS the component: it is renamed, never restructured, and
      // it carries no ref (a master's nodes never reach a page's ref space)
      if (isHostRoot(h, node)) return false
      if (action === 'ref') return false
      // inside a nested instance the structure is another component's: it is
      // edited there, in its own card
      if (enclosingInstance(h, node.id)) return false
      // the nested instance itself moves, duplicates and goes like any node,
      // but it has no tag, binding or link of its own to change
      if (isComponentType(node.type)) return ['move', 'remove', 'duplicate', 'wrap'].includes(action)
      return true
    },

    canDrop(ids, targetId, position) {
      const h = host()
      return !!h && canDropIn(h, ids, targetId, position)
    },

    insert(payload, targetId, position) {
      const h = host()
      if (!h || !h.def) return null
      const target = targetId ?? el.selectedElement.value?.id ?? null
      if (payload.kind === 'component' && !canNest(nestable(h.def), h.def.name, payload.name)) {
        return null
      }
      const type = typeFor(payload)
      if (!type) return null
      let made: ElementNode | null = null
      runOn(h, () => {
        made = insertIn(
          h,
          type,
          target,
          position,
          nestable(h.def!),
          payload.kind === 'element' ? payload.classes : undefined,
        )
        return !!made
      })
      if (made) el.selectElement((made as ElementNode).id)
      return made
    },

    move(ids, targetId, position) {
      const h = host()
      if (h) runOn(h, () => moveIn(h, ids, targetId, position))
    },

    nudge(dir) {
      const h = host()
      const ids = el.selectedElementIds.value
      if (!h || !ids.length) return false
      const to = nudgeTarget(h, ids, dir)
      if (!to) return false
      return runOn(h, () => moveIn(h, ids, to.targetId, to.position))
    },

    remove(ids) {
      const h = host()
      if (!h) return
      let next: ElementNode | null = null
      runOn(h, () => {
        next = removeFrom(h, ids)
        return !!next
      })
      if (next) el.selectElement((next as ElementNode).id)
    },

    duplicate(ids) {
      const h = host()
      if (h) runOn(h, () => duplicateIn(h, ids).length > 0)
    },

    wrap(ids) {
      const h = host()
      if (!h) return
      let made: ElementNode | null = null
      runOn(h, () => {
        made = wrapIn(h, ids)
        return !!made
      })
      if (made) el.selectElement((made as ElementNode).id)
    },

    retype(id, type) {
      const h = host()
      if (h) runOn(h, () => retypeIn(h, id, type))
    },

    setArg(id, arg) {
      const h = host()
      if (h) runOn(h, () => setNodeArg(h, id, arg))
    },

    setLink(id, link) {
      const h = host()
      if (h) runOn(h, () => setNodeLink(h, id, link))
    },

    // a master node has no page to be unique on, and a master's structure is
    // copied into every instance, so a ref there would be duplicated site-wide
    setRef: () => false,

    copy(ids) {
      const def = activeDef.value
      if (def) copyInto([def.root], ids)
    },

    paste(targetId) {
      const h = host()
      if (h) pasteInto(h, targetId)
    },
  }

  /** what a component name resolves to while editing `def` — the project's
   *  components, and `def` itself when it is not in the project yet */
  const nestable = (def: ComponentDef) =>
    components.value.includes(def) ? components.value : [...components.value, def]

  // --- arg / link: two slots the DSL line used to own -------------------

  function setNodeArg(h: StructureHost, id: string, arg: string | null): boolean {
    const node = findNode([h.root], id)
    if (!node) return false
    if (arg) node.arg = arg
    else delete node.arg
    return true
  }

  function setNodeLink(h: StructureHost, id: string, link: string | null): boolean {
    const node = findNode([h.root], id)
    if (!node) return false
    if (link) node.link = link
    else delete node.link
    return true
  }

  // --- the clipboard -----------------------------------------------------

  /**
   * Snapshots subtrees for copy. A deep clone and nothing else: every piece of
   * node state comes with it, so there is no list of keys to keep in step with
   * the `ElementNode` type — the old dedented-code-plus-captured-props pair had
   * two, and each one that drifted silently lost a setting. Ids are kept as
   * they are; `paste` re-mints them, which is also what lets it retarget the
   * bindings that pointed inside the copy.
   */
  function copyInto(roots: ElementNode[], ids: string[]) {
    const nodes = ids
      .map((id) => findNode(roots, id))
      .filter((n): n is ElementNode => !!n && n.type !== 'body')
    if (nodes.length) clipboard.value = nodes.map((n) => deepClone(n) as ElementNode)
  }

  /**
   * Pastes the clipboard inside a container target, else after it. Fresh ids
   * every time, so pasting twice yields two independent copies.
   */
  function pasteInto(h: StructureHost, targetId: string) {
    const held = clipboard.value
    if (!held?.length) return
    const target = findNode([h.root], targetId)
    if (!target) return
    const into = isHostRoot(h, target) || acceptsChildren(target)
    const parent = into ? target : findParent([h.root], targetId)
    if (!parent) return
    let at = into ? parent.children.length : parent.children.indexOf(target) + 1
    let last: ElementNode | null = null
    runOn(h, () => {
      for (const node of held) {
        const { cloned } = cloneSubtree(node)
        parent.children.splice(at++, 0, cloned)
        last = cloned
      }
      return true
    })
    selectResult(h, last)
  }

  /** the backend for whatever is being edited right now */
  const backend = computed<StructureBackend>(() => (boardActive.value ? master : page))

  return { backend, clipboard }
}
