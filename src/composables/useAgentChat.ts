import { computed, ref } from 'vue'
import { hostBridge, type HostAgentExit } from '@/lib/hostBridge'
import { uid } from '@/lib/shared/ids'
import { useNotice } from './useNotice'

export type AgentStatus = 'unknown' | 'unavailable' | 'idle' | 'thinking' | 'streaming'
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
  input: string | null
  state: AgentToolState
  detail: string | null
}

export type AgentItem = AgentTextItem | AgentToolItem

export interface AgentTurn {
  id: string
  question: string
  context: string | null
  sent: boolean
  items: AgentItem[]
  done: boolean
  error: string | null
  stopped: boolean
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

let requested = false
let interrupting = false
let blockOwner = 'm0'

export const agentBusy = computed(
  () => status.value === 'thinking' || status.value === 'streaming',
)

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
  patch: { name?: string; input?: string | null; state?: AgentToolState; detail?: string | null },
): void {
  const turn = currentTurn()
  if (!turn) return
  let found = turn.items.find(
    (item): item is AgentToolItem => item.kind === 'tool' && item.key === key,
  )
  if (!found) {
    found = {
      kind: 'tool',
      key,
      name: patch.name ?? 'tool',
      input: null,
      state: 'running',
      detail: null,
    }
    turn.items.push(found)
  }
  if (patch.name !== undefined) found.name = patch.name
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

function openTurn(question: string, context: string | null, sent: boolean): AgentTurn {
  const turn: AgentTurn = {
    id: uid(),
    question,
    context,
    sent,
    items: [],
    done: false,
    error: null,
    stopped: false,
  }
  turns.value = [...turns.value, turn]
  return turn
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
      upsertText(`${blockOwner}:${index}`, '', 'set')
    } else if (kind === 'tool_use') {
      const id = asString(block?.id)
      if (id) upsertTool(id, { name: toolLabel(asString(block?.name) ?? 'tool') })
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
  asList(message.content).forEach((raw, index) => {
    const block = asRecord(raw)
    const kind = asString(block?.type)
    if (kind === 'text') {
      upsertText(`${owner}:${index}`, asString(block?.text) ?? '', 'set')
    } else if (kind === 'tool_use') {
      const id = asString(block?.id)
      if (id) {
        upsertTool(id, {
          name: toolLabel(asString(block?.name) ?? 'tool'),
          input: stringifyInput(block?.input),
        })
      }
    }
  })
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
    if (question) openTurn(question, null, true)
    return
  }

  for (const raw of asList(message.content)) {
    const block = asRecord(raw)
    if (asString(block?.type) !== 'tool_result') continue
    const key = asString(block?.tool_use_id)
    if (!key) continue
    const failed = block?.is_error === true
    upsertTool(key, {
      state: failed ? 'error' : 'done',
      detail: failed ? resultText(block?.content) : null,
    })
  }
}

function ingestResult(event: Record<string, unknown>): void {
  const turn = currentTurn()
  for (const raw of asList(event.permission_denials)) {
    const denial = asRecord(raw)
    const key = asString(denial?.tool_use_id)
    if (!key) continue
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
      status.value = 'unavailable'
      unavailableReason.value = asString(event.reason) ?? 'Claude Code was not found'
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

function restart(): void {
  requested = false
  unavailableReason.value = null
  status.value = 'unknown'
  startAgent()
}

export function useAgentChat() {
  function send(text: string, context?: AgentContext | null): void {
    const body = text.trim()
    if (!body || !available.value) return
    openTurn(body, context?.label ?? null, false)
    status.value = 'thinking'
    interrupting = false
    hostBridge.post({
      type: 'agent-send',
      text: context?.prompt ? `${context.prompt}\n\n${body}` : body,
    })
  }

  function interrupt(): void {
    if (!agentBusy.value) return
    interrupting = true
    hostBridge.post({ type: 'agent-interrupt' })
  }

  return {
    available,
    status,
    busy: agentBusy,
    unavailableReason,
    sessionId,
    model,
    rateLimit,
    turns,
    send,
    interrupt,
    restart,
    ingest,
    exit,
    start: startAgent,
  }
}
