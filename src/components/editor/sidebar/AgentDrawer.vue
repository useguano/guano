<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component as VueComponent } from 'vue'
import { Ban, Check, LoaderCircle, RotateCw, Square, TriangleAlert } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import { useAgentChat, type AgentToolState } from '@/composables/useAgentChat'
import { useElement } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'

const { status, busy, unavailableReason, model, rateLimit, turns, send, interrupt, restart } =
  useAgentChat()
const { activePage } = usePage()
const { selectedElement, selectedElementIds } = useElement()

const draft = ref('')
const listEl = ref<HTMLElement>()
const input = ref<InstanceType<typeof TextareaUI>>()

const TOOL_ICONS: Record<AgentToolState, VueComponent> = {
  running: LoaderCircle,
  done: Check,
  error: TriangleAlert,
  denied: Ban,
}

const TOOL_TONES: Record<AgentToolState, string> = {
  running: 'text-muted-foreground',
  done: 'text-success',
  error: 'text-danger',
  denied: 'text-danger',
}

const selection = computed(() => (selectedElementIds.value.length ? selectedElement.value : null))

const context = computed(() => {
  const page = activePage.value
  if (!page) return null
  const node = selection.value
  const address = node ? (node.ref ? `ref="${node.ref}"` : `data-id="${node.id}"`) : null
  const label = `${page.name}${node ? ` · ${node.ref ? `#${node.ref}` : node.type}` : ''}`
  const prompt =
    `Context from the Guano editor: the person is looking at the page ` +
    `"${page.name}" (${page.path})` +
    (node ? `, with the <${node.type}> element ${address} selected.` : '.')
  return { label, prompt }
})

const statusLabel = computed(() => {
  if (status.value === 'unavailable') return unavailableReason.value ?? 'stopped'
  if (status.value === 'thinking') return 'Thinking…'
  if (status.value === 'streaming') return 'Writing…'
  return model.value ?? 'Ready'
})

const canSend = computed(() => !!draft.value.trim() && !busy.value && status.value !== 'unavailable')

function submit() {
  if (!canSend.value) return
  send(draft.value, context.value)
  draft.value = ''
}

const tail = computed(() => {
  const turn = turns.value[turns.value.length - 1]
  if (!turn) return ''
  const last = turn.items[turn.items.length - 1]
  const written = last?.kind === 'text' ? last.text.length : 0
  return `${turns.value.length}:${turn.items.length}:${written}:${turn.done}`
})

watch(tail, () => {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
})

watch(
  () => activePage.value?.id,
  () => nextTick(() => input.value?.focus()),
)

nextTick(() => input.value?.focus())
</script>

<template>
  <div data-agent-panel class="flex h-full flex-col bg-background">
    <div class="flex items-center gap-1 px-2.5 pt-2 pb-1">
      <span class="min-w-0 flex-1 truncate section-label" data-agent-status>
        {{ statusLabel }}
      </span>
      <ButtonUI
        v-if="busy"
        variant="icon"
        size="xs"
        :icon="Square"
        tooltip="Stop"
        tooltip-side="right"
        class="w-5 text-muted-foreground"
        data-agent-stop
        @click="interrupt"
      />
      <ButtonUI
        v-else-if="status === 'unavailable'"
        variant="icon"
        size="xs"
        :icon="RotateCw"
        tooltip="Restart the agent"
        tooltip-side="right"
        class="w-5 text-muted-foreground"
        data-agent-restart
        @click="restart"
      />
    </div>

    <div
      ref="listEl"
      class="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 pb-3"
    >
      <p v-if="!turns.length" class="px-0.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
        Ask for a change to this page. The agent edits the site through its own tools, and every
        write lands on the canvas as it works.
      </p>

      <div v-for="turn in turns" :key="turn.id" data-agent-turn class="flex flex-col gap-1.5">
        <BadgeUI v-if="turn.context" class="max-w-full truncate">{{ turn.context }}</BadgeUI>
        <p
          data-agent-question
          class="rounded-lg bg-accent/20 px-2 py-1.5 text-[11px] whitespace-pre-wrap transition-opacity"
          :class="turn.sent ? '' : 'opacity-50'"
        >
          {{ turn.question }}
        </p>

        <template v-for="item in turn.items" :key="item.key">
          <p
            v-if="item.kind === 'text' && item.text"
            data-agent-text
            class="px-0.5 text-[11px] leading-relaxed whitespace-pre-wrap"
          >
            {{ item.text }}
          </p>

          <div
            v-else-if="item.kind === 'tool'"
            data-agent-tool
            :data-agent-tool-state="item.state"
            class="flex flex-col gap-0.5 rounded-lg border border-input px-2 py-1"
          >
            <div class="flex items-center gap-1.5">
              <component
                :is="TOOL_ICONS[item.state]"
                class="size-3 shrink-0"
                :class="[TOOL_TONES[item.state], item.state === 'running' && 'animate-spin']"
              />
              <span class="min-w-0 flex-1 truncate font-mono text-[10px]">{{ item.name }}</span>
            </div>
            <p v-if="item.input" class="truncate font-mono text-[10px] text-muted-foreground">
              {{ item.input }}
            </p>
            <p v-if="item.detail" class="text-[10px] leading-snug text-danger">{{ item.detail }}</p>
          </div>
        </template>

        <p v-if="turn.stopped" class="px-0.5 text-[10px] text-muted-foreground">Stopped.</p>
        <p v-if="turn.error" data-agent-error class="px-0.5 text-[10px] text-danger">
          {{ turn.error }}
        </p>
      </div>
    </div>

    <div class="flex shrink-0 flex-col gap-1.5 border-t border-input p-2">
      <p v-if="rateLimit" data-agent-ratelimit class="px-0.5 text-[10px] text-danger">
        {{ rateLimit }}
      </p>
      <BadgeUI v-if="context" class="max-w-full truncate">{{ context.label }}</BadgeUI>
      <TextareaUI
        ref="input"
        v-model="draft"
        :rows="3"
        placeholder="Ask for a change…"
        data-agent-input
        @keydown.enter.exact.prevent="submit"
      />
      <ButtonUI size="xs" :disabled="!canSend" class="justify-center" data-agent-send @click="submit">
        Send
      </ButtonUI>
    </div>
  </div>
</template>
