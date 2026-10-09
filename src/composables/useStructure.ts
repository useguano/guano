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

export type InsertPayload =

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
  roots: ComputedRef<ElementNode[]>
  isContainer: (node: ElementNode) => boolean
  can: (node: ElementNode, action: StructureAction) => boolean
  canDrop: (ids: string[], targetId: string, position: DropPosition) => boolean
  insert: (payload: InsertPayload, targetId: string | null, position: DropPosition) => ElementNode | null
  move: (ids: string[], targetId: string, position: DropPosition) => void
  nudge: (dir: 'up' | 'down') => boolean
  remove: (ids: string[]) => void
  duplicate: (ids: string[]) => void
  wrap: (ids: string[]) => void
  retype: (id: string, type: string) => void
  setArg: (id: string, arg: string | null) => void
  setLink: (id: string, link: string | null) => void
  setRef: (id: string, ref: string | null) => boolean
  copy: (ids: string[]) => void
  paste: (targetId: string) => void
}

const clipboard = ref<ElementNode[] | null>(null)

export function useStructure() {
  const el = useElement()
  const { project } = useProject()
  const { components, findComponent, masterFor } = useComponents()
  const { withReorderAnimation } = useReorderAnimation()
  const { activeCard, boardActive } = useComponentBoard()

  function typeFor(payload: InsertPayload): string | null {
    if (payload.kind === 'element') return payload.type
    return findComponent(payload.name) ? payload.name : null
  }

  function runOn(host: StructureHost, fn: () => boolean): boolean {
    if (!fn()) return false
    if (host.def) pushMasterStructure(project.value, host.def)
    return true
  }

  const pageBody = computed(() => el.bodyElement.value)

  function ownerOf(id: string): ComponentDef | null {
    const mapping = masterFor(id)
    return mapping && !isInstanceWrapper(mapping) ? mapping.def : null
  }

  function nodesHost(ids: string[]): { host: StructureHost; ids: string[] } | null {
    const body = pageBody.value
    if (!body) return null
    const owners = new Set(ids.map(ownerOf))
    if (owners.size > 1) return null
    const def = ids.length ? [...owners][0] : null
    if (!def) return { host: pageHost(body), ids }
    return { host: masterHost(def), ids: ids.map((id) => masterFor(id)!.master.id) }
  }

  function targetHost(
    id: string,
    position: DropPosition,
  ): { host: StructureHost; targetId: string } | null {
    const body = pageBody.value
    if (!body) return null
    const mapping = masterFor(id)
    if (!mapping) return { host: pageHost(body), targetId: id }
    if (isInstanceWrapper(mapping)) {
      return position === 'inside'
        ? { host: masterHost(mapping.def), targetId: mapping.def.root.id }
        : { host: pageHost(body), targetId: id }
    }
    if (position === 'inside' && mapping.master.slot) return { host: pageHost(body), targetId: id }
    return { host: masterHost(mapping.def), targetId: mapping.master.id }
  }

  function moveHost(ids: string[], targetId: string, position: DropPosition) {
    const from = nodesHost(ids)
    const to = targetHost(targetId, position)
    if (!from || !to || from.host.def !== to.host.def) return null
    return { host: from.host, ids: from.ids, targetId: to.targetId }
  }

  function pageNodeFor(master: ElementNode): ElementNode | null {
    let found: ElementNode | null = null
    walkNodes(el.elements.value, (n) => {
      if (!found && masterFor(n.id)?.master === master) found = n
    })
    return found
  }

  function selectResult(host: StructureHost, node: ElementNode | null) {
    if (!node) return
    const resolved = host.def && !boardActive.value ? pageNodeFor(node) : node
    if (resolved) el.selectElement(resolved.id)
  }

  const page: StructureBackend = {
    kind: 'page',
    roots: computed(() => el.elements.value),

    isContainer(node) {
      const mapping = masterFor(node.id)
      if (mapping && isInstanceWrapper(mapping)) return true
      return acceptsChildren(node)
    },

    can(node, action) {
      if (node.type === 'body') return false
      if (ownerOf(node.id)) {
        return action !== 'ref'
      }
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
      if (ids.length === 1) withReorderAnimation(ids[0]!, run)
      else run()
    },

    nudge(dir) {
      const resolved = nodesHost(el.selectedElementIds.value)
      if (!resolved?.ids.length) return false
      const to = nudgeTarget(resolved.host, resolved.ids, dir)
      if (!to) return false
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

  const activeDef = computed<ComponentDef | null>(() => activeCard.value?.def ?? null)
  const host = () => (activeDef.value ? masterHost(activeDef.value) : null)

  const master: StructureBackend = {
    kind: 'master',
    roots: computed(() => (activeDef.value ? [activeDef.value.root] : [])),
    isContainer: acceptsChildren,

    can(node, action) {
      const h = host()
      if (!h) return false
      if (isHostRoot(h, node)) return false
      if (action === 'ref') return false
      if (enclosingInstance(h, node.id)) return false
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

  const nestable = (def: ComponentDef) =>
    components.value.includes(def) ? components.value : [...components.value, def]

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

  function copyInto(roots: ElementNode[], ids: string[]) {
    const nodes = ids
      .map((id) => findNode(roots, id))
      .filter((n): n is ElementNode => !!n && n.type !== 'body')
    if (nodes.length) clipboard.value = nodes.map((n) => deepClone(n) as ElementNode)
  }

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

  const backend = computed<StructureBackend>(() => (boardActive.value ? master : page))

  return { backend, clipboard }
}
