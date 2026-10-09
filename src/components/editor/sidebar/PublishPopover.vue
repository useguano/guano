<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import {
  Check,
  CircleAlert,
  ExternalLink,
  FileArchive,
  Github,
  Rocket,
  Server,
  Settings2,
} from 'lucide-vue-next'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { usePersistence, SAVE_STATES } from '@/composables/usePersistence'
import { usePublish } from '@/composables/usePublish'
import { useBranches } from '@/composables/useBranches'
import { useSettings } from '@/composables/useSettings'
import { useModal } from '@/composables/useModal'
import { usePopover } from '@/composables/usePopover'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'
import type { PublishMethod } from '@/types/editor'

const SettingsPanel = defineAsyncComponent(() => import('@/components/shared/SettingsPanel.vue'))

const MIN_DURATION = 800

const { status, saveNow } = usePersistence()
const { hasUnpublishedChanges, markPublished, publishedInfo } = usePublish()
const { onMain, activeBranch } = useBranches()
const { settings } = useSettings()
const { openModal } = useModal()
const { closePopover } = usePopover()

const method = computed<PublishMethod>(() => settings.value.publishing?.method ?? 'server')
const repo = computed(() => settings.value.publishing?.github?.repo ?? '')

const DESTINATION: Record<PublishMethod, { icon: typeof Server; label: string }> = {
  server: { icon: Server, label: 'This server' },
  zip: { icon: FileArchive, label: 'Download .zip' },
  github: { icon: Github, label: 'GitHub' },
}
const destination = computed(() => DESTINATION[method.value])
const destinationDetail = computed(() =>
  method.value === 'github' ? repo.value || 'No repository set' : 'The live site refreshes on publish.',
)

const PROGRESS_COPY: Record<PublishMethod, string> = {
  server: 'Exporting and deploying your site…',
  zip: 'Exporting and packaging your site…',
  github: 'Exporting and pushing to GitHub…',
}
const successCopy = computed(() =>
  method.value === 'zip'
    ? 'Site zipped — download started.'
    : method.value === 'github'
      ? `Pushed to ${repo.value || 'GitHub'}`
      : 'Your site is live.',
)

const phase = ref<'idle' | 'publishing' | 'done' | 'error'>('idle')
const error = ref<string | null>(null)
const progress = ref(0)
let controller: AbortController | null = null

const R = 26
const CIRC = 2 * Math.PI * R
const dashoffset = computed(() => CIRC * (1 - progress.value))

async function publish() {
  error.value = null
  progress.value = 0
  phase.value = 'publishing'
  controller = new AbortController()
  const signal = controller.signal
  requestAnimationFrame(() => requestAnimationFrame(() => (progress.value = 1)))
  const started = Date.now()
  try {
    await markPublished(method.value, signal)
    const remaining = MIN_DURATION - (Date.now() - started)
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
    if (!signal.aborted) phase.value = 'done'
  } catch (e) {
    if (signal.aborted) return
    progress.value = 0
    error.value = e instanceof Error ? e.message : 'Publish failed'
    phase.value = 'error'
  }
}

function cancel() {
  controller?.abort()
  progress.value = 0
  phase.value = 'idle'
}

function openPublishSettings() {
  closePopover()
  openModal(SettingsPanel, { initialSection: 'publish' })
}

