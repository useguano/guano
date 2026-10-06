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

/**
 * Typed face of `shared/integrations.js` — the logic lives in the plain-JS
 * module so the server, the exporter and the MCP tools run the same code (see
 * its header for the model).
 */

/** one key of one integration. A SECRET field's `value` never leaves the
 * server, so the client only ever sees it absent. */
export interface IntegrationField {
  name: string
  secret: boolean
  updatedAt: number
  /** present only for a plain (non-secret) key */
  value?: string
}

export interface Integration {
  id: string
  name: string
  /** the `{{ENV.<env>_<KEY>}}` prefix the server computed from `name` */
  env: string
  fields: IntegrationField[]
}

/** what a capability needs, as the server reports it for a pick */
export interface CapabilityCheck {
  ok: boolean
  /** key names the picked integration is missing */
  missing: string[]
  /** human-readable reason when `ok` is false */
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
