import type { Role } from '@/composables/useAuth'

export interface RoleInfo {
  value: Role
  label: string
  blurb: string
}

export const ROLE_INFO: RoleInfo[] = [
  { value: 'admin', label: 'Admin', blurb: 'Full control — pages, publishing, and members' },
  { value: 'editor', label: 'Editor', blurb: 'Builds pages and can publish' },
  { value: 'contributor', label: 'Contributor', blurb: 'Edits content and leaves comments' },
  { value: 'reviewer', label: 'Reviewer', blurb: 'Views the site and leaves comments' },
]

export const roleLabel = (role: Role) => ROLE_INFO.find((r) => r.value === role)?.label ?? role