function viewLive() {
  window.open('/', '_blank')
}
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <div class="flex items-start gap-2.5 rounded-lg border border-input bg-muted/40 p-3">
      <component :is="destination.icon" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium">Publishing to {{ destination.label }}</p>
        <p class="truncate text-[11px] text-muted-foreground">{{ destinationDetail }}</p>
      </div>
      <ButtonUI
        variant="ghost" size="sm"
        class="-mr-1.5 -mt-1 w-7 shrink-0 text-muted-foreground"
        :icon="Settings2"
        v-tooltip="'Change publish settings'"
        @click="openPublishSettings"
      />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <BadgeUI v-tooltip="SAVE_STATES[status].label">
        <span class="size-1.5 rounded-full" :class="SAVE_STATES[status].dot" />
        {{ SAVE_STATES[status].short }}
      </BadgeUI>
      <BadgeUI
        v-tooltip="hasUnpublishedChanges ? 'Main has unpublished changes' : 'Everything is published'"
      >
        <span
          class="size-1.5 rounded-full"
          :class="hasUnpublishedChanges ? 'bg-pending' : 'bg-success'"
        />
        {{ hasUnpublishedChanges ? 'Unpublished changes' : 'Published' }}
      </BadgeUI>
      <ButtonUI
        v-if="status === 'error'"
        variant="outline" size="sm"
        class="ml-auto"
        @click="saveNow"
      >
        Retry
      </ButtonUI>
    </div>

    <div class="border-t border-input pt-3 text-xs">
      <template v-if="publishedInfo">
        <p class="text-muted-foreground">
          Last published <span class="text-foreground">{{ timeAgo(publishedInfo.publishedAt) }}</span>
        </p>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          {{ publishedInfo.routes }} routes · {{ formatBytes(publishedInfo.bytes) }}
          <template v-if="publishedInfo.commit"> · {{ publishedInfo.commit.slice(0, 7) }}</template>
        </p>
      </template>
      <p v-else class="text-muted-foreground">Not published yet.</p>
    </div>

    <p v-if="!onMain" class="text-[11px] text-pending">
      You're on the draft “{{ activeBranch.name }}” — publishing puts Main's version live. Draft
      changes aren't included until you merge them.
    </p>

    <div v-if="phase !== 'idle'" class="flex items-center gap-3 rounded-lg border border-input p-3">
      <div class="relative flex size-14 shrink-0 items-center justify-center">
        <svg class="size-14 -rotate-90" viewBox="0 0 60 60">
          <circle cx="30" cy="30" :r="R" fill="none" stroke="var(--muted)" stroke-width="4" />
          <circle
            cx="30"
            cy="30"
            :r="R"
            fill="none"
            :stroke="phase === 'error' ? 'var(--danger)' : phase === 'done' ? 'var(--success)' : 'var(--foreground)'"
            stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="CIRC"
            :style="{
              strokeDashoffset: dashoffset,
              transition: `stroke-dashoffset ${MIN_DURATION}ms linear, stroke 0.2s`,
            }"
          />
        </svg>
        <Check v-if="phase === 'done'" class="absolute size-5 text-success" />
        <CircleAlert v-else-if="phase === 'error'" class="absolute size-5 text-danger" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium">
          {{ phase === 'done' ? successCopy : phase === 'error' ? 'Publish failed' : 'Publishing your site…' }}
        </p>
        <p v-if="phase === 'error'" class="mt-0.5 text-[11px] text-danger">{{ error }}</p>
        <p v-else class="mt-0.5 text-[11px] text-muted-foreground">{{ PROGRESS_COPY[method] }}</p>
      </div>
    </div>

    <div class="flex gap-2" @click.stop>
      <template v-if="phase === 'publishing'">
        <ButtonUI variant="outline" size="sm" class="flex-1 justify-center" @click="cancel">
          Cancel
        </ButtonUI>
      </template>
      <template v-else-if="phase === 'done'">
        <ButtonUI
          v-if="method !== 'zip'"
          variant="default" size="sm" :icon="ExternalLink"
          class="flex-1 justify-center"
          @click="viewLive"
        >
          View live
        </ButtonUI>
        <ButtonUI
          :variant="method === 'zip' ? 'default' : 'outline'" size="sm"
          class="flex-1 justify-center"
          @click="phase = 'idle'"
        >
          Done
        </ButtonUI>
      </template>
      <template v-else-if="phase === 'error'">
        <ButtonUI variant="default" size="sm" :icon="Rocket" class="flex-1 justify-center" @click="publish">
          Retry
        </ButtonUI>
      </template>
      <template v-else>
        <ButtonUI variant="default" size="sm" :icon="Rocket" class="flex-1 justify-center" @click="publish">
          Publish
        </ButtonUI>
      </template>
    </div>
  </div>
</template>
