<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleAlert, Check } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import LoadingUI from '@/components/ui/LoadingUI.vue'

const route = useRoute()

const code = ref(String(route.query.code ?? '').toUpperCase())
const request = ref<{
  userCode: string
  name: string
  kind?: 'agent' | 'launcher'
  expiresAt: number
} | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)
const done = ref<'approved' | 'denied' | null>(null)

const grants = ref({ allowMainWrites: false, allowPublish: false })
const SWITCHES = [
  {
    id: 'allowMainWrites' as const,
    label: 'Write to Main',
    hint: 'Edits land on the live project with no review step. Off, an agent works in a draft you apply yourself.',
  },
  {
    id: 'allowPublish' as const,
    label: 'Publish the site',
    hint: 'It can put the project on the live origin itself.',
  },
]

const forLauncher = computed(() => request.value?.kind === 'launcher')

const normalized = computed(() => code.value.trim().toUpperCase())

async function look() {
  if (!normalized.value) return
  loading.value = true
  error.value = null
  request.value = null
  try {
    const res = await fetch(`/api/auth/device/${encodeURIComponent(normalized.value)}`)
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? 'That code could not be found')
    request.value = detail
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'That code could not be found'
  } finally {
    loading.value = false
  }
}

async function send(action: 'approve' | 'deny') {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await fetch(`/api/auth/device/${encodeURIComponent(normalized.value)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        action === 'approve'
          ? { policy: { ...grants.value } }
          : {},
      ),
    })
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? `Could not ${action} this request`)
    done.value = action === 'approve' ? 'approved' : 'denied'
  } catch (e) {
    error.value = e instanceof Error ? e.message : `Could not ${action} this request`
  } finally {
    busy.value = false
  }
}

onMounted(look)
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-16 bg-background">
    <MainLogo class="size-12" />

    <div v-if="done" class="flex w-90 flex-col items-center gap-2 text-center">
      <Check v-if="done === 'approved'" class="size-6 text-success" />
      <p class="text-sm font-medium">
        {{ done === 'approved' ? 'Connected.' : 'Request denied.' }}
      </p>
      <p class="text-xs text-muted-foreground">
        {{
          done === 'approved'
            ? 'Go back to the app that asked — it has the token and is finishing up. You can close this tab.'
            : 'Nothing was granted. You can close this tab.'
        }}
      </p>
    </div>

    <LoadingUI v-else-if="loading" label="Looking up that code…" />

    <form v-else class="flex w-90 flex-col gap-2" @submit.prevent="request ? send('approve') : look()">
      <div class="mb-4 flex flex-col items-center gap-1.5 text-center">
        <h1 class="text-xl font-semibold text-foreground">Authorize a client</h1>
        <p v-if="request" class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">{{ request.name }}</span>
          {{
            forLauncher
              ? 'is asking for builder access to this project.'
              : 'is asking to connect to this project.'
          }}
        </p>
        <p v-else class="text-sm text-muted-foreground">
          Enter the code shown in your terminal.
        </p>
      </div>

      <InputUI
        v-if="!request"
        v-model="code"
        placeholder="XXXX-XXXX"
        size="lg"
        autocapitalize="characters"
      />

      <template v-else>
        <p class="mb-1 text-center font-mono text-sm tracking-widest text-muted-foreground">
          {{ request.userCode }}
        </p>
        <p v-if="forLauncher" class="mb-2 text-xs text-muted-foreground">
          It will open this project's editor on that Mac, with everything your own account can do —
          structure, settings, publishing. Revoke it any time in Settings → MCP.
        </p>
        <p v-else class="mb-2 text-xs text-muted-foreground">
          It will be able to read and edit this project's content through the API. Choose what else
          it may do — you can change these later in Settings → MCP.
        </p>
        <div
          v-for="s in forLauncher ? [] : SWITCHES"
          :key="s.id"
          class="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-foreground">{{ s.label }}</span>
            <span class="text-[11px] leading-snug text-muted-foreground">{{ s.hint }}</span>
          </div>
          <ToggleUI v-model="grants[s.id]" class="mt-0.5" />
        </div>
      </template>

      <ButtonUI
        v-if="!request"
        class="mt-4"
        variant="default"
        :disabled="loading || !normalized"
        @click="look"
      >
        Continue
      </ButtonUI>
      <template v-else>
        <ButtonUI class="mt-4" variant="default" :disabled="busy" @click="send('approve')">
          {{ busy ? 'Connecting…' : forLauncher ? 'Grant builder access' : 'Approve' }}
        </ButtonUI>
        <ButtonUI variant="ghost" :disabled="busy" @click="send('deny')">Deny</ButtonUI>
      </template>

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
