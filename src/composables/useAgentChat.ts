import { computed, ref } from 'vue'
import { hostBridge, type HostAgentExit, type HostAgentImage } from '@/lib/hostBridge'
import { uid } from '@/lib/shared/ids'
import { describeTool, HARNESS_TOOLS } from '@/lib/agentLabels'
import { useNotice } from './useNotice'

export type AgentStatus =
  | 'unknown'
  | 'unavailable'
  | 'switching'
  | 'idle'
  | 'thinking'
  | 'streaming'
export type AgentToolState = 'running' | 'done' | 'error' | 'denied'

export interface AgentTextItem {
  kind: 'text'
  key: string
  text: string
}

export interface AgentToolItem {
  kind: 'tool'
  key: string
  name: string
  summary: string
  input: string | null
  state: AgentToolState
  detail: string | null
}

export type AgentItem = AgentTextItem | AgentToolItem

export interface AgentTurn {
  id: string
  question: string
  context: string | null
  images: string[]
  sent: boolean
  items: AgentItem[]
  done: boolean
  error: string | null
  stopped: boolean
}

export interface AgentAttachment {
  mediaType: string
  data: string
}

export interface AgentContext {
  label: string
  prompt: string
}

const INPUT_CAP = 300

const available = ref(false)
const status = ref<AgentStatus>('unknown')
const unavailableReason = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const model = ref<string | null>(null)
const rateLimit = ref<string | null>(null)
const turns = ref<AgentTurn[]>([])
/**
 * Has the host answered AT ALL — `ready` or `unavailable`?
 *
 * The rail button renders on THIS, not on `available`. Panel-first means a
 * person with no Claude Code install has to be able to find the feature and
 * read how to get it; hiding the button left the whole thing undiscoverable
 * on exactly the machines that needed the instructions. It is still the
 * ANSWER and never `host === 'launcher'` (two recorded bugs, `docs/ui.md`), so
 * a browser — where nothing answers — still has no button.
 */
const answered = ref(false)
/** which branch the host is respawning onto, while `status === 'switching'` */
const switchingTo = ref<string | null>(null)

let requested = false
/** the host has seen our `agent-target` since the last `ready` */
let targetAcknowledged = false
let interrupting = false
let blockOwner = 'm0'
let openText: { owner: string; key: string } | null = null
let consolidated = 0
/** tool_use ids the transcript is deliberately not showing — see HARNESS_TOOLS */
let hiddenTools = new Set<string>()

export const agentBusy = computed(
  () => status.value === 'thinking' || status.value === 'streaming',
)

