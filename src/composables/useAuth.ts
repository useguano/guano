import { computed, ref } from 'vue'
import { flushStore } from '@/lib/store'
import { beginDeliberateNavigation } from './navigationIntent'

export type Role = 'admin' | 'editor' | 'contributor' | 'reviewer'

const email = ref<string | null>(null)
const name = ref('')
const role = ref<Role | null>(null)
const userId = ref<string | null>(null)
const needsSetup = ref(false)

const presetAgentPolicy = ref<{ allowMainWrites: boolean; allowPublish: boolean } | null>(null)

const commentsSeenAt = ref(0)
let checked = false

interface Profile {
  id?: string
  email: string
  name?: string
  role?: Role
  commentsSeenAt?: number
}

export function useAuth() {
  async function check(): Promise<void> {
    if (checked) return
    checked = true
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        applyProfile((await res.json()) as Profile)
      } else {
        const detail = await res.json().catch(() => null)
        needsSetup.value = !!detail?.needsSetup
        const preset = detail?.agentPolicy
        presetAgentPolicy.value =
          preset && typeof preset === 'object'
            ? { allowMainWrites: preset.allowMainWrites === true, allowPublish: preset.allowPublish === true }
            : null
      }
    } catch {
    }
  }

  async function post(path: string, body: Record<string, unknown>): Promise<Profile> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? `request failed (${res.status})`)
    return detail as Profile
  }

  function applyProfile(profile: Profile) {
    email.value = profile.email
    name.value = profile.name ?? ''
    role.value = profile.role ?? null
    userId.value = profile.id ?? null
    commentsSeenAt.value = profile.commentsSeenAt ?? 0
    needsSetup.value = false
  }

  async function markCommentsSeen() {
    const at = Date.now()
    if (at <= commentsSeenAt.value) return
    commentsSeenAt.value = at
    await fetch('/api/auth/comments-seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ at }),
    }).catch(() => {})
  }

  async function login(e: string, password: string) {
    applyProfile(await post('/api/auth/login', { email: e, password }))
  }

  async function setup(
    e: string,
    password: string,
    projectName = '',
    agentPolicy: { allowMainWrites: boolean; allowPublish: boolean } | null = {
      allowMainWrites: false,
      allowPublish: false,
    },
  ) {
    applyProfile(
      await post('/api/auth/setup', {
        email: e,
        password,
        projectName,
        ...(agentPolicy ? { agentPolicy } : {}),
      }),
    )
  }

  async function updateAccount(payload: {
    name?: string
    email?: string
    password?: string
    currentPassword?: string
  }) {
    applyProfile(await post('/api/auth/update', payload))
  }

  async function logout() {
    await flushStore()
    beginDeliberateNavigation()
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.assign('/admin/login')
  }

  const isAdmin = computed(() => role.value === 'admin')
  const canBuild = computed(() => role.value === 'admin' || role.value === 'editor')

  const canEditContent = computed(() => role.value !== null && role.value !== 'reviewer')
  const isReviewer = computed(() => role.value === 'reviewer')

  return {
    email,
    name,
    userId,
    role,
    isAdmin,
    canBuild,
    canEditContent,
    isReviewer,
    needsSetup,
    presetAgentPolicy,
    commentsSeenAt,
    markCommentsSeen,
    check,
    login,
    setup,
    updateAccount,
    logout,
  }
}
