import { ref } from 'vue'
import { apiJson } from '@/lib/api'
import type { Integration } from '@/lib/integrations'

const integrations = ref<Integration[]>([])
const loaded = ref(false)
const loadError = ref<string | null>(null)

export function useIntegrations() {
  async function load() {
    loadError.value = null
    try {
      const data = await apiJson('/api/integrations')
      integrations.value = data.integrations ?? []
      loaded.value = true
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Could not load integrations'
    }
  }

  const absorb = (data: { integrations?: Integration[] }) => {
    if (data?.integrations) integrations.value = data.integrations
  }

  async function create(name: string) {
    const data = await apiJson('/api/integrations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    absorb(data)
    return data.id as string
  }

  async function rename(id: string, name: string) {
    absorb(
      await apiJson(`/api/integrations/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    )
  }

  async function remove(id: string) {
    absorb(
      await apiJson(`/api/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    )
  }

  async function setKey(id: string, key: string, value: string, secret: boolean) {
    absorb(
      await apiJson(
        `/api/integrations/${encodeURIComponent(id)}/keys/${encodeURIComponent(key)}`,
        { method: 'PUT', body: JSON.stringify({ value, secret }) },
      ),
    )
  }

  async function removeKey(id: string, key: string) {
    absorb(
      await apiJson(
        `/api/integrations/${encodeURIComponent(id)}/keys/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      ),
    )
  }

  async function test(id: string, capability: 'smtp' | 'webhook') {
    return (await apiJson(`/api/integrations/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: JSON.stringify({ capability }),
    })) as { ok: boolean; error?: string }
  }

  return {
    integrations,
    loaded,
    loadError,
    load,
    create,
    rename,
    remove,
    setKey,
    removeKey,
    test,
  }
}
