<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Copy, Link2, Plus, RefreshCw, Trash2, Clock, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import SettingsGroup from '@/components/shared/SettingsGroup.vue'
import EmptyListUI from '@/components/ui/EmptyListUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import RolePicker from '@/components/editor/users/RolePicker.vue'
import { useUsers, inviteLink, type InviteRow, type UserRow } from '@/composables/useUsers'
import { useAuth, type Role } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { roleLabel } from '@/lib/roles'

const { users, invites, isAdmin, load, invite, updateInvite, revokeInvite, setRole, remove } = useUsers()
const { email: myEmail } = useAuth()
const { confirm } = useModal()

const error = ref<string | null>(null)
const notice = ref<string | null>(null)
onMounted(() => load().catch((e) => (error.value = e.message)))

const adding = ref(false)
const iName = ref('')
const iEmail = ref('')
const iRole = ref<Role>('editor')
const iBusy = ref(false)
const iError = ref<string | null>(null)
const createdLink = ref<string | null>(null)
const createdEmail = ref('')
const createdRole = ref<Role>('editor')
const linkCopied = ref(false)

const isEmail = (v: string) => /.+@.+\..+/.test(v)

function openAdd() {
  adding.value = true
  createdLink.value = null
  iName.value = ''
  iEmail.value = ''
  iRole.value = 'editor'
  iError.value = null
}
function closeAdd() {
  adding.value = false
}

async function submitInvite() {
  if (iBusy.value) return
  iError.value = null
  if (!isEmail(iEmail.value.trim())) {
    iError.value = 'Enter a valid email address'
    return
  }
  iBusy.value = true
  try {
    const { link } = await invite({
      name: iName.value.trim(),
      email: iEmail.value.trim(),
      role: iRole.value,
    })
    createdLink.value = link
    createdEmail.value = iEmail.value.trim()
    createdRole.value = iRole.value
  } catch (e) {
    iError.value = e instanceof Error ? e.message : 'Could not create the invite'
  } finally {
    iBusy.value = false
  }
}

async function copyCreated() {
  if (!createdLink.value) return
  await navigator.clipboard.writeText(createdLink.value).catch(() => {})
  linkCopied.value = true
  setTimeout(() => (linkCopied.value = false), 1600)
}

const admin = computed(() => isAdmin())

const sortedUsers = computed(() =>
  [...users.value].sort((a, b) => (a.email === myEmail.value ? -1 : b.email === myEmail.value ? 1 : 0)),
)

function daysLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.ceil(ms / 86_400_000)
  return days <= 1 ? 'expires today' : `${days}d left`
}

