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

export interface InstanceMapping {
  master: ElementNode
  root: ElementNode
  def: ComponentDef

  instanceId: string

  mirrors: ElementNode[]
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

export const isInstanceWrapper = wrapper as (mapping: InstanceMapping | null | undefined) => boolean

export const isBareWrapper = bareWrapper as (
  node: ElementNode,
  master: ElementNode | null | undefined,
  state?: { classes?: string; targeted?: boolean },
) => boolean

export const nestedComponentNames = nested as (def: ComponentDef) => string[]

export const componentReaches = reaches as (
  components: ComponentDef[],
  from: string,
  to: string,
) => boolean

export const canNest = nest as (components: ComponentDef[], host: string, inner: string) => boolean

export const dependencyOrder = order as (components: ComponentDef[]) => ComponentDef[]
