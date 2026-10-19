import { computed, ref, type Ref } from 'vue'
import { flushStore } from '@/lib/store'
import { beginDeliberateNavigation } from './navigationIntent'

export type Role = 'admin' | 'editor' | 'contributor' | 'reviewer'

const email = ref<string | null>(null)
const name = ref('')
const role = ref<Role | null>(null)
/**
 * What this SESSION may act with, which is not always what the account is.
 *
 * A browser session is never a builder session: the server caps a cookie
 * session at `contributor` whatever the account's role, because the Build
 * surface lives in the desktop launcher. `role` stays the ACCOUNT's, for the
 * one sentence that explains the difference to a signed-in admin; every
 * capability below reads these two, which come from `/api/auth/me` and nowhere
 * else. The SPA pinning itself to Play is a CONSEQUENCE of this, never the
 * enforcement — that is at the API (→ docs/server.md, Builder sessions).
 */
const actingRole = ref<Role | null>(null)
const canBuildHere = ref(false)
const userId = ref<string | null>(null)
const needsSetup = ref(false)
const setupCodeRequired = ref(false)
const setupProjectName = ref('')
const host = ref<'browser' | 'launcher'>('browser')

const presetAgentPolicy = ref<{ allowMainWrites: boolean; allowPublish: boolean } | null>(null)

const commentsSeenAt = ref(0)
const formsSeenAt = ref(0)
let checked = false

interface Profile {
  id?: string
  email: string
  name?: string
  role?: Role
  effectiveRole?: Role
  canBuild?: boolean
  commentsSeenAt?: number
  formsSeenAt?: number
  host?: 'browser' | 'launcher'
}

export function useAuth() {
  async function recheck(): Promise<void> {
    checked = false
    await check()
  }

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
        setupCodeRequired.value = !!detail?.setupCodeRequired
        setupProjectName.value =
          typeof detail?.projectName === 'string' ? detail.projectName : ''
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
    // Only `/api/auth/me` answers these. A login/setup/update response carries
    // the profile and no more — the session it mints is not the one that made
    // the request — so capability stays FALSE until the recheck those three do,
    // which errs toward Play rather than toward a surface the API would refuse.
    actingRole.value = profile.effectiveRole ?? null
    canBuildHere.value = profile.canBuild === true
    userId.value = profile.id ?? null
    commentsSeenAt.value = profile.commentsSeenAt ?? 0
    formsSeenAt.value = profile.formsSeenAt ?? 0
    if (profile.host) host.value = profile.host
    needsSetup.value = false
  }

  async function markSeen(stamp: Ref<number>, path: string) {
    const at = Date.now()
    if (at <= stamp.value) return
    stamp.value = at
    await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ at }),
    }).catch(() => {})
  }

  const markCommentsSeen = () => markSeen(commentsSeenAt, '/api/auth/comments-seen')
  const markFormsSeen = () => markSeen(formsSeenAt, '/api/auth/forms-seen')

  async function login(e: string, password: string) {
    applyProfile(await post('/api/auth/login', { email: e, password }))
    // one source for what this session may do, and the login response is not it
    await recheck()
  }

  async function setup(
    e: string,
    password: string,
    projectName = '',
    agentPolicy: { allowMainWrites: boolean; allowPublish: boolean } | null = {
      allowMainWrites: false,
      allowPublish: false,
    },
    setupCode = '',
  ) {
    applyProfile(
      await post('/api/auth/setup', {
        email: e,
        password,
        projectName,
        ...(agentPolicy ? { agentPolicy } : {}),
        ...(setupCode ? { setupCode } : {}),
      }),
    )
    await recheck()
  }

  async function updateAccount(payload: {
    name?: string
    email?: string
    password?: string
    currentPassword?: string
  }) {
    applyProfile(await post('/api/auth/update', payload))
    // a password change revokes every session and re-issues one; `via` rides
    // along, but the capability has to be re-read rather than assumed
    await recheck()
  }

  async function logout() {
    await flushStore()
    beginDeliberateNavigation()
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.assign('/admin/login')
  }

  // Every capability reads the ACTING role. `role` is the account's and is for
  // display only — deriving a capability from it is how a browser-signed-in
  // admin gets offered a surface the API then refuses.
  const isAdmin = computed(() => actingRole.value === 'admin')
  const canBuild = computed(() => canBuildHere.value)

  const canEditContent = computed(() => actingRole.value !== null && actingRole.value !== 'reviewer')
  const isReviewer = computed(() => actingRole.value === 'reviewer')

  /**
   * An account that could build, in a browser that cannot. The one case that
   * needs saying out loud: otherwise an admin opens their own deployed instance
   * in Safari, reads their site as read-only, and files a bug.
   */
  const cappedByBrowser = computed(
    () => !canBuildHere.value && (role.value === 'admin' || role.value === 'editor'),
  )

  const showsAppHome = computed(() => host.value !== 'launcher')
  const showsAccountControls = computed(() => host.value !== 'launcher')
  const showsPublishControl = computed(() => host.value !== 'launcher')

  return {
    email,
    name,
    userId,
    role,
    isAdmin,
    canBuild,
    actingRole,
    cappedByBrowser,
    host,
    canEditContent,
    isReviewer,
    showsAppHome,
    showsAccountControls,
    showsPublishControl,
    needsSetup,
    setupCodeRequired,
    setupProjectName,
    presetAgentPolicy,
    commentsSeenAt,
    markCommentsSeen,
    formsSeenAt,
    markFormsSeen,
    check,
    recheck,
    login,
    setup,
    updateAccount,
    logout,
  }
}
