import { computed, ref } from 'vue'
import { flushStore } from '@/lib/store'
import { beginDeliberateNavigation } from './navigationIntent'

export type Role = 'admin' | 'editor' | 'contributor' | 'reviewer'

const email = ref<string | null>(null)
const name = ref('')
const role = ref<Role | null>(null)
/** the signed-in user's id — stamped onto drafts so ownership is knowable */
const userId = ref<string | null>(null)
const needsSetup = ref(false)
/** the two agent switches when they were answered BEFORE the first account
 * (the scaffolder's questions, `guano connect --offline`) — the setup form
 * then shows them instead of asking again. Null when nothing was preset. */
const presetAgentPolicy = ref<{ allowMainWrites: boolean; allowPublish: boolean } | null>(null)
/** when this user last opened the comments panel — everything newer, by
 * somebody else, is what the rail's unseen dot is about. Per user and stored
 * on their server record, so it is the same on every machine they sign in
 * from; 0 until they have looked once. */
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
  /** memoized session check against the server */
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
      // server unreachable — treated as unauthenticated; the editor
      // boot gate surfaces the connectivity error separately
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
    // the id is what tells a comment of yours from someone else's; the login
    // and setup responses carry it too, and leaving it unset here meant a
    // freshly signed-in session counted its OWN comments as unread
    userId.value = profile.id ?? null
    commentsSeenAt.value = profile.commentsSeenAt ?? 0
    needsSetup.value = false
  }

  /** stamp "I have seen the comments" — optimistic, because the dot going
   * out must not wait on a round trip, and a failed write only means the dot
   * comes back on the next load. */
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

  /** first-run bootstrap. `projectName` is the SITE's name — the server seeds
   * the project blob with it, so a fresh instance is usable before anyone
   * opens the editor (the localStorage stash in SetupView stays as the
   * fallback for a server that couldn't seed). */
  async function setup(
    e: string,
    password: string,
    projectName = '',
    agentPolicy: { allowMainWrites: boolean; allowPublish: boolean } | null = {
      allowMainWrites: false,
      allowPublish: false,
    },
  ) {
    // null = the policy was preset before setup; leave the stored answers alone
    applyProfile(
      await post('/api/auth/setup', {
        email: e,
        password,
        projectName,
        ...(agentPolicy ? { agentPolicy } : {}),
      }),
    )
  }

  /** update name / email / password (password needs currentPassword) */
  async function updateAccount(payload: {
    name?: string
    email?: string
    password?: string
    currentPassword?: string
  }) {
    applyProfile(await post('/api/auth/update', payload))
  }

  async function logout() {
    await flushStore() // don't drop in-flight edits
    beginDeliberateNavigation() // ...and don't warn about what we just flushed
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    // hard reload drops all editor singleton state
    window.location.assign('/admin/login')
  }

  // role-derived capabilities (UI gating; the server enforces the rest)
  const isAdmin = computed(() => role.value === 'admin')
  const canBuild = computed(() => role.value === 'admin' || role.value === 'editor')
  /** may this account change CONTENT — text, media, entries, page status?
   * Everyone but a reviewer, who reads and comments and nothing else. The
   * server enforces the same line (a reviewer's project write keeps only
   * `comments`); this is what keeps the UI from offering a write that would
   * silently land nowhere. */
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
