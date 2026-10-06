import type { ComponentDef, ElementNode } from '@/types/editor'
import {
  canNest as nest,
  componentReaches as reaches,
  dependencyOrder as order,
  isInstanceWrapper as wrapper,
  isBareWrapper as bareWrapper,
  nestedComponentNames as nested,
  buildInstanceMap as build,
  inheritedInstanceValue as inherited,
  isNodeHidden as hidden,
  resolveInstanceValue as resolve,
  setNodeHidden as setHidden,
} from './shared/instances.js'

/**
 * Typed face of `shared/instances.js` — the logic lives in the plain-JS module
 * so the exporter and the MCP tools run the exact same code (see its header).
 */

export interface InstanceMapping {
  /** the master node this page node stands for: its classes, interactions and
   * structure live there */
  master: ElementNode
  /** the root of that master's component, for interaction lookups */
  root: ElementNode
  /** the component itself */
  def: ComponentDef
  /** the instance wrapper this node sits in — what keeps a binding's state
   * unique per instance */
  instanceId: string
  /** nodes between this one and its master that may also carry its state,
   * most specific first */
  mirrors: ElementNode[]
  /** the instance's variant option per axis */
  picks: Record<string, string>
}

export const buildInstanceMap = build as (
  roots: ElementNode[],
  components: ComponentDef[],
) => Map<string, InstanceMapping>

export const resolveInstanceValue = resolve as <K extends keyof ElementNode>(
  node: ElementNode,
  mapping: InstanceMapping | null | undefined,
  key: K,
) => ElementNode[K]

export const inheritedInstanceValue = inherited as <K extends keyof ElementNode>(
  mapping: InstanceMapping | null | undefined,
  key: K,
) => ElementNode[K]

export const isNodeHidden = hidden as (
  node: ElementNode,
  mapping: InstanceMapping | null | undefined,
) => boolean

export const setNodeHidden = setHidden as (
  node: ElementNode,
  mapping: InstanceMapping | null | undefined,
  hidden: boolean,
) => void

/** is this mapped node the `:Name` wrapper of its instance? */
export const isInstanceWrapper = wrapper as (mapping: InstanceMapping | null | undefined) => boolean

/** does this `:Name` wrapper emit no element of its own? One rule for all three
 *  renderers — see the doc comment in shared/instances.js for why it is shared */
export const isBareWrapper = bareWrapper as (
  node: ElementNode,
  master: ElementNode | null | undefined,
  state?: { classes?: string; targeted?: boolean },
) => boolean

/** the components a component's master holds directly, by name */
export const nestedComponentNames = nested as (def: ComponentDef) => string[]

export const componentReaches = reaches as (
  components: ComponentDef[],
  from: string,
  to: string,
) => boolean

/** may an instance of `inner` sit inside `host`'s master? Never in a cycle. */
export const canNest = nest as (components: ComponentDef[], host: string, inner: string) => boolean

/** each component after everything it holds */
export const dependencyOrder = order as (components: ComponentDef[]) => ComponentDef[]
