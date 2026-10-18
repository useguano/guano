<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component as VueComponent } from 'vue'
import {
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Plus,
  RotateCw,
  Square,
  TriangleAlert,
  X,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import {
  useAgentChat,
  type AgentAttachment,
  type AgentItem,
  type AgentToolItem,
  type AgentToolState,
} from '@/composables/useAgentChat'
import { useAuth } from '@/composables/useAuth'
import { useBranches } from '@/composables/useBranches'
import { useElement } from '@/composables/useElement'
import { useNotice } from '@/composables/useNotice'
import { usePage } from '@/composables/usePage'
import { apiJson } from '@/lib/api'
import { MODEL_CHOICES, modelChoice, modelLabel } from '@/lib/agentLabels'
import { blocks, type Block } from '@/lib/agentMarkdown'

const {
  status,
  busy,
  step,
  switchingTo,
  unavailableReason,
  model,
  rateLimit,
  turns,
  send,
  setModel,
  interrupt,
  restart,
} = useAgentChat()
const { activePage } = usePage()
const { selectedElement, selectedElementIds } = useElement()
const { notify } = useNotice()
const { isAdmin } = useAuth()
const { branches, onMain } = useBranches()

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const draft = ref('')
const attachments = ref<(AgentAttachment & { url: string })[]>([])
const expanded = ref<Set<string>>(new Set())
const listEl = ref<HTMLElement>()
const input = ref<InstanceType<typeof TextareaUI>>()
const fileInput = ref<HTMLInputElement>()

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

type Segment =
  | { kind: 'text'; key: string; blocks: Block[] }
  | { kind: 'activity'; key: string; tools: AgentToolItem[] }

function segment(items: AgentItem[]): Segment[] {
  const out: Segment[] = []
  for (const item of items) {
    if (item.kind === 'text') {
      if (item.text.trim()) out.push({ kind: 'text', key: item.key, blocks: blocks(item.text) })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'activity') last.tools.push(item)
    else out.push({ kind: 'activity', key: item.key, tools: [item] })
  }
  return out
}

const rendered = computed(() => turns.value.map((turn) => ({ turn, segments: segment(turn.items) })))

function activityState(tools: AgentToolItem[]): AgentToolState {
  if (tools.some((t) => t.state === 'running')) return 'running'
  if (tools.some((t) => t.state === 'error' || t.state === 'denied')) return 'error'
  return 'done'
}

function activityLabel(tools: AgentToolItem[]): string {
  const n = tools.length
  const last = tools[n - 1]
  const current = tools.find((t) => t.state === 'running') ?? last
  return `${n} step${n === 1 ? '' : 's'} · ${current?.summary ?? ''}`
}

function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
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
    `"${page.name}" (pageId: ${page.id}, path: ${page.path})` +
    (node ? `, with the <${node.type}> element ${address} selected.` : '.')
  return { label, prompt }
})

/**
 * The branch the host is respawning onto, by the name the person gave it.
 * `switchingTo` is an id, and "Switching the agent to b1f0c2d3…" is not a
 * sentence anyone can act on.
 */
const switchingLabel = computed(() => {
  const id = switchingTo.value
  if (!id) return null
  if (id === 'main') return 'Main'
  return branches.value.find((b) => b.id === id)?.name ?? 'the draft'
})

/**
 * Main writes are the SERVER's switch (`server/agent-policy.mjs`), and the
 * refusal used to arrive as a 403 on the first save after a conversation's
 * worth of work. The notice says it before the asking does, and puts the
 * control where the refusal is seen — the same `PUT /api/agent-policy` that
 * Settings → MCP → Agent permissions sends, not a second endpoint. An older
 * server does not report the policy at all: `null` stays silent, and the
 * write itself still refuses with its own sentence.
 */
const mainWritesAllowed = ref<boolean | null>(null)
const allowBusy = ref(false)

const mainBlocked = computed(() => onMain.value && mainWritesAllowed.value === false)

watch(
  [isAdmin, onMain],
  () => {
    if (mainWritesAllowed.value !== null) return
    apiJson('/api/agent-policy')
      .then((policy) => (mainWritesAllowed.value = policy?.allowMainWrites === true))
      .catch(() => {
        mainWritesAllowed.value = null
      })
  },
  { immediate: true },
)

async function allowMainWrites() {
  allowBusy.value = true
  try {
    const policy = await apiJson('/api/agent-policy', {
      method: 'PUT',
      body: JSON.stringify({ allowMainWrites: true }),
    })
    mainWritesAllowed.value = policy?.allowMainWrites === true
  } catch (e) {
    notify({
      kind: 'error',
      title: 'Could not change the agent permission',
      detail: e instanceof Error ? e.message : undefined,
      key: 'agent-policy',
    })
  } finally {
    allowBusy.value = false
  }
}

