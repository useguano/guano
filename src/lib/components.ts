import type { ComponentDef, ElementNode } from '@/types/editor'
import { walkNodes } from './tree'
import { buildInstanceMap, resolveInstanceValue } from './instances'
import { uid } from './shared/ids.js'

export type LinkChain = Map<string, string | undefined>

export function effectiveLinkChain(components: ComponentDef[]): LinkChain {
  const chain: LinkChain = new Map()
  for (const def of components) {
    const mm = buildInstanceMap([def.root], components)
    walkNodes([def.root], (n) => {
      chain.set(n.id, resolveInstanceValue(n, mm.get(n.id), 'link'))
    })
  }
  return chain
}

export function cloneForMaster(source: ElementNode): {
  cloned: ElementNode
  idMap: Map<string, string>
} {
  const cloned = JSON.parse(JSON.stringify(source)) as ElementNode
  const idMap = new Map<string, string>()
  walkNodes([cloned], (n) => {
    const next = uid()
    idMap.set(n.id, next)
    n.id = next
    delete n.ref
  })
  walkNodes([cloned], (n) => {
    for (const b of n.interactions ?? []) {
      if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId)!
    }
    for (const b of n.animations ?? []) {
      if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId)!
    }
  })
  return { cloned, idMap }
}

export function stripExtractedInstanceState(source: ElementNode): void {
  const strip = (n: ElementNode) => {
    if (!n.slot) n.children.forEach(strip)
    delete n.classes
    delete n.interactions
    delete n.animations
    delete n.attributes
    delete n.src
    delete n.svg
    delete n.hidden
    delete n.channel
    delete n.background
    delete n.locales
    delete n.content
  }
  strip(source)
}

export function isComponentType(type: string): boolean {
  return /^[A-Z]/.test(type)
}

export function createMirror(master: ElementNode): ElementNode {
  const node: ElementNode = {
    id: uid(),
    type: master.type,
    content: '',
    children: master.slot ? cloneSlotContent(master.children) : master.children.map(createMirror),
  }
  if (master.arg) node.arg = master.arg
  if (master.slot) node.slot = true
  return node
}

function cloneSlotContent(nodes: ElementNode[]): ElementNode[] {
  const cloned = JSON.parse(JSON.stringify(nodes)) as ElementNode[]
  const idMap = new Map<string, string>()
  walkNodes(cloned, (n) => {
    const next = uid()
    idMap.set(n.id, next)
    n.id = next
    delete n.ref
  })
  walkNodes(cloned, (n) => {
    for (const b of [...(n.interactions ?? []), ...(n.animations ?? [])]) {
      if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId)!
    }
  })
  return cloned
}

function adoptCodeOwned(
  node: ElementNode,
  master: ElementNode,
  box: { moved: boolean },
  chain?: LinkChain,
): void {
  if ((node.arg ?? undefined) !== (master.arg ?? undefined)) {
    if (master.arg) node.arg = master.arg
    else delete node.arg
    box.moved = true
  }
  const inherited = chain?.has(master.id) ? chain.get(master.id) : master.link
  if (node.link !== undefined && node.link === inherited) {
    delete node.link
    box.moved = true
  }
  if (!!node.slot !== !!master.slot) {
    if (master.slot) node.slot = true
    else delete node.slot
    box.moved = true
  }
}

const INSTANCE_STATE_KEYS = [
  'content',
  'src',
  'svg',
  'background',
  'locales',
  'hidden',
  'variants',
  'link',
  'listQuery',
  'slider',
  'entryId',
  'fieldAttrs',
  'instanceAttributes',
  'htmlId',
  'ref',
] as const

export interface DiscardedState {
  type: string
  keys: string[]
}

function stateOn(node: ElementNode): string[] {
  const keys: string[] = []
  for (const key of INSTANCE_STATE_KEYS) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (value === undefined || value === null || value === '' || value === false) continue
    if (typeof value === 'object' && !Object.keys(value as object).length) continue
    keys.push(
      key === 'locales' ? `locales(${Object.keys(value as object).join(', ')})` : key,
    )
  }
  return keys
}

function collectDiscarded(node: ElementNode, into: DiscardedState[]): void {
  const keys = stateOn(node)
  if (keys.length) into.push({ type: node.type, keys })
  for (const child of node.children ?? []) collectDiscarded(child, into)
}

function alignLevel(
  node: ElementNode,
  master: ElementNode,
  box: { moved: boolean; lost?: DiscardedState[] },
  chain?: LinkChain,
): void {
  if (master.slot) return
  const old = node.children
  const matches = lcsAlign(old.map(nodeSignature), master.children.map(nodeSignature))
  const used = new Set(matches.values())
  const freeOld = old.map((_, i) => i).filter((i) => !used.has(i))
  const freeNew = master.children.map((_, i) => i).filter((i) => !matches.has(i))
  if (freeOld.length && freeNew.length) {
    const weak = lcsAlign(
      freeOld.map((i) => old[i]!.type),
      freeNew.map((i) => master.children[i]!.type),
    )
    for (const [nj, oj] of weak) matches.set(freeNew[nj]!, freeOld[oj]!)
  }

  const next = master.children.map((child, i) => {
    const at = matches.get(i)
    const kept = at !== undefined ? old[at]! : createMirror(child)
    if (at === undefined) box.moved = true
    adoptCodeOwned(kept, child, box, chain)
    alignLevel(kept, child, box, chain)
    return kept
  })
  if (box.lost) {
    const reused = new Set(matches.values())
    for (let i = 0; i < old.length; i++) {
      if (!reused.has(i)) collectDiscarded(old[i]!, box.lost)
    }
  }
  if (next.length !== old.length || next.some((child, i) => child !== old[i])) {
    node.children = next
    box.moved = true
  }
}

