<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, CircleAlert } from 'lucide-vue-next'
import ModalDialog from '@/components/modal/ModalDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { usePublish } from '@/composables/usePublish'
import { useBranches } from '@/composables/useBranches'
import { useSettings } from '@/composables/useSettings'
import type { PublishMethod } from '@/types/editor'

// visual minimum so the ring doesn't flash on a fast local POST
const MIN_DURATION = 800

const emit = defineEmits<{
  close: []
}>()

const { markPublished } = usePublish()
const { onMain, activeBranch } = useBranches()
const { settings } = useSettings()

// capture the method once at mount — a mid-dialog settings change must not
// morph what this run does (same capture-at-mount discipline as needsConfirm)
const method = ref<PublishMethod>(settings.value.publishing?.method ?? 'server')
const repo = settings.value.publishing?.github?.repo ?? ''

const PROGRESS_COPY: Record<PublishMethod, string> = {
  server: 'Exporting and deploying your site…',
  zip: 'Exporting and packaging your site…',
  github: 'Exporting and pushing to GitHub…',
}
const successCopy = computed(() =>
  method.value === 'zip'
    ? 'Site zipped — download started.'
    : method.value === 'github'
      ? `Pushed to ${repo || 'GitHub'}`
      : 'Published!',
)

// on a draft, publishing still ships Main — pause on a confirm step so the
// user reads that before anything deploys (captured at mount: a mid-dialog
// branch flip must not morph the UI)
const needsConfirm = ref(!onMain.value)

const published = ref(false)
const error = ref<string | null>(null)
const progress = ref(0) // 0 → 1, drives the ring fill
let cancelled = false

// ring geometry
const R = 34
const CIRC = 2 * Math.PI * R
const dashoffset = computed(() => CIRC * (1 - progress.value))

async function publish() {
  error.value = null
  progress.value = 0
  // double rAF: let the empty ring paint first, THEN grow it — otherwise
  // the browser never sees the start state and skips the transition
  requestAnimationFrame(() => requestAnimationFrame(() => (progress.value = 1)))
  const started = Date.now()
  try {
    await markPublished(method.value)
    const remaining = MIN_DURATION - (Date.now() - started)
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
    if (!cancelled) published.value = true
  } catch (e) {
    if (!cancelled) {
      progress.value = 0
      error.value = e instanceof Error ? e.message : 'Publish failed'
    }
  }
}

function confirmPublish() {
  needsConfirm.value = false
  void publish()
}

onMounted(() => {
  if (!needsConfirm.value) void publish()
})

function cancel() {
  cancelled = true
  emit('close')
}

function viewLive() {
  // hard navigation: the public site always boots fresh
  window.open('/', '_blank')
}
</script>

<template>
  <ModalDialog
    :title="published ? 'Published' : needsConfirm ? 'Publish' : 'Publishing'"
    size="sm"
    @close="cancel"
  >
    <div v-if="needsConfirm" class="flex flex-col gap-2 py-2">
      <p class="text-sm">
        You're on the draft “{{ activeBranch.name }}” — publishing puts Main's version live.
      </p>
      <p class="text-xs text-muted-foreground">
        Your draft changes are not included until you merge them into Main.
      </p>
    </div>
    <div v-else class="flex flex-col items-center gap-4 py-4">
      <div class="relative flex size-24 items-center justify-center">
        <svg class="size-24 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" :r="R" fill="none" stroke="var(--muted)" stroke-width="4" />
          <circle
            cx="40"
            cy="40"
            :r="R"
            fill="none"
            :stroke="error ? 'var(--danger)' : published ? 'var(--success)' : 'var(--foreground)'"
            stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="CIRC"
            :style="{
              strokeDashoffset: dashoffset,
              transition: `stroke-dashoffset ${MIN_DURATION}ms linear, stroke 0.2s`,
            }"
          />
        </svg>
        <Check v-if="published" class="absolute size-8 text-success" />
        <CircleAlert v-else-if="error" class="absolute size-8 text-danger" />
      </div>

      <p class="text-sm font-medium">
        {{ published ? successCopy : error ? 'Publish failed' : 'Publishing your site…' }}
      </p>
      <p v-if="error" class="text-xs text-danger">{{ error }}</p>
      <p v-else-if="!published" class="text-xs text-muted-foreground">
        {{ PROGRESS_COPY[method] }}
      </p>
    </div>

    <template #actions>
      <template v-if="needsConfirm">
        <ButtonUI variant="outline" size="sm" @click="cancel">Cancel</ButtonUI>
        <ButtonUI variant="default" size="sm" @click="confirmPublish">Publish</ButtonUI>
      </template>
      <template v-else-if="published">
        <template v-if="method === 'zip'">
          <ButtonUI variant="default" size="sm" @click="emit('close')">Close</ButtonUI>
        </template>
        <template v-else>
          <ButtonUI variant="outline" size="sm" @click="emit('close')">Close</ButtonUI>
          <ButtonUI variant="default" size="sm" @click="viewLive">View live</ButtonUI>
        </template>
      </template>
      <template v-else-if="error">
        <ButtonUI variant="outline" size="sm" @click="cancel">Close</ButtonUI>
        <ButtonUI variant="default" size="sm" @click="publish">Retry</ButtonUI>
      </template>
      <ButtonUI v-else variant="outline" size="sm" @click="cancel">Cancel</ButtonUI>
    </template>
  </ModalDialog>
</template>