export const agentStep = computed<string | null>(() => {
  const turn = turns.value[turns.value.length - 1]
  if (!turn || turn.done) return null
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const item = turn.items[i]
    if (item?.kind === 'tool' && item.state === 'running') return item.summary
  }
  return null
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function currentTurn(): AgentTurn | null {
  const last = turns.value[turns.value.length - 1]
  return last && !last.done ? last : null
}

function upsertText(key: string, text: string, mode: 'append' | 'set'): void {
  const turn = currentTurn()
  if (!turn) return
  const found = turn.items.find(
    (item): item is AgentTextItem => item.kind === 'text' && item.key === key,
  )
  if (!found) {
    turn.items.push({ kind: 'text', key, text })
    return
  }
  found.text = mode === 'append' ? found.text + text : text
}

function upsertTool(
  key: string,
  patch: {
    name?: string
    summary?: string
    input?: string | null
    state?: AgentToolState
    detail?: string | null
  },
): void {
  const turn = currentTurn()
  if (!turn) return
  let found = turn.items.find(
    (item): item is AgentToolItem => item.kind === 'tool' && item.key === key,
  )
  if (!found) {
    const name = patch.name ?? 'tool'
    found = {
      kind: 'tool',
      key,
      name,
      summary: patch.summary ?? describeTool(name, null),
      input: null,
      state: 'running',
      detail: null,
    }
    turn.items.push(found)
  }
  if (patch.name !== undefined) found.name = patch.name
  if (patch.summary !== undefined) found.summary = patch.summary
  if (patch.input !== undefined) found.input = patch.input
  if (patch.state !== undefined) found.state = patch.state
  if (patch.detail !== undefined) found.detail = patch.detail
}

function toolLabel(name: string): string {
  return name.startsWith('mcp__guano__') ? name.slice('mcp__guano__'.length) : name
}

function stringifyInput(value: unknown): string | null {
  const record = asRecord(value)
  if (!record || !Object.keys(record).length) return null
  let text: string
  try {
    text = JSON.stringify(record)
  } catch {
    return null
  }
  return text.length > INPUT_CAP ? `${text.slice(0, INPUT_CAP)}…` : text
}

function resultText(content: unknown): string | null {
  const direct = asString(content)
  if (direct) return direct.slice(0, INPUT_CAP)
  for (const block of asList(content)) {
    const text = asString(asRecord(block)?.text)
    if (text) return text.slice(0, INPUT_CAP)
  }
  return null
}

function openTurn(
  question: string,
  context: string | null,
  images: string[],
  sent: boolean,
): AgentTurn {
  const turn: AgentTurn = {
    id: uid(),
    question,
    context,
    images,
    sent,
    items: [],
    done: false,
    error: null,
    stopped: false,
  }
  turns.value = [...turns.value, turn]
  return turn
}

function imageUrls(content: unknown): string[] {
  const out: string[] = []
  for (const block of asList(content)) {
    const record = asRecord(block)
    if (asString(record?.type) !== 'image') continue
    const source = asRecord(record?.source)
    const type = asString(source?.media_type)
    const data = asString(source?.data)
    if (type && data) out.push(`data:${type};base64,${data}`)
  }
  return out
}

function ingestSystem(event: Record<string, unknown>): void {
  switch (asString(event.subtype)) {
    case 'init': {
      available.value = true
      unavailableReason.value = null
      sessionId.value = asString(event.session_id) ?? sessionId.value
      model.value = asString(event.model) ?? model.value
      if (status.value === 'unknown' || status.value === 'unavailable') status.value = 'idle'
      return
    }
    case 'status': {
      if (asString(event.status) === 'requesting' && currentTurn()) status.value = 'thinking'
      return
    }
    case 'thinking_tokens': {
      if (currentTurn() && status.value === 'idle') status.value = 'thinking'
      return
    }
    case 'permission_denied': {
      const key = asString(event.tool_use_id)
      const name = asString(event.tool_name) ?? 'tool'
      if (!key) return
      hiddenTools.delete(key) // a denial is never hidden, harness tool or not
      upsertTool(key, {
        name: toolLabel(name),
        state: 'denied',
        detail: asString(event.message) ?? 'not allowed',
      })
      return
    }
  }
}

function ingestStreamEvent(event: Record<string, unknown>): void {
  const inner = asRecord(event.event)
  if (!inner) return
  const index = typeof inner.index === 'number' ? inner.index : 0

  if (asString(inner.type) === 'message_start') {
    const id = asString(asRecord(inner.message)?.id)
    if (id) blockOwner = id
    return
  }

  if (asString(inner.type) === 'content_block_start') {
    const block = asRecord(inner.content_block)
    const kind = asString(block?.type)
    if (kind === 'text') {
      const key = `${blockOwner}:${index}`
      openText = { owner: blockOwner, key }
      upsertText(key, '', 'set')
    } else if (kind === 'tool_use') {
      const id = asString(block?.id)
      const name = toolLabel(asString(block?.name) ?? 'tool')
      if (!id) return
      if (HARNESS_TOOLS.has(name)) {
        hiddenTools.add(id)
        return
      }
      upsertTool(id, { name, summary: describeTool(name, null) })
    }
    return
  }

  if (asString(inner.type) === 'content_block_delta') {
    const delta = asRecord(inner.delta)
    if (asString(delta?.type) !== 'text_delta') return
    const text = asString(delta?.text)
    if (!text) return
    upsertText(`${blockOwner}:${index}`, text, 'append')
    status.value = 'streaming'
  }
}

function ingestAssistant(event: Record<string, unknown>): void {
  const message = asRecord(event.message)
  if (!message) return
  const owner = asString(message.id) ?? blockOwner
  blockOwner = owner
  for (const raw of asList(message.content)) {
    const block = asRecord(raw)
    const kind = asString(block?.type)
    if (kind === 'text') {
      const text = asString(block?.text) ?? ''
      if (openText && openText.owner === owner) {
        upsertText(openText.key, text, 'set')
        openText = null
      } else if (text) {
        upsertText(`${owner}:c${consolidated++}`, text, 'set')
      }
    } else if (kind === 'tool_use') {
      const id = asString(block?.id)
      if (id) {
        const name = toolLabel(asString(block?.name) ?? 'tool')
        if (HARNESS_TOOLS.has(name)) {
          hiddenTools.add(id)
          continue
        }
        upsertTool(id, {
          name,
          summary: describeTool(name, block?.input),
          input: stringifyInput(block?.input),
        })
      }
    }
  }
}

function ingestUser(event: Record<string, unknown>): void {
  const message = asRecord(event.message)
  if (!message) return

  if (event.isReplay === true) {
    const turn = currentTurn()
    if (turn && !turn.sent) {
      turn.sent = true
      return
    }
    const question = resultText(message.content)
    if (question) openTurn(question, null, imageUrls(message.content), true)
    return
  }

  for (const raw of asList(message.content)) {
    const block = asRecord(raw)
    if (asString(block?.type) !== 'tool_result') continue
    const key = asString(block?.tool_use_id)
    if (!key) continue
    if (hiddenTools.has(key)) continue
    const failed = block?.is_error === true
    upsertTool(key, {
      state: failed ? 'error' : 'done',
      detail: failed ? resultText(block?.content) : null,
    })
  }
}

function ingestResult(event: Record<string, unknown>): void {
  const turn = currentTurn()
  openText = null
  for (const raw of asList(event.permission_denials)) {
    const denial = asRecord(raw)
    const key = asString(denial?.tool_use_id)
    if (!key) continue
    hiddenTools.delete(key)
    const named = turn?.items.find(
      (item): item is AgentToolItem => item.kind === 'tool' && item.key === key,
    )
    upsertTool(key, {
      name: toolLabel(asString(denial?.tool_name) ?? 'tool'),
      state: 'denied',
      detail: named?.detail ?? 'not allowed in this panel',
    })
  }
  if (turn) {
    turn.done = true
    turn.sent = true
    if (event.is_error === true) {
      if (interrupting) turn.stopped = true
      else turn.error = asString(event.result) || 'the turn failed'
    }
  }
  interrupting = false
  hiddenTools = new Set()
  status.value = 'idle'
}

function ingestRateLimit(event: Record<string, unknown>): void {
  const info = asRecord(event.rate_limit_info)
  if (!info || asString(info.status) === 'allowed') {
    rateLimit.value = null
    return
  }
  const reason = asString(info.overageDisabledReason)
  rateLimit.value = reason ? `usage limit reached (${reason})` : 'usage limit reached'
}

/** @param raw one line of the host's JSONL stream, or a synthetic `ready`/`unavailable` */
function ingest(raw: unknown): void {
  const event = asRecord(raw)
  if (!event) return

  switch (asString(event.type)) {
    case 'ready': {
      available.value = true
      answered.value = true
      switchingTo.value = null
      targetAcknowledged = false
      unavailableReason.value = null
      sessionId.value = asString(event.sessionId) ?? sessionId.value
      status.value = 'idle'
      const replay = asList(event.replay)
      for (const line of replay) ingest(line)
      if (!currentTurn()) status.value = 'idle'
      return
    }
    case 'unavailable': {
      available.value = false
      answered.value = true
      status.value = 'unavailable'
      unavailableReason.value = asString(event.reason) ?? 'Claude Code was not found'
      return
    }
    // The branch the editor has open changed, so the host is respawning the
    // agent against a config written for it. The composer waits; the next
    // `ready` ends it.
    case 'switching': {
      status.value = 'switching'
      switchingTo.value = asString(event.target) ?? null
      return
    }
    case 'system':
      return ingestSystem(event)
    case 'stream_event':
      return ingestStreamEvent(event)
    case 'assistant':
      return ingestAssistant(event)
    case 'user':
      return ingestUser(event)
    case 'rate_limit_event':
      return ingestRateLimit(event)
    case 'result':
      return ingestResult(event)
  }
}

function exit(info?: HostAgentExit): void {
  requested = false
  targetAcknowledged = false
  const turn = currentTurn()
  if (turn) {
    turn.done = true
    if (!turn.stopped && !turn.error) turn.error = info?.reason || 'the agent stopped'
  }
  status.value = 'unavailable'
  const code = typeof info?.code === 'number' ? ` (code ${info.code})` : ''
  unavailableReason.value = info?.reason || `the agent exited${code}`
  useNotice().notify({
    kind: 'error',
    title: 'The AI agent stopped',
    detail: unavailableReason.value ?? undefined,
    key: 'agent-exit',
  })
}

export function startAgent(): void {
  if (requested || !hostBridge.available) return
  requested = true
  hostBridge.post({ type: 'agent-start' })
}

/**
 * Which branch the editor has loaded, for the host's `guano connect --target`.
 *
 * The host WAITS for this before it spawns, and never substitutes a default:
 * an agent in the panel does not pick a target, so a lost message has to look
 * like the bug it is rather than quietly become Main. Posted after
 * `agent-start` at boot, on every branch switch, and again on a `ready` that
 * has not seen one — a reload replays `agent-start` and the target must
 * follow it.
 */
export function postAgentTarget(target: string): void {
  if (!hostBridge.available || !target) return
  targetAcknowledged = true
  hostBridge.post({ type: 'agent-target', target })
}

/** has the host been told the target since the last `ready`? */
export const agentTargetPosted = () => targetAcknowledged

function restart(): void {
  requested = false
  targetAcknowledged = false
  unavailableReason.value = null
  status.value = 'unknown'
  startAgent()
}

export function useAgentChat() {
  function send(
    text: string,
    context?: AgentContext | null,
    attachments: AgentAttachment[] = [],
  ): void {
    const body = text.trim()
    if ((!body && !attachments.length) || !available.value) return
    openTurn(
      body || `${attachments.length} image${attachments.length === 1 ? '' : 's'}`,
      context?.label ?? null,
      attachments.map((a) => `data:${a.mediaType};base64,${a.data}`),
      false,
    )
    status.value = 'thinking'
    interrupting = false
    const images: HostAgentImage[] = attachments.map((a) => ({
      mediaType: a.mediaType,
      data: a.data,
    }))
    hostBridge.post({
      type: 'agent-send',
      text: context?.prompt ? `${context.prompt}\n\n${body}` : body,
      ...(images.length ? { images } : {}),
    })
  }

  function setModel(choice: string): void {
    if (!available.value || agentBusy.value) return
    hostBridge.post({ type: 'agent-model', model: choice })
  }

  function interrupt(): void {
    if (!agentBusy.value) return
    interrupting = true
    hostBridge.post({ type: 'agent-interrupt' })
  }

  return {
    available,
    answered,
    switchingTo,
    status,
    busy: agentBusy,
    step: agentStep,
    unavailableReason,
    sessionId,
    model,
    rateLimit,
    turns,
    send,
    setModel,
    interrupt,
    restart,
    ingest,
    exit,
    start: startAgent,
  }
}