export function alignStructure(
  instance: ElementNode,
  master: ElementNode,
  chain?: LinkChain,
  lost?: DiscardedState[],
): boolean {
  const box = { moved: false, lost }
  alignLevel(instance, master, box, chain)
  return box.moved
}

export function alignMirror(
  mirror: ElementNode,
  master: ElementNode,
  chain?: LinkChain,
): boolean {
  const box = { moved: false }
  adoptCodeOwned(mirror, master, box, chain)
  alignLevel(mirror, master, box, chain)
  return box.moved
}

export function alignHostMirrors(
  host: ComponentDef,
  components: ComponentDef[],
  chain?: LinkChain,
): boolean {
  let moved = false
  const visit = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      if (!isComponentType(node.type)) {
        visit(node.children)
        continue
      }
      const inner = components.find((c) => c.name === node.type)
      if (inner && inner !== host && alignMirror(node, inner.root, chain)) moved = true
    }
  }
  visit(host.root.children)
  return moved
}

export function nestedWrappers(def: ComponentDef, name?: string): ElementNode[] {
  const out: ElementNode[] = []
  const visit = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      if (!isComponentType(node.type)) visit(node.children)
      else if (!name || node.type === name) out.push(node)
    }
  }
  visit(def.root.children)
  return out
}

export function normalizeComponentName(raw: string, taken: string[]): string {
  const cleaned = raw
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  const base = /^[A-Za-z]/.test(cleaned) ? cleaned : `C${cleaned}`
  const name = base.charAt(0).toUpperCase() + base.slice(1) || 'Component'
  if (!taken.includes(name)) return name
  let n = 2
  while (taken.includes(`${name}${n}`)) n++
  return `${name}${n}`
}

function nodeSignature(node: ElementNode): string {
  return `${node.type}|${node.arg ?? ''}|${node.link ?? ''}`
}

function lcsAlign(a: string[], b: string[]): Map<number, number> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const map = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      map.set(j, i)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return map
}

export interface OrphanedNode {
  id: string
  type: string
  hadClasses: boolean
  hadInteractions: number
}

export interface AdoptResult {
  adopted: number
  created: number
  orphaned: OrphanedNode[]
}

export function adoptStructure(
  master: ElementNode,
  edited: ElementNode,
  selfName: string,
  result: AdoptResult = { adopted: 0, created: 0, orphaned: [] },
): AdoptResult {
  const masterChildren = master.children
  const editedChildren = edited.children.filter((child) => child.type !== selfName)
  const mSigs = masterChildren.map(nodeSignature)
  const eSigs = editedChildren.map(nodeSignature)
  const matches = lcsAlign(mSigs, eSigs)
  const weakSignature = (n: ElementNode) => `${n.type}|${n.arg ?? ''}`
  const freeMaster = masterChildren.map((_, i) => i).filter((i) => ![...matches.values()].includes(i))
  const freeEdited = editedChildren.map((_, i) => i).filter((i) => !matches.has(i))
  if (freeMaster.length && freeEdited.length) {
    const weak = lcsAlign(
      freeMaster.map((i) => weakSignature(masterChildren[i]!)),
      freeEdited.map((i) => weakSignature(editedChildren[i]!)),
    )
    for (const [ej, mj] of weak) matches.set(freeEdited[ej]!, freeMaster[mj]!)
  }
  const usedMaster = new Set(matches.values())

  master.children = editedChildren.map((child, ei) => {
    const mi = matches.get(ei)
    let node: ElementNode
    if (mi !== undefined) {
      node = masterChildren[mi]!
      result.adopted++
    } else {
      node = {
        id: uid(),
        type: child.type,
        content: child.content,
        locales: child.locales ? JSON.parse(JSON.stringify(child.locales)) : undefined,
        attributes: child.attributes ? JSON.parse(JSON.stringify(child.attributes)) : undefined,
        children: [],
      }
      result.created++
    }
    if (child.arg) node.arg = child.arg
    else delete node.arg
    if (child.link) node.link = child.link
    else delete node.link
    adoptStructure(node, child, selfName, result)
    return node
  })

  masterChildren.forEach((m, mi) => {
    if (usedMaster.has(mi)) return
    result.orphaned.push({
      id: m.id,
      type: m.type,
      hadClasses: !!m.classes?.trim(),
      hadInteractions: (m.interactions?.length ?? 0) + (m.animations?.length ?? 0),
    })
  })
  return result
}
