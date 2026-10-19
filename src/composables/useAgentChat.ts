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

export interface AgentSuggestion {
  label: string
  /** what a click sends, verbatim, as the person's next message */
  prompt: string
}

/**
 * A `suggest_next` call, rendered as chips rather than as a step.
 *
 * It is CONVERSATION, not work: it neither joins the activity bubble nor
 * counts towards it. The server's handler is inert — the input this is built
 * from is the whole of the tool call — and a pick is the next user message,
 * because `claude -p` has no way to block on a person.
 *
 * It is also how a choice the agent made on its own gets corrected, which is
 * what lets it build without asking first (GUIDE.md, **Build first**).
 */
export interface AgentSuggestItem {
  kind: 'suggest'
  key: string
  suggestions: AgentSuggestion[]
  picked: string | null
}

export type AgentItem = AgentTextItem | AgentToolItem | AgentSuggestItem

/** the one tool the panel renders as conversation — see AgentSuggestItem */
const PROMPT_TOOLS = new Set(['suggest_next'])

/** the `result` line's cache figures, kept so step 4's premise can be checked */
export interface AgentUsage {
  inputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

/**
 * What the turn cost, in wall clock and in round-trips.
 *
 * Rendered under a finished turn and never behind a flag: a person who finds
 * the panel slow has to be able to say by how much, and the call counts are
 * the half that says WHY — orientation the handbook asked for, or harness
 * bookkeeping nobody chose.
 *
 * `sentAt` is null for a turn built by a transcript REPLAY (a reload, or
 * reopening the project): those lines arrive all at once and any duration
 * taken from them is a lie, so the meta line is not drawn for them.
 */
export interface AgentTurnTimings {
  sentAt: number | null
  firstTextAt: number | null
  doneAt: number | null
  /** `agent-start` → `ready`, carried by the first turn of a spawn only */
  bootMs: number | null
  calls: number
  guideCalls: number
  harnessCalls: number
  usage: AgentUsage | null
}

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
  timings: AgentTurnTimings
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
 * `{type:'switching', target}`: the branch the editor has open changed and the
 * host is respawning the agent against a config written for it. The composer
 * waits; the next `ready` ends it.
 *
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
/**
 * Something the HOST did to this session, said plainly at the top of the
 * transcript — today only *"Started a new conversation; the last one was
 * long."*
 *
 * It arrives in the `ready`'s replay, so it keeps its place and survives a
 * reload. A panel that silently forgot a conversation is indistinguishable
 * from one that is broken, which is the whole reason the line exists.
 */
const notice = ref<string | null>(null)
/**
 * Bumped on every `ready`. The target has to be re-posted after one — a
 * reload replays `agent-start` and the host dropped what it knew with the
 * page that told it — and a `ready` does not always move `status`, so this is
 * the thing to watch rather than the status.
 */
const readyTick = ref(0)

/**
 * The spawn chain, as the page can see it: `agent-start` posted, `ready`
 * back, `system/init` read. The launcher logs the same milestones from its
 * side with the steps in between (`docs/agent-panel.md`, Startup cost).
 */
const timings = ref<{ startedAt: number | null; readyAt: number | null; initAt: number | null }>({
  startedAt: null,
  readyAt: null,
  initAt: null,
})

let requested = false
/**
 * How long the spawn chain took, waiting for the first turn that follows it.
 *
 * **The HOST measures this, not the page**, and two bad numbers came of
 * trying it the other way round. Timing to `ready` reported *0.8s to start*
 * for a spawn whose `system/init` the launcher logged 35 s later, because
 * `ready` is emitted when `claude` is spawned and not when it answers.
 * Timing to `system/init` from the page then reported nothing at all: the
 * page sees neither end of the chain dependably — the host starts the clock
 * when `agent-start` ARRIVES, and a page that reloaded mid-chain has no
 * start of its own to subtract from.
 *
 * So the host sends `{type:'boot', ms}` once its own milestones have it, and
 * this is only where that lands.
 */
let pendingBoot: number | null = null
/** tool_use ids already counted, so the stream and the `assistant` echo agree */
let countedTools = new Set<string>()
/** the host has seen our `agent-target` since the last `ready` */
let targetAcknowledged = false
let interrupting = false
let blockOwner = 'm0'
let openText: { owner: string; key: string } | null = null
let consolidated = 0
/** tool_use ids the transcript is deliberately not showing — see HARNESS_TOOLS */
let hiddenTools = new Set<string>()
/**
 * tool_use ids that became a `suggest` item instead of a tool row.
 *
 * Registered at `content_block_start`, BEFORE anything can call `upsertTool`
 * with them: the start event carries the name, and one that reaches
 * `upsertTool` once lands in the activity bubble as a step and stays there.
 * Their `tool_result` is then consumed in silence.
 */
let promptTools = new Set<string>()

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

/**
 * Build the `suggest` item from a `tool_use` input, or nothing.
 *
 * The server validated the shape, but this reads a model's output over a
 * channel the server's refusal does not gate (a denied call still streams its
 * start event), so every field is checked again and a call that carries
 * nothing renderable is dropped rather than drawn empty.
 */
function upsertPrompt(key: string, input: unknown): void {
  const turn = currentTurn()
  if (!turn) return
  const record = asRecord(input)
  if (!record) return
  if (turn.items.some((item) => item.key === key)) return

  const suggestions: AgentSuggestion[] = []
  for (const raw of asList(record.suggestions)) {
    const s = asRecord(raw)
    const label = asString(s?.label)?.trim()
    const prompt = asString(s?.prompt)?.trim()
    if (!label || !prompt) continue
    suggestions.push({ label, prompt })
  }
  if (!suggestions.length) return
  turn.items.push({ kind: 'suggest', key, suggestions, picked: null })
}

/** a denied suggestion is a denied tool row — a denial is never hidden */
function unhidePrompt(key: string): void {
  if (!promptTools.delete(key)) return
  const turn = turns.value[turns.value.length - 1]
  if (turn) turn.items = turn.items.filter((item) => item.key !== key)
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

/**
 * `sent` is true only when a transcript REPLAY built this turn, which is also
 * what makes it untimed: those lines arrive in one burst and a duration taken
 * from them would read as a fast turn rather than as a replayed one.
 */
function openTurn(
  question: string,
  context: string | null,
  images: string[],
  sent: boolean,
): AgentTurn {
  const timed = !sent
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
    timings: {
      sentAt: timed ? Date.now() : null,
      firstTextAt: null,
      doneAt: null,
      bootMs: timed ? pendingBoot : null,
      calls: 0,
      guideCalls: 0,
      harnessCalls: 0,
      usage: null,
    },
  }
  if (timed) pendingBoot = null
  turns.value = [...turns.value, turn]
  return turn
}

/** every `tool_use`, once, whether or not the transcript shows it as a step */
function countCall(id: string, name: string): void {
  const turn = currentTurn()
  if (!turn || countedTools.has(id)) return
  countedTools.add(id)
  turn.timings.calls++
  if (HARNESS_TOOLS.has(name)) turn.timings.harnessCalls++
  else if (name === 'get_guide') turn.timings.guideCalls++
}

function markFirstText(): void {
  const turn = currentTurn()
  if (turn && turn.timings.firstTextAt === null) turn.timings.firstTextAt = Date.now()
}

function readUsage(value: unknown): AgentUsage | null {
  const usage = asRecord(value)
  if (!usage) return null
  const num = (key: string): number => (typeof usage[key] === 'number' ? usage[key] : 0)
  return {
    inputTokens: num('input_tokens'),
    cacheReadInputTokens: num('cache_read_input_tokens'),
    cacheCreationInputTokens: num('cache_creation_input_tokens'),
  }
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
      timings.value.initAt = Date.now()
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
      unhidePrompt(key)
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
      countCall(id, name)
      // registered HERE, before upsertTool can be reached with this id: the
      // start event already names the tool, and an ask opened as a tool row
      // once is a step in the activity bubble for the rest of the turn
      if (PROMPT_TOOLS.has(name)) {
        promptTools.add(id)
        return
      }
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
    markFirstText()
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
      if (text) markFirstText()
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
        countCall(id, name)
        // the `assistant` event is the authority for a tool_use's INPUT, which
        // for these two is the whole of the call: the questions, or the offers
        if (PROMPT_TOOLS.has(name)) {
          promptTools.add(id)
          upsertPrompt(id, block?.input)
          continue
        }
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
    if (promptTools.has(key)) continue // the echo of an inert tool, silently
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
    unhidePrompt(key)
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
    turn.timings.doneAt = Date.now()
    turn.timings.usage = readUsage(event.usage)
    if (event.is_error === true) {
      if (interrupting) turn.stopped = true
      else turn.error = asString(event.result) || 'the turn failed'
    }
  }
  interrupting = false
  hiddenTools = new Set()
  promptTools = new Set()
  countedTools = new Set()
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
      const readyAt = Date.now()
      // cleared BEFORE the replay, which is where a notice for this spawn is
      notice.value = null
      available.value = true
      answered.value = true
      switchingTo.value = null
      targetAcknowledged = false
      readyTick.value++
      unavailableReason.value = null
      sessionId.value = asString(event.sessionId) ?? sessionId.value
      status.value = 'idle'
      const replay = asList(event.replay)
      for (const line of replay) ingest(line)
      if (!currentTurn()) status.value = 'idle'
      timings.value.readyAt = readyAt
      return
    }
    case 'boot': {
      // the host's own `agent-start` → `system/init`, which is the only
      // place that measurement can honestly be made
      const ms = event.ms
      if (typeof ms === 'number' && ms >= 0) pendingBoot = ms
      return
    }
    case 'notice': {
      notice.value = asString(event.text)
      return
    }
    case 'unavailable': {
      available.value = false
      answered.value = true
      status.value = 'unavailable'
      unavailableReason.value = asString(event.reason) ?? 'Claude Code was not found'
      return
    }
    case 'switching': {
      timings.value = { startedAt: Date.now(), readyAt: null, initAt: null }
      pendingBoot = null
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
  timings.value = { startedAt: Date.now(), readyAt: null, initAt: null }
  pendingBoot = null
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
    readyTick,
    status,
    busy: agentBusy,
    step: agentStep,
    unavailableReason,
    sessionId,
    model,
    rateLimit,
    notice,
    turns,
    timings,
    send,
    setModel,
    interrupt,
    restart,
    ingest,
    exit,
    start: startAgent,
  }
}
