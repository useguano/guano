import { ref } from 'vue'
import { useAuth, type Role } from './useAuth'
import { apiJson } from '@/lib/api'

export interface UserRow {
  id?: string
  name: string
  email: string
  role: Role
}
export interface InviteRow {
  id?: string
  name?: string
  email: string
  role: Role
  invitedBy?: string
  expiresAt: number
  token?: string | null
}

const users = ref<UserRow[]>([])
const invites = ref<InviteRow[]>([])

export const inviteLink = (token: string) => `${window.location.origin}/admin/invite/${token}`

export function useUsers() {
  const { role } = useAuth()
  const isAdmin = () => role.value === 'admin'

  async function load() {
    const data = await apiJson(isAdmin() ? '/api/users' : '/api/users/members')
    users.value = data.users
    invites.value = data.invites
  }

  async function invite(payload: { name: string; email: string; role: Role }) {
    const created = await apiJson('/api/users/invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    await load()
    return { token: created.token as string, link: inviteLink(created.token) }
  }

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
