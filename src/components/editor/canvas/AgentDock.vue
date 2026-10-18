<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component as VueComponent } from 'vue'
import {
  Ban,
  Check,
  CornerDownLeft,
  LoaderCircle,
  RotateCw,
  Sparkles,
  Square,
  TriangleAlert,
  Wrench,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import { useAgentChat, type AgentToolState } from '@/composables/useAgentChat'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useElement } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'

const {
  open,
  available,
  status,
  busy,
  unavailableReason,
  model,
  rateLimit,
  turns,
  send,
  interrupt,
  restart,
  closeChat,
  toggleChat,
} = useAgentChat()
const { open: paletteOpen, closePalette } = useCommandPalette()
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

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeChat()
  }
}

const dockRoot = ref<HTMLElement>()
function onDocClick(e: MouseEvent) {
  if (dockRoot.value && !dockRoot.value.contains(e.target as Node)) closeChat()
}

watch(open, (isOpen) => {
  if (isOpen) {
    closePalette()
    nextTick(() => input.value?.focus())
    window.addEventListener('keydown', onWindowKeydown)
    nextTick(() => document.addEventListener('click', onDocClick))
  } else {
    window.removeEventListener('keydown', onWindowKeydown)
    document.removeEventListener('click', onDocClick)
  }
})

watch(paletteOpen, (isOpen) => {
  if (isOpen) closeChat()
})

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

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div
    v-if="available"
    ref="dockRoot"
    class="absolute bottom-1 left-13 z-40 flex max-w-[calc(100%-4.5rem)] flex-col-reverse items-start gap-2"
    @click.stop
  >
    <button
      v-tooltip.right="'Ask the AI agent (⌘J)'"
      type="button"
      aria-label="Ask the AI agent"
      data-agent-button
      class="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background shadow-lg transition-colors duration-200"
      :class="open ? 'border-accent text-foreground' : 'border-input text-muted-foreground'"
      @click="toggleChat"
    >
      <Sparkles class="size-5" />
    </button>

    <Transition name="agent">
      <div
        v-if="open"
        data-agent-panel
        class="flex w-[28rem] origin-bottom-left flex-col overflow-hidden rounded-2xl border border-input bg-background/96 shadow-xl backdrop-blur"
      >
        <div class="flex items-center justify-between gap-2 border-b border-input p-4">
          <div class="flex min-w-0 items-center gap-2">
            <Sparkles class="size-3.5 shrink-0 text-muted-foreground" />
            <p data-agent-status class="truncate text-xs text-muted-foreground">
              {{ statusLabel }}
            </p>
          </div>
          <ButtonUI
            v-if="busy"
            size="xs"
            variant="outline"
            :icon="Square"
            data-agent-stop
            @click="interrupt"
          >
            Stop
          </ButtonUI>
          <ButtonUI
            v-else-if="status === 'unavailable'"
            size="xs"
            variant="outline"
            :icon="RotateCw"
            data-agent-restart
            @click="restart"
          >
            Restart
          </ButtonUI>
        </div>

        <div
          ref="listEl"
          class="agent-scroll flex max-h-96 flex-col gap-4 overflow-y-auto p-4"
          @wheel.stop
        >
          <p v-if="!turns.length" class="py-6 text-center text-xs text-muted-foreground">
            Ask for a change to this page. The agent edits the site through its own tools, and
            every write lands on the canvas as it works.
          </p>

          <div
            v-for="turn in turns"
            :key="turn.id"
            data-agent-turn
            class="flex flex-col gap-2"
          >
            <div class="flex flex-col items-end gap-1">
              <BadgeUI v-if="turn.context">{{ turn.context }}</BadgeUI>
              <p
                data-agent-question
                class="max-w-[85%] rounded-xl bg-accent/20 px-3 py-2 text-xs whitespace-pre-wrap transition-opacity"
                :class="turn.sent ? '' : 'opacity-50'"
              >
                {{ turn.question }}
              </p>
            </div>

            <template v-for="item in turn.items" :key="item.key">
              <p
                v-if="item.kind === 'text' && item.text"
                data-agent-text
                class="text-xs leading-relaxed whitespace-pre-wrap"
              >
                {{ item.text }}
              </p>

              <div
                v-else-if="item.kind === 'tool'"
                data-agent-tool
                :data-agent-tool-state="item.state"
                class="flex flex-col gap-1 rounded-lg border border-input px-2 py-1.5"
              >
                <div class="flex items-center gap-1.5">
                  <component
                    :is="TOOL_ICONS[item.state]"
                    class="size-3 shrink-0"
                    :class="[TOOL_TONES[item.state], item.state === 'running' && 'animate-spin']"
                  />
                  <span class="font-mono text-[10px]">{{ item.name }}</span>
                </div>
                <p
                  v-if="item.input"
                  class="truncate font-mono text-[10px] text-muted-foreground"
                >
                  {{ item.input }}
                </p>
                <p v-if="item.detail" class="text-[10px] text-danger">{{ item.detail }}</p>
              </div>
            </template>

            <p v-if="turn.stopped" class="text-[10px] text-muted-foreground">Stopped.</p>
            <p v-if="turn.error" data-agent-error class="text-[10px] text-danger">
              {{ turn.error }}
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-2 border-t border-input p-4">
          <p v-if="rateLimit" data-agent-ratelimit class="text-[10px] text-danger">
            {{ rateLimit }}
          </p>
          <div class="flex items-center gap-1.5">
            <BadgeUI v-if="context">{{ context.label }}</BadgeUI>
          </div>
          <div class="relative">
            <TextareaUI
              ref="input"
              v-model="draft"
              :rows="2"
              placeholder="Ask for a change…"
              data-agent-input
              @keydown.enter.exact.prevent="submit"
            />
            <CornerDownLeft
              class="pointer-events-none absolute top-2 right-2 size-3.5 text-muted-foreground"
            />
          </div>
          <div class="flex justify-end">
            <ButtonUI size="xs" :disabled="!canSend" data-agent-send @click="submit">
              Send
            </ButtonUI>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.agent-enter-active,
.agent-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.15s ease;
}
.agent-enter-from,
.agent-leave-to {
  transform: scale(0.9) translateY(6px);
  opacity: 0;
}

.agent-scroll {
  scrollbar-width: thin;
}
</style>
