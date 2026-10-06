import { computed } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useElement } from './useElement'
import {
  normalizeComponentName,
  isComponentType,
  cloneForMaster,
  stripExtractedInstanceState,
} from '@/lib/components'
import {
  componentUsage,
  pushMasterStructure,
  deleteComponent as deleteComponentFromProject,
  detachInstance,
  duplicateComponent as duplicateComponentInProject,
  renameComponent as renameComponentInProject,
  setComponentCategory,
} from '@/lib/componentOps'
import { findNode, findParent, walkNodes } from '@/lib/tree'
import { buildInstanceMap, isNodeHidden, setNodeHidden, type InstanceMapping } from '@/lib/instances'
import { useAuth } from './useAuth'
import { useComponentBoard } from './useComponentBoard'
import type { ComponentDef, ElementNode } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

/** what a page node inside a component instance stands for — see lib/instances */
export type MasterMapping = InstanceMapping

// project / active page / components / masterMap live at MODULE scope so
// every renderer node shares ONE masterMap computed instead of building
// its own tree-walking copy (that was O(n²) per page). useProject()/
// usePage() only wire computeds over singleton refs — safe to call here.
const { project } = useProject()
const { activePage } = usePage()
const { selectedElement } = useElement()

const components = computed(() => project.value.components)

const { cards, boardActive } = useComponentBoard()

/** what a name can resolve to right now */
const resolvable = computed(() => components.value)

function findComponent(name: string): ComponentDef | null {
  return resolvable.value.find((c) => c.name === name) ?? null
}

/**
 * Maps page nodes living inside component instance blocks to their
 * master nodes, by structural position (index + type). Mapped nodes
 * render/edit the shared master's style and interactions while
 * keeping their own content.
 */
// On the board the trees on screen are the masters themselves, so what needs
// mapping there is what they HOLD: the instances nested in them.
const masterMap = computed(() =>
  boardActive.value
    ? buildInstanceMap(
        cards.value.flatMap((card) => card.def.root.children),
        resolvable.value,
      )
    : buildInstanceMap(activePage.value.elements, components.value),
)

function masterFor(nodeId: string): MasterMapping | null {
  return masterMap.value.get(nodeId) ?? null
}

/**
 * The node a panel should WRITE to for the current selection.
 *
 * Style, interactions and animations are shared across a component's
 * instances, so editing them inside an instance must land on the master —
 * otherwise the structural sync watcher overwrites the edit on the next
 * structural change, silently. Content stays per-instance and does NOT go
 * through this.
 */
const editTarget = computed(() => {
  const selected = selectedElement.value
  if (!selected) return null
  return masterFor(selected.id)?.master ?? selected
})

/** is this node hidden, by its own flag or its component's? */
function isHidden(node: ElementNode): boolean {
  return node.type !== 'body' && isNodeHidden(node, masterFor(node.id))
}

/**
 * Show or hide a node. Inside a component instance this is the INSTANCE's own
 * choice; on the components board it is the component's default for all of
 * them. Not a structural edit — the code does not change — but still not
 * something a contributor may do: the server keeps it out of their allowlist.
 */
function setHidden(node: ElementNode, hidden: boolean): void {
  if (node.type === 'body' || !useAuth().canBuild.value) return
  setNodeHidden(node, masterFor(node.id), hidden)
}

export function useComponents() {
  const { selectElement } = useElement()

  /** find a master node by id across every component (for target labels) */
  function findMasterNode(id: string): ElementNode | null {
    for (const def of components.value) {
      const match = findNode([def.root], id)
      if (match) return match
    }
    return null
  }

  /**
   * Turns an element into a shared component.
   *
   * Its subtree is CLONED as the master; the page keeps the original nodes, now
   * wrapped in a `:Name` instance — so every id survives, which matters because
   * comment anchors and interaction targetIds address page nodes by id.
   */
  function createComponent(rawName: string, sourceId: string): ComponentDef | null {
    const page = activePage.value
    const source = findNode(page.elements, sourceId)
    if (!source || source.type === 'body') return null
    if (isComponentType(source.type) || masterFor(source.id)) return null
    const parent = findParent(page.elements, sourceId)
    if (!parent) return null

    const name = normalizeComponentName(rawName, components.value.map((c) => c.name))
    // master ids are their own id space; internal binding targetIds are
    // remapped onto them so a modal/accordion keeps working as a component
    const { cloned } = cloneForMaster(source)
    // the master now owns presentation AND content — clear the source nodes so
    // the instance inherits instead of shadowing (a shadow re-translates shared
    // chrome per page and can re-seat onto the wrong node on restructure)
    stripExtractedInstanceState(source)
    // the root is a component-typed container: it maps to the `:Name` wrapper
    // itself, so the wrapper can carry shared styles too
    const root: ElementNode = { id: uid(), type: name, content: '', children: [cloned] }
    const def: ComponentDef = { id: uid(), name, root }

    // the wrapper takes the extracted block's place, and its ref with it: the
    // instance root is a real page node, so it keeps that address. Refs further
    // in are dropped — they are inside a component now, where a ref would be
    // duplicated across every instance on every page.
    const wrapper: ElementNode = { id: uid(), type: name, content: '', children: [source] }
    if (source.ref) wrapper.ref = source.ref
    walkNodes([source], (n) => delete n.ref)
    parent.children.splice(parent.children.indexOf(source), 1, wrapper)

    project.value.components.push(def)
    // a nested instance inside the extracted block came across as plain nodes;
    // what the master holds has to be a MIRROR of its component, and the page
    // copy has to match that mirror — both are the push's job
    pushMasterStructure(project.value, def)
    selectElement(wrapper.id)
    return def
  }

  /**
   * Unlinks a component instance: the shared master's style, interactions and
   * content are baked onto the inner page nodes and the `:Name … Name:`
   * wrapper is dissolved. The block is now independent — editing it no longer
   * touches other instances.
   */
  function detachComponent(instanceId: string) {
    if (detachInstance(project.value, activePage.value, instanceId)) selectElement(instanceId)
  }


  /** Renames a component and every instance token in the project. */
  function renameComponent(id: string, rawName: string): string | null {
    return renameComponentInProject(project.value, id, rawName)
  }

  /** Copies a component under a new name; the copy has no instances yet. */
  function duplicateComponent(id: string): ComponentDef | null {
    return duplicateComponentInProject(project.value, id)
  }

  function setCategory(id: string, category: string) {
    setComponentCategory(project.value, id, category)
  }

  /** Where a component is used — the numbers the delete confirm quotes. */
  function usageOf(name: string) {
    return componentUsage(project.value, name)
  }

  /**
   * Deletes a component. Every instance is detached first, so pages keep the
   * elements and their look — nothing vanishes from the site.
   */
  function deleteComponent(id: string): boolean {
    return deleteComponentFromProject(project.value, id)
  }

  return {
    components,
    findComponent,
    masterFor,
    editTarget,
    isHidden,
    setHidden,
    findMasterNode,
    createComponent,
    detachComponent,
    renameComponent,
    duplicateComponent,
    setCategory,
    usageOf,
    deleteComponent,
  }
}
