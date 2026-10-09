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
  createBlankComponent as createBlankComponentInProject,
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

export type MasterMapping = InstanceMapping

const { project } = useProject()
const { activePage } = usePage()
const { selectedElement } = useElement()

const components = computed(() => project.value.components)

const { cards, boardActive } = useComponentBoard()

const resolvable = computed(() => components.value)

function findComponent(name: string): ComponentDef | null {
  return resolvable.value.find((c) => c.name === name) ?? null
}

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

const editTarget = computed(() => {
  const selected = selectedElement.value
  if (!selected) return null
  return masterFor(selected.id)?.master ?? selected
})

function isHidden(node: ElementNode): boolean {
  return node.type !== 'body' && isNodeHidden(node, masterFor(node.id))
}

function setHidden(node: ElementNode, hidden: boolean): void {
  if (node.type === 'body' || !useAuth().canBuild.value) return
  setNodeHidden(node, masterFor(node.id), hidden)
}

export function useComponents() {
  const { selectElement } = useElement()

  function findMasterNode(id: string): ElementNode | null {
    for (const def of components.value) {
      const match = findNode([def.root], id)
      if (match) return match
    }
    return null
  }

  function createComponent(rawName: string, sourceId: string): ComponentDef | null {
    const page = activePage.value
    const source = findNode(page.elements, sourceId)
    if (!source || source.type === 'body') return null
    if (isComponentType(source.type) || masterFor(source.id)) return null
    const parent = findParent(page.elements, sourceId)
    if (!parent) return null

    const name = normalizeComponentName(rawName, components.value.map((c) => c.name))
    const { cloned } = cloneForMaster(source)
    stripExtractedInstanceState(source)
    const root: ElementNode = { id: uid(), type: name, content: '', children: [cloned] }
    const def: ComponentDef = { id: uid(), name, root }

    const wrapper: ElementNode = { id: uid(), type: name, content: '', children: [source] }
    if (source.ref) wrapper.ref = source.ref
    walkNodes([source], (n) => delete n.ref)
    parent.children.splice(parent.children.indexOf(source), 1, wrapper)

    project.value.components.push(def)
    pushMasterStructure(project.value, def)
    selectElement(wrapper.id)
    return def
  }

  function createBlankComponent(rawName: string, category?: string): ComponentDef {
    return createBlankComponentInProject(project.value, rawName, category)
  }

  function detachComponent(instanceId: string) {
    if (detachInstance(project.value, activePage.value, instanceId)) selectElement(instanceId)
  }

  function renameComponent(id: string, rawName: string): string | null {
    return renameComponentInProject(project.value, id, rawName)
  }

  function duplicateComponent(id: string): ComponentDef | null {
    return duplicateComponentInProject(project.value, id)
  }

  function setCategory(id: string, category: string) {
    setComponentCategory(project.value, id, category)
  }

  function usageOf(name: string) {
    return componentUsage(project.value, name)
  }

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
    createBlankComponent,
    detachComponent,
    renameComponent,
    duplicateComponent,
    setCategory,
    usageOf,
    deleteComponent,
  }
}