/**
 * Claude Code is not installed, versus it stopped.
 *
 * Panel-first means the button is there before the install is
 * (`useAgentChat.answered`), so this is the first thing a new person reads
 * about the feature and it has to say what to do.
 */
const notInstalled = computed(() =>
  /not installed|not found|could not find/i.test(unavailableReason.value ?? ''),
)

const stepLabel = computed(() => {
  if (step.value) return `${step.value}…`
  if (status.value === 'streaming') return 'Writing…'
  return 'Thinking…'
})

const currentChoice = computed(() => modelChoice(model.value))
const currentLabel = computed(() => modelLabel(model.value))

const canSend = computed(
  () =>
    (!!draft.value.trim() || attachments.value.length > 0) &&
    !busy.value &&
    status.value !== 'unavailable' &&
    status.value !== 'switching',
)

function submit() {
  if (!canSend.value) return
  send(
    draft.value,
    context.value,
    attachments.value.map(({ mediaType, data }) => ({ mediaType, data })),
  )
  draft.value = ''
  attachments.value = []
}

function pickFiles() {
  fileInput.value?.click()
}

function readImage(file: File): Promise<AgentAttachment & { url: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`could not read ${file.name}`))
    reader.onload = () => {
      const url = String(reader.result)
      const data = url.slice(url.indexOf(',') + 1)
      resolve({ mediaType: file.type, data, url })
    }
    reader.readAsDataURL(file)
  })
}

async function onFiles(e: Event) {
  const list = (e.target as HTMLInputElement).files
  if (!list) return
  for (const file of Array.from(list)) {
    if (!file.type.startsWith('image/')) {
      notify({ kind: 'warning', title: `${file.name} is not an image`, detail: 'Only images can be attached for now.', key: 'agent-attach' })
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notify({ kind: 'warning', title: `${file.name} is too large`, detail: 'Images up to 5 MB can be attached.', key: 'agent-attach' })
      continue
    }
    try {
      attachments.value = [...attachments.value, await readImage(file)]
    } catch (err) {
      notify({ kind: 'error', title: 'Could not attach the image', detail: (err as Error).message, key: 'agent-attach' })
    }
  }
  ;(e.target as HTMLInputElement).value = ''
  input.value?.focus()
}

function removeAttachment(index: number) {
  attachments.value = attachments.value.filter((_, i) => i !== index)
}

