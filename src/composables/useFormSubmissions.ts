import { ref } from 'vue'
import { apiJson } from '@/lib/api'

export interface FormsConfig {
  notifyTo: string[]
  mailer: string
  webhook: string
  retentionDays: number
  mailerCheck?: { ok: boolean; missing: string[]; reason?: string }
  webhookCheck?: { ok: boolean; missing: string[]; reason?: string }
}

export interface FormSummary {
  formId: string
  name: string
  onSite: boolean
  routes: string[]
  fields: { name: string; kind: string }[]
  count: number
  bytes: number
  latestAt: number
  spamDropped: number
  storageFull: boolean
  delivery: {
    notify?: { ok: boolean; error?: string; at: number }
    forward?: { ok: boolean; error?: string; at: number }
  }
}

export interface Submission {
  id: string
  at: number
  route: string
  entry?: string
  values: Record<string, string | boolean>
}

const config = ref<FormsConfig>({ notifyTo: [], mailer: '', webhook: '', retentionDays: 365 })
const forms = ref<FormSummary[]>([])

export function useFormSubmissions() {
  async function loadConfig() {
    config.value = await apiJson('/api/forms-config')
  }

  async function saveConfig(patch: Partial<FormsConfig>) {
    const next = await apiJson('/api/forms-config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    config.value = next
  }

  async function loadForms() {
    forms.value = (await apiJson('/api/forms')).forms ?? []
  }

  async function loadSubmissions(formId: string, opts: { before?: string; limit?: number } = {}) {
    const params = new URLSearchParams()
    if (opts.before) params.set('before', opts.before)
    if (opts.limit) params.set('limit', String(opts.limit))
    const query = params.toString()
    return (await apiJson(
      `/api/forms/${encodeURIComponent(formId)}/submissions${query ? `?${query}` : ''}`,
    )) as { fields: { name: string; kind: string }[]; total: number; submissions: Submission[] }
  }

  async function deleteSubmission(formId: string, id: string) {
    await apiJson(
      `/api/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
    await loadForms()
  }

  async function deleteAll(formId: string) {
    await apiJson(`/api/forms/${encodeURIComponent(formId)}/submissions`, { method: 'DELETE' })
    await loadForms()
  }

  const csvUrl = (formId: string) =>
    `/api/forms/${encodeURIComponent(formId)}/submissions.csv`

  return {
    config,
    forms,
    loadConfig,
    saveConfig,
    loadForms,
    loadSubmissions,
    deleteSubmission,
    deleteAll,
    csvUrl,
  }
}
