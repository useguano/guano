import {
  KEY_NAME_RE as keyRe,
  MAX_KEYS_PER_INTEGRATION as maxKeys,
  MAX_INTEGRATIONS as maxIntegrations,
  envName as env,
  envPrefix as prefix,
  envRef as ref,
  envRefsIn as refsIn,
  integrationNameError as nameError,
  keyNameError as keyError,
  normalizeKeyName as normalizeKey,
} from './shared/integrations.js'

export interface IntegrationField {
  name: string
  secret: boolean
  updatedAt: number
  value?: string
}

export interface Integration {
  id: string
  name: string
  env: string
  fields: IntegrationField[]
}

export interface CapabilityCheck {
  ok: boolean
  missing: string[]
  reason?: string
}

export const KEY_NAME_RE: RegExp = keyRe
export const MAX_INTEGRATIONS: number = maxIntegrations
export const MAX_KEYS_PER_INTEGRATION: number = maxKeys

export const envPrefix: (name: string) => string = prefix
export const envName: (integrationName: string, keyName: string) => string = env
export const envRef: (integrationName: string, keyName: string) => string = ref
export const envRefsIn: (text: string) => string[] = refsIn
export const integrationNameError: (name: string) => string | null = nameError
export const keyNameError: (name: string) => string | null = keyError
export const normalizeKeyName: (name: string) => string = normalizeKey