const tail = computed(() => {
  const turn = turns.value[turns.value.length - 1]
  if (!turn) return ''
  const last = turn.items[turn.items.length - 1]
  const written = last?.kind === 'text' ? last.text.length : 0
  return `${turns.value.length}:${turn.items.length}:${written}:${turn.done}:${step.value ?? ''}`
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
    <div
      v-if="status === 'unavailable' && !notInstalled"
      class="flex items-center gap-1 border-b border-input px-2.5 py-2"
    >
      <span class="min-w-0 flex-1 truncate text-[10px] text-danger" data-agent-status>
        {{ unavailableReason ?? 'The agent stopped' }}
      </span>
      <ButtonUI
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
      class="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 pt-3 pb-3"
    >
      <div
        v-if="status === 'unavailable' && notInstalled"
        data-agent-install
        class="flex flex-col items-start gap-2 rounded-xl border border-input p-2.5 text-[11px] leading-relaxed"
      >
        <p class="text-muted-foreground">
          This panel runs your own Claude Code install — the harness, the sign-in and the bill are
          yours, and nothing here collects a key. To use it:
        </p>
        <ol class="flex list-decimal flex-col gap-1 pl-4 text-muted-foreground">
          <li>
            Install it:
            <code class="rounded bg-input px-1 font-mono text-[10px]">npm install -g @anthropic-ai/claude-code</code>
          </li>
          <li>Run <code class="rounded bg-input px-1 font-mono text-[10px]">claude</code> once in a terminal and sign in.</li>
          <li>Come back and retry.</li>
        </ol>
        <ButtonUI size="xs" :icon="RotateCw" data-agent-retry @click="restart">Retry</ButtonUI>
      </div>

      <div
        v-else-if="mainBlocked"
        data-agent-main-notice
        class="flex flex-col items-start gap-2 rounded-xl border border-input p-2.5 text-[11px] leading-relaxed"
      >
        <p class="font-medium">The AI can't edit Main yet</p>
        <p class="text-muted-foreground">
          <template v-if="isAdmin">
            Edits would land on the live project with no review step, so it is off until you turn
            it on. You can also switch to a draft instead.
          </template>
          <template v-else>
            An admin turns this on under Settings → MCP → Agent permissions. Until then, switch to
            a draft and the agent can work there.
          </template>
        </p>
        <ButtonUI
          v-if="isAdmin"
          size="xs"
          :disabled="allowBusy"
          data-agent-allow-main
          @click="allowMainWrites"
        >
          Allow
        </ButtonUI>
      </div>

      <p
        v-else-if="!turns.length"
        class="px-0.5 py-3 text-[11px] leading-relaxed text-muted-foreground"
      >
        Ask for a change to this page. The agent edits the site through its own tools, and every
        write lands on the canvas as it works.
      </p>

      <div v-for="{ turn, segments } in rendered" :key="turn.id" data-agent-turn class="flex flex-col gap-2.5">
        <div class="flex flex-col items-end gap-1">
          <span v-if="turn.context" class="max-w-full truncate font-mono text-[9px] text-muted-foreground">
            {{ turn.context }}
          </span>
          <div v-if="turn.images.length" class="flex flex-wrap justify-end gap-1">
            <img
              v-for="(url, i) in turn.images"
              :key="i"
              :src="url"
              alt=""
              class="h-14 max-w-full rounded-lg border border-input object-cover"
            />
          </div>
          <p
            v-if="turn.question"
            data-agent-question
            class="max-w-[92%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-primary-foreground transition-opacity"
            :class="turn.sent ? '' : 'opacity-50'"
          >
            {{ turn.question }}
          </p>
        </div>

        <template v-for="seg in segments" :key="seg.key">
          <div
            v-if="seg.kind === 'text'"
            data-agent-text
            class="flex flex-col gap-2 px-0.5 text-[11px] leading-relaxed"
          >
            <template v-for="(block, b) in seg.blocks" :key="b">
              <p v-if="block.kind === 'p'">
                <template v-for="(span, i) in block.spans" :key="i">
                  <strong v-if="span.kind === 'bold'" class="font-medium">{{ span.text }}</strong>
                  <code v-else-if="span.kind === 'code'" class="rounded bg-input px-1 font-mono text-[10px]">{{ span.text }}</code>
                  <template v-else>{{ span.text }}</template>
                </template>
              </p>
              <p v-else-if="block.kind === 'h'" class="font-medium">
                <template v-for="(span, i) in block.spans" :key="i">
                  <code v-if="span.kind === 'code'" class="rounded bg-input px-1 font-mono text-[10px]">{{ span.text }}</code>
                  <template v-else>{{ span.text }}</template>
                </template>
              </p>
              <component
                :is="block.kind === 'ul' ? 'ul' : 'ol'"
                v-else-if="block.kind === 'ul' || block.kind === 'ol'"
                class="flex flex-col gap-0.5 pl-4"
                :class="block.kind === 'ul' ? 'list-disc' : 'list-decimal'"
              >
                <li v-for="(item, j) in block.items" :key="j">
                  <template v-for="(span, i) in item" :key="i">
                    <strong v-if="span.kind === 'bold'" class="font-medium">{{ span.text }}</strong>
                    <code v-else-if="span.kind === 'code'" class="rounded bg-input px-1 font-mono text-[10px]">{{ span.text }}</code>
                    <template v-else>{{ span.text }}</template>
                  </template>
                </li>
              </component>
              <pre
                v-else
                class="custom-scrollbar overflow-x-auto rounded-lg bg-input p-2 font-mono text-[10px] leading-snug whitespace-pre"
              >{{ block.text }}</pre>
            </template>
          </div>

          <div
            v-else
            data-agent-activity
            :data-agent-activity-count="seg.tools.length"
            :data-agent-activity-state="activityState(seg.tools)"
            class="rounded-lg border border-input text-[10px]"
          >
            <button
              type="button"
              class="flex w-full items-center gap-1.5 px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :aria-expanded="expanded.has(seg.key)"
              @click="toggle(seg.key)"
            >
              <component
                :is="TOOL_ICONS[activityState(seg.tools)]"
                class="size-3 shrink-0"
                :class="[TOOL_TONES[activityState(seg.tools)], activityState(seg.tools) === 'running' && 'animate-spin']"
              />
              <span class="min-w-0 flex-1 truncate text-muted-foreground">
                {{ activityLabel(seg.tools) }}
              </span>
              <ChevronRight
                class="size-3 shrink-0 text-muted-foreground transition-transform"
                :class="expanded.has(seg.key) && 'rotate-90'"
              />
            </button>
            <div v-if="expanded.has(seg.key)" class="flex flex-col gap-1.5 border-t border-input px-2 py-1.5">
              <div
                v-for="tool in seg.tools"
                :key="tool.key"
                data-agent-tool
                :data-agent-tool-state="tool.state"
                class="flex flex-col gap-0.5"
              >
                <div class="flex items-center gap-1.5">
                  <component
                    :is="TOOL_ICONS[tool.state]"
                    class="size-3 shrink-0"
                    :class="[TOOL_TONES[tool.state], tool.state === 'running' && 'animate-spin']"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ tool.summary }}</span>
                </div>
                <p v-if="tool.input" class="truncate pl-4.5 font-mono text-[9px] text-muted-foreground">
                  {{ tool.input }}
                </p>
                <p v-if="tool.detail" class="pl-4.5 leading-snug text-danger">{{ tool.detail }}</p>
              </div>
            </div>
          </div>
        </template>

        <p v-if="turn.stopped" class="px-0.5 text-[10px] text-muted-foreground">Stopped.</p>
        <p v-if="turn.error" data-agent-error class="px-0.5 text-[10px] text-danger">
          {{ turn.error }}
        </p>
      </div>
    </div>

    <div
      v-if="status === 'switching'"
      data-agent-switching
      class="flex shrink-0 items-center gap-2 border-t border-input px-2.5 py-1.5 text-[10px] text-muted-foreground"
    >
      <LoaderCircle class="size-3 shrink-0 animate-spin" />
      <span class="min-w-0 flex-1 truncate">
        Switching the agent to {{ switchingLabel }}…
      </span>
    </div>

    <div
      v-else-if="busy"
      data-agent-step
      class="flex shrink-0 items-center gap-2 border-t border-input px-2.5 py-1.5 text-[10px]"
    >
      <span class="relative ml-0.5 flex size-2 shrink-0">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-pending opacity-75" />
        <span class="relative inline-flex size-2 rounded-full bg-pending" />
      </span>
      <span class="min-w-0 flex-1 truncate">{{ stepLabel }}</span>
      <ButtonUI
        variant="icon"
        size="xs"
        :icon="Square"
        tooltip="Stop"
        tooltip-side="right"
        class="w-5 text-muted-foreground"
        data-agent-stop
        @click="interrupt"
      />
    </div>

    <div class="shrink-0 p-2">
      <p v-if="rateLimit" data-agent-ratelimit class="px-0.5 pb-1.5 text-[10px] text-danger">
        {{ rateLimit }}
      </p>
      <div
        class="flex flex-col gap-1.5 rounded-xl border border-input bg-input/50 p-2 transition-colors focus-within:border-accent"
      >
        <div v-if="attachments.length" class="flex flex-wrap gap-1" data-agent-attachments>
          <div v-for="(a, i) in attachments" :key="i" class="relative">
            <img :src="a.url" alt="" class="size-10 rounded-md border border-input object-cover" />
            <button
              type="button"
              aria-label="Remove image"
              class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border border-input bg-background text-muted-foreground"
              @click="removeAttachment(i)"
            >
              <X class="size-2.5" />
            </button>
          </div>
        </div>
        <TextareaUI
          ref="input"
          v-model="draft"
          variant="bare"
          :rows="3"
          :disabled="status === 'switching'"
          placeholder="Ask for a change…"
          data-agent-input
          @keydown.enter.exact.prevent="submit"
        />
        <div class="flex items-center gap-1">
          <span
            v-if="context"
            data-agent-context
            class="min-w-0 flex-1 truncate font-mono text-[9px] text-muted-foreground"
          >
            {{ context.label }}
          </span>
          <span v-else class="flex-1" />
          <ButtonUI
            variant="icon"
            size="xs"
            :icon="Plus"
            tooltip="Add an image"
            class="w-6 text-muted-foreground"
            data-agent-attach
            @click="pickFiles"
          />
          <MenuUI
            side="top"
            align="right"
            width="w-32"
            label="Model"
            :disabled="busy"
            trigger-class="flex h-6 items-center gap-1 rounded-lg px-1.5 text-[10px] text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            data-agent-model
          >
            <template #trigger>
              <span>{{ currentLabel }}</span>
              <ChevronDown class="size-3" />
            </template>
            <template #default="{ close }">
              <button
                v-for="choice in MODEL_CHOICES"
                :key="choice.value"
                type="button"
                class="menu-item"
                :data-agent-model-choice="choice.value"
                @click="setModel(choice.value), close()"
              >
                <Check v-if="choice.value === currentChoice" class="size-3" />
                <span v-else class="size-3" />
                {{ choice.label }}
              </button>
            </template>
          </MenuUI>
          <ButtonUI
            size="xs"
            :icon="ArrowUp"
            :disabled="!canSend"
            aria-label="Send"
            class="size-6 rounded-full !px-0"
            data-agent-send
            @click="submit"
          />
        </div>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        data-agent-file
        @change="onFiles"
      />
    </div>
  </div>
</template>
