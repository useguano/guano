import { ref } from 'vue'
import { apiJson } from '@/lib/api'

/**
 * Form settings and submissions, hydrated from the server.
 *
 * None of this is project data. Recipients, the integration that sends and the
 * retention window are admin-only server state (publish.json), and the
 * submissions themselves are files on the server — because they are other
 * people's personal details, and the project blob is written by editors,
 * drafts, merges, contributors and agent tokens.
 */

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
  /** false for a form whose submissions remain but which is no longer on the site */
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

  /** returns the server's reason on refusal, so a bad pick is explained */
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

  /** the CSV download URL — a plain link, so the browser handles the save */
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
