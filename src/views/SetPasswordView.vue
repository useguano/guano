<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import { roleLabel } from '@/lib/roles'
import type { Role } from '@/composables/useAuth'
import LoadingUI from '@/components/ui/LoadingUI.vue'

const route = useRoute()
const token = String(route.params.token ?? '')

const invite = ref<{
  name: string
  email: string
  role: string
  invitedBy?: string
  projectName?: string
} | null>(null)
const loading = ref(true)
const invalid = ref(false)
const password = ref('')
const confirm = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

onMounted(async () => {
  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(token)}`)
    if (res.ok) invite.value = await res.json()
    else invalid.value = true
  } catch {
    invalid.value = true
  } finally {
    loading.value = false
  }
})

async function submit() {
  if (busy.value) return
  error.value = null
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    })
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? 'Could not set the password')
    window.location.assign('/admin')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not set the password'
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-16 bg-background">
    <MainLogo class="size-12" />

    <LoadingUI v-if="loading" label="Checking your invite…" />

    <div v-else-if="invalid || !invite" class="flex flex-col items-center gap-2">
      <p class="text-sm font-medium">This invite link is invalid or has expired.</p>
      <p class="text-xs text-muted-foreground">Ask an admin to send you a new one.</p>
    </div>

    <form v-else class="flex w-90 flex-col gap-2" @submit.prevent="submit">
      <div class="mb-4 flex flex-col items-center gap-1.5 text-center">
        <h1 class="text-xl font-semibold text-foreground">
          {{ invite.projectName || 'Join the project' }}
        </h1>
        <p class="text-sm text-muted-foreground">
          <template v-if="invite.invitedBy">
            <span class="font-medium text-foreground">{{ invite.invitedBy }}</span> invited you
          </template>
          <template v-else>You've been invited</template>
          to join as
          <span class="font-medium text-foreground">{{ roleLabel(invite.role as Role) }}</span>.
        </p>
        <p class="text-xs text-muted-foreground">
          Setting up {{ invite.email }} — choose a password to continue.
        </p>
      </div>
      <InputUI v-model="password" placeholder="Choose a password" size="lg" type="password" />
      <InputUI v-model="confirm" placeholder="Confirm password" size="lg" type="password" />

      <ButtonUI class="mt-4" variant="default" :disabled="busy" @click="submit">
        {{ busy ? 'Setting up…' : 'Join project' }}
      </ButtonUI>
      <div
        v-if="error"
        class="flex items-center justify-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger"
      >
        <CircleAlert class="size-3.5 shrink-0" />
        {{ error }}
      </div>
      <button type="submit" class="hidden"></button>
    </form>
  </div>
</template>
