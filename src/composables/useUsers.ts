import { ref } from 'vue'
import { useAuth, type Role } from './useAuth'
import { apiJson } from '@/lib/api'

export interface UserRow {
  /** absent in the redacted (non-admin) members view */
  id?: string
  name: string
  email: string
  role: Role
}
export interface InviteRow {
  /** absent in the redacted (non-admin) members view */
  id?: string
  name?: string
  email: string
  role: Role
  invitedBy?: string
  expiresAt: number
  /** raw token (admin view only) — lets the link be rebuilt any time */
  token?: string | null
}

const users = ref<UserRow[]>([])
const invites = ref<InviteRow[]>([])

/** build the shareable accept link from a raw invite token */
export const inviteLink = (token: string) => `${window.location.origin}/admin/invite/${token}`

export function useUsers() {
  const { role } = useAuth()
  const isAdmin = () => role.value === 'admin'

  async function load() {
    // admins get the full list (with tokens); everyone else a redacted view
    const data = await apiJson(isAdmin() ? '/api/users' : '/api/users/members')
    users.value = data.users
    invites.value = data.invites
  }

  /** create an invite; returns { link, token } (also retrievable later) */
  async function invite(payload: { name: string; email: string; role: Role }) {
    const created = await apiJson('/api/users/invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    await load()
    return { token: created.token as string, link: inviteLink(created.token) }
  }

  /** edit a pending invite: { role } | { extend: true } | { regenerate: true } */
  async function updateInvite(
    id: string,
    patch: { role?: Role; extend?: boolean; regenerate?: boolean },
  ) {
    const updated = await apiJson(`/api/users/invite/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    await load()
    return updated as InviteRow
  }

  async function revokeInvite(id: string) {
    await apiJson(`/api/users/invite/${id}`, { method: 'DELETE' })
    await load()
  }

  async function setRole(id: string, role: Role) {
    await apiJson(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
    await load()
  }

  async function remove(id: string) {
    await apiJson(`/api/users/${id}`, { method: 'DELETE' })
    await load()
  }

  return { users, invites, isAdmin, load, invite, updateInvite, revokeInvite, setRole, remove }
}
