/**
 * Recorded `claude -p --output-format stream-json` line shapes.
 *
 * Captured from a real run (claude 2.1.277, 2026-10-18) and written up in
 * ROADMAP.md §5; only the tool names and the page text are ours. Every field
 * name here is one the CLI actually emits — the point of a fixture is that the
 * reducer is tested against the wire, not against our idea of it.
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

/** A full turn: thinking (empty), one guano tool call that succeeds, then text. */
export const AGENT_TURN: unknown[] = [
  { type: 'system', subtype: 'status', status: 'requesting', session_id: SESSION, uuid: 'u1' },
  {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: { model: 'claude-opus-5', id: MSG_A, type: 'message', role: 'assistant', content: [] },
    },
    session_id: SESSION,
    parent_tool_use_id: null,
    uuid: 'u2',
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    session_id: SESSION,
    uuid: 'u3',
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 50 } },
    session_id: SESSION,
    uuid: 'u4',
  },
  { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, session_id: SESSION, uuid: 'u5' },
  { type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, session_id: SESSION, uuid: 'u6' },
  {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: TOOL_ID, name: 'mcp__guano__set_page_html', input: {}, caller: { type: 'direct' } },
    },
    session_id: SESSION,
    uuid: 'u7',
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '' } },
    session_id: SESSION,
    uuid: 'u8',
  },
  {
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      id: MSG_A,
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'EuQECtAB' },
        { type: 'tool_use', id: TOOL_ID, name: 'mcp__guano__set_page_html', input: { pageId: 'home', html: '<h1>Hello</h1>' } },
      ],
    },
    session_id: SESSION,
    uuid: 'u9',
  },
  { type: 'stream_event', event: { type: 'content_block_stop', index: 1 }, session_id: SESSION, uuid: 'u10' },
  {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: TOOL_ID, is_error: false, content: '{"saved":true}' }],
    },
    session_id: SESSION,
    parent_tool_use_id: null,
    uuid: 'u11',
  },
  {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: { model: 'claude-opus-5', id: MSG_B, type: 'message', role: 'assistant', content: [] },
    },
    session_id: SESSION,
    uuid: 'u12',
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    session_id: SESSION,
    uuid: 'u13',
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The heading ' } },
    session_id: SESSION,
    uuid: 'u14',
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'now reads Hello.' } },
    session_id: SESSION,
    uuid: 'u15',
  },
  {
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      id: MSG_B,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'The heading now reads Hello.' }],
    },
    session_id: SESSION,
    uuid: 'u16',
  },
  {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', resetsAt: 1792335000, rateLimitType: 'five_hour' },
    uuid: 'u17',
    session_id: SESSION,
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'The heading now reads Hello.',
    session_id: SESSION,
    duration_api_ms: 3965,
    total_cost_usd: 0.0125953,
    permission_denials: [],
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
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'I need your permission to write the file.',
    session_id: SESSION,
    permission_denials: [
      { tool_name: 'Write', tool_use_id: 'toolu_denied', tool_input: { file_path: '/Users/someone/Sites/acme/notes.txt', content: 'hi' } },
    ],
  },
]

/** What an answered interrupt leaves behind: an error result with no text. */
export const AGENT_INTERRUPT_RESULT = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  result: '',
  session_id: SESSION,
  permission_denials: [],
}

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
