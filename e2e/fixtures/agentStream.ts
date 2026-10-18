/**
 * Recorded `claude -p --output-format stream-json` line shapes.
 *
 * Captured from real runs (claude 2.1.277, 2026-10-18) and written up in
 * ROADMAP.md §5 / docs/agent-panel.md; only the tool names and the page text
 * are ours. Every field name here is one the CLI actually emits — the point of
 * a fixture is that the reducer is tested against the wire, not against our
 * idea of it.
 *
 * The one shape that matters most, because the first version of this file got
 * it wrong and the test passed on the lie: an `assistant` event carries ONE
 * block, alone at array index 0, even when the stream had put it at index 1
 * after a thinking block. Keying text by array index rendered every paragraph
 * twice.
 */

const SESSION = 'd448f213-c3fd-4d49-b3d7-9bae972ce311'
const MSG_A = 'msg_011Cg9kbS9vVoTtmc5YZv3fS'
const MSG_B = 'msg_011Cg9kbS9vVoTtmc5YZv3fT'
const TOOL_ID = 'toolu_01WtgfSpSvnCa5G8UbjUEwKX'

export const AGENT_READY = {
  type: 'ready',
  sessionId: SESSION,
}

export const AGENT_INIT = {
  type: 'system',
  subtype: 'init',
  cwd: '/Users/someone/Sites/acme',
  session_id: SESSION,
  tools: ['mcp__guano__get_page', 'mcp__guano__set_page_html'],
  mcp_servers: [{ name: 'guano', status: 'connected' }],
  model: 'claude-opus-5',
  permissionMode: 'dontAsk',
}

/** What `set_model` is followed by: a fresh init naming the new model. */
export const AGENT_INIT_SONNET = { ...AGENT_INIT, model: 'claude-sonnet-5' }

/** The question we sent, echoed back by `--replay-user-messages`. */
export const agentReplay = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
  session_id: SESSION,
  parent_tool_use_id: null,
  uuid: '1bb53c7a-e513-4ba8-83e7-3e408e8c6235',
  timestamp: '2026-10-18T13:06:18.467Z',
  isReplay: true,
})

const messageStart = (id: string, uuid: string) => ({
  type: 'stream_event',
  event: {
    type: 'message_start',
    message: { model: 'claude-opus-5', id, type: 'message', role: 'assistant', content: [] },
  },
  session_id: SESSION,
  parent_tool_use_id: null,
  uuid,
})

const thinkingBlock = (index: number, uuid: string) => [
  {
    type: 'stream_event',
    event: { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
    session_id: SESSION,
    uuid: `${uuid}a`,
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 50 } },
    session_id: SESSION,
    uuid: `${uuid}b`,
  },
  { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, session_id: SESSION, uuid: `${uuid}c` },
  { type: 'stream_event', event: { type: 'content_block_stop', index }, session_id: SESSION, uuid: `${uuid}d` },
]

/**
 * One tool call as the wire has it: the block starts with its name and an
 * empty input, the input streams, the consolidated `assistant` event carries
 * the call ALONE, then the result comes back as a `user` line.
 */
export const agentToolCall = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  messageId: string,
  index: number,
  result: { is_error?: boolean; content?: string } = {},
): unknown[] => [
  {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {}, caller: { type: 'direct' } },
    },
    session_id: SESSION,
    uuid: `${id}-start`,
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '' } },
    session_id: SESSION,
    uuid: `${id}-delta`,
  },
  {
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
    session_id: SESSION,
    uuid: `${id}-assistant`,
  },
  { type: 'stream_event', event: { type: 'content_block_stop', index }, session_id: SESSION, uuid: `${id}-stop` },
  {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, is_error: result.is_error ?? false, content: result.content ?? '{"ok":true}' }],
    },
    session_id: SESSION,
    parent_tool_use_id: null,
    uuid: `${id}-result`,
  },
]

/** A text block streamed, then consolidated ALONE — the shape that doubled. */
const textBlock = (messageId: string, index: number, parts: string[], uuid: string): unknown[] => [
  {
    type: 'stream_event',
    event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
    session_id: SESSION,
    uuid: `${uuid}-start`,
  },
  ...parts.map((text, i) => ({
    type: 'stream_event',
    event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
    session_id: SESSION,
    uuid: `${uuid}-delta-${i}`,
  })),
  {
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: parts.join('') }],
    },
    session_id: SESSION,
    uuid: `${uuid}-assistant`,
  },
  { type: 'stream_event', event: { type: 'content_block_stop', index }, session_id: SESSION, uuid: `${uuid}-stop` },
]

