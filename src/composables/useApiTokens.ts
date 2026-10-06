import { ref } from 'vue'
import { apiJson } from '@/lib/api'

// Per-user API tokens (bearer credentials for the Guano MCP server & scripts).
// The raw token is returned by create() exactly once and never stored client- or
// server-side — only its hash lives at rest. Mirrors useUsers' fetch shape.
export interface ApiTokenRow {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

const tokens = ref<ApiTokenRow[]>([])

export function useApiTokens() {
  async function load() {
    tokens.value = (await apiJson('/api/tokens')).tokens
  }

  /** create a token; returns the raw token string (shown once, then unrecoverable) */
  async function create(name: string): Promise<string> {
    const created = await apiJson('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    await load()
    return created.token as string
  }

  async function revoke(id: string) {
    await apiJson(`/api/tokens/${id}`, { method: 'DELETE' })
    await load()
  }

  return { tokens, load, create, revoke }
}