async function run(fn: () => Promise<unknown>, ok?: string) {
  error.value = null
  notice.value = null
  try {
    await fn()
    if (ok) flashNotice(ok)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Action failed'
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flashNotice(msg: string) {
  notice.value = msg
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2500)
}

async function ask(title: string, message: string, label: string, action: () => Promise<void>) {
  if (await confirm({ title, message, confirmLabel: label })) await run(action)
}

function changeUserRole(u: UserRow, role: Role) {
  if (!u.id) return
  const demotingSelf = u.email === myEmail.value && u.role === 'admin' && role !== 'admin'
  if (demotingSelf) {
    void ask(
      'Give up admin access?',
      "You're changing your own role away from Admin. You'll lose access to member management.",
      'Change role',
      () => setRole(u.id!, role),
    )
  } else {
    void run(() => setRole(u.id!, role))
  }
}

function removeMember(u: UserRow) {
  if (!u.id) return
  void ask(
    'Remove member',
    `Remove ${u.name || u.email}? They lose access immediately and are signed out everywhere.`,
    'Remove',
    () => remove(u.id!),
  )
}

async function copyInvite(i: InviteRow) {
  if (!i.token) return
  await navigator.clipboard.writeText(inviteLink(i.token)).catch(() => {})
  flashNotice(`Invite link for ${i.email} copied`)
}

function regenerate(i: InviteRow) {
  if (!i.id) return
  void ask(
    'Regenerate link',
    `Create a fresh link for ${i.email}? The current link will stop working immediately.`,
    'Regenerate',
    async () => {
      const updated = await updateInvite(i.id!, { regenerate: true })
      if (updated?.token) {
        await navigator.clipboard.writeText(inviteLink(updated.token)).catch(() => {})
        flashNotice(`New link for ${i.email} copied to clipboard`)
      } else {
        flashNotice(`New link created for ${i.email}`)
      }
    },
  )
}

function revoke(i: InviteRow) {
  if (!i.id) return
  void ask('Revoke invite', `Revoke the invite for ${i.email}? The link will stop working.`, 'Revoke', () =>
    revokeInvite(i.id!),
  )
}
</script>

<template>
  <SettingsGroup
    title="Users"
    description="Who can sign in, and what each role may do."
  >
    <template #action>
      <ButtonUI
        v-if="admin"
        size="xs"
        :variant="adding ? 'outline' : 'default'"
        :icon="adding ? X : Plus"
        @click="adding ? closeAdd() : openAdd()"
      >
        {{ adding ? 'Close' : 'Add user' }}
      </ButtonUI>
    </template>

    <div v-if="admin && adding" class="flex flex-col gap-2 rounded-xl border border-input p-3">
      <template v-if="!createdLink">
        <RowUI label="Name"><InputUI v-model="iName" placeholder="Their name" /></RowUI>
        <RowUI label="Email">
          <InputUI v-model="iEmail" type="email" placeholder="them@example.com" @keydown.enter="submitInvite" />
        </RowUI>
        <RowUI label="Role"><RolePicker :role="iRole" @change="(r) => (iRole = r)" /></RowUI>
        <p v-if="iError" class="text-[10px] text-danger">{{ iError }}</p>
        <div class="flex justify-end gap-1.5">
          <ButtonUI variant="outline" size="xs" @click="closeAdd">Cancel</ButtonUI>
          <ButtonUI size="xs" :disabled="iBusy" @click="submitInvite">
            {{ iBusy ? 'Creating…' : 'Create invite link' }}
          </ButtonUI>
        </div>
      </template>

      <template v-else>
        <p class="flex items-center gap-1.5 text-xs">
          <Check class="size-3.5 shrink-0 text-success" />
          <span class="font-medium">{{ createdEmail }}</span>
          <span class="text-muted-foreground">· {{ roleLabel(createdRole) }}</span>
        </p>
        <ButtonUI :icon="linkCopied ? Check : Link2" size="sm" class="w-full justify-center" @click="copyCreated">
          {{ linkCopied ? 'Copied to clipboard' : 'Copy invite link' }}
        </ButtonUI>
        <p class="text-[10px] text-muted-foreground">
          Works once · expires in 7 days. You can copy it again from the list below.
        </p>
        <div class="flex justify-end gap-1.5">
          <ButtonUI variant="outline" size="xs" @click="openAdd">Add another</ButtonUI>
          <ButtonUI size="xs" @click="closeAdd">Done</ButtonUI>
        </div>
      </template>
    </div>

    <EmptyListUI v-if="!sortedUsers.length && !invites.length">No users yet.</EmptyListUI>
    <div v-else class="flex flex-col rounded-xl border border-input">
      <div
        v-for="u in sortedUsers"
        :key="u.email"
        class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
      >
        <span class="size-1.5 shrink-0 rounded-full bg-success" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium">
            {{ u.name || u.email }}
            <span v-if="u.email === myEmail" class="font-normal text-muted-foreground">(you)</span>
          </p>
          <p class="truncate text-[10px] text-muted-foreground">{{ u.email }}</p>
        </div>
        <RolePicker v-if="admin" :role="u.role" @change="(r) => changeUserRole(u, r)" />
        <span v-else class="shrink-0 text-xs text-muted-foreground">{{ roleLabel(u.role) }}</span>
        <MenuUI v-if="admin">
          <template #default="{ close }">
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
              @click="(removeMember(u), close())"
            >
              <Trash2 class="size-3.5" /> Remove
            </button>
          </template>
        </MenuUI>
      </div>

      <div
        v-for="i in invites"
        :key="i.email"
        class="flex items-center gap-2 border-b border-input px-3 py-2 opacity-70 last:border-b-0"
      >
        <span class="size-1.5 shrink-0 rounded-full border border-muted-foreground/50" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs">{{ i.email }}</p>
          <p class="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock class="size-2.5" /> invited · {{ daysLeft(i.expiresAt) }}
          </p>
        </div>
        <RolePicker
          v-if="admin && i.id"
          :role="i.role"
          @change="(r) => run(() => updateInvite(i.id!, { role: r }))"
        />
        <span v-else class="shrink-0 text-xs text-muted-foreground">{{ roleLabel(i.role) }}</span>
        <ButtonUI
          v-if="admin && i.token"
          variant="ghost"
          size="xs"
          :icon="Link2"
          tooltip="Copy invite link"
          class="text-muted-foreground"
          @click="copyInvite(i)"
        />
        <MenuUI v-if="admin && i.id">
          <template #default="{ close }">
            <button
              v-if="i.token"
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
              @click="(copyInvite(i), close())"
            >
              <Copy class="size-3.5" /> Copy link
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
              @click="(run(() => updateInvite(i.id!, { extend: true }), 'Expiry extended'), close())"
            >
              <Clock class="size-3.5" /> Extend 7 days
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
              @click="(regenerate(i), close())"
            >
              <RefreshCw class="size-3.5" /> Regenerate link
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
              @click="(revoke(i), close())"
            >
              <Trash2 class="size-3.5" /> Revoke
            </button>
          </template>
        </MenuUI>
      </div>
    </div>

    <p v-if="notice" class="flex items-center gap-1 px-1 text-[10px] text-success">
      <Check class="size-3" /> {{ notice }}
    </p>
    <p v-if="error" class="px-1 text-[10px] text-danger">{{ error }}</p>

  </SettingsGroup>
</template>