export const agentResult = (overrides: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  session_id: SESSION,
  duration_api_ms: 3965,
  total_cost_usd: 0.0125953,
  permission_denials: [],
  ...overrides,
})

/**
 * A full turn: thinking (empty), one guano tool call that succeeds, a second
 * message with thinking at index 0 and the answer at index 1 — consolidated
 * alone at array index 0, which is the doubling shape.
 */
export const AGENT_TURN: unknown[] = [
  { type: 'system', subtype: 'status', status: 'requesting', session_id: SESSION, uuid: 'u1' },
  messageStart(MSG_A, 'u2'),
  ...thinkingBlock(0, 'u3'),
  {
    type: 'assistant',
    message: { model: 'claude-opus-5', id: MSG_A, type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'EuQECtAB' }] },
    session_id: SESSION,
    uuid: 'u4',
  },
  ...agentToolCall(TOOL_ID, 'mcp__guano__set_page_html', { pageId: 'home', html: '<h1>Hello</h1>' }, MSG_A, 1, { content: '{"saved":true}' }),
  messageStart(MSG_B, 'u12'),
  ...thinkingBlock(0, 'u13'),
  {
    type: 'assistant',
    message: { model: 'claude-opus-5', id: MSG_B, type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'EuQECtAB' }] },
    session_id: SESSION,
    uuid: 'u14',
  },
  ...textBlock(MSG_B, 1, ['The heading ', 'now reads Hello.'], 'u15'),
  {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', resetsAt: 1792335000, rateLimitType: 'five_hour' },
    uuid: 'u17',
    session_id: SESSION,
  },
  agentResult({ result: 'The heading now reads Hello.' }),
]

/** Three tool calls back to back, with a sentence on either side. */
export const AGENT_BUSY_TURN: unknown[] = [
  { type: 'system', subtype: 'status', status: 'requesting', session_id: SESSION, uuid: 'b1' },
  messageStart('msg_busy_1', 'b2'),
  ...textBlock('msg_busy_1', 0, ['Let me get oriented first.'], 'b3'),
  ...agentToolCall('toolu_b1', 'mcp__guano__get_guide', { section: 'page-html' }, 'msg_busy_1', 1),
  messageStart('msg_busy_2', 'b4'),
  ...agentToolCall('toolu_b2', 'mcp__guano__get_guide', { section: 'styling' }, 'msg_busy_2', 0),
  messageStart('msg_busy_3', 'b5'),
  ...agentToolCall('toolu_b3', 'mcp__guano__list_pages', {}, 'msg_busy_3', 0),
  messageStart('msg_busy_4', 'b6'),
  ...textBlock('msg_busy_4', 0, ['Main is empty, so I will start from scratch.'], 'b7'),
  agentResult(),
]

/** A tool call that has started and not yet answered. */
export const AGENT_STEP_IN_FLIGHT: unknown[] = [
  { type: 'system', subtype: 'status', status: 'requesting', session_id: SESSION, uuid: 's1' },
  messageStart('msg_step', 's2'),
  {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_step', name: 'mcp__guano__get_guide', input: {}, caller: { type: 'direct' } },
    },
    session_id: SESSION,
    uuid: 's3',
  },
  {
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      id: 'msg_step',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_step', name: 'mcp__guano__get_guide', input: { section: 'styling' } }],
    },
    session_id: SESSION,
    uuid: 's4',
  },
]

/** A tool outside `--allowedTools`: denied live, then summarised on the result. */
export const AGENT_DENIAL: unknown[] = [
  {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_denied', name: 'Write', input: {} },
    },
    session_id: SESSION,
    uuid: 'd1',
  },
  {
    type: 'system',
    subtype: 'permission_denied',
    tool_name: 'Write',
    tool_use_id: 'toolu_denied',
    message: 'Claude requested permissions to write to /Users/someone/Sites/acme/notes.txt, but you haven’t granted it yet.',
    uuid: 'd2',
    session_id: SESSION,
  },
  agentResult({
    result: 'I need your permission to write the file.',
    permission_denials: [
      { tool_name: 'Write', tool_use_id: 'toolu_denied', tool_input: { file_path: '/Users/someone/Sites/acme/notes.txt', content: 'hi' } },
    ],
  }),
]

/** What an answered interrupt leaves behind: an error result with no text. */
export const AGENT_INTERRUPT_RESULT = agentResult({
  subtype: 'error_during_execution',
  is_error: true,
  result: '',
})

export const AGENT_RATE_LIMITED = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'rejected',
    overageStatus: 'rejected',
    overageDisabledReason: 'out_of_credits',
    resetsAt: 1792335000,
  },
  uuid: 'r1',
  session_id: SESSION,
}
