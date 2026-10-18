# The AI panel: a Claude Code session inside the canvas

<!-- Read this before touching src/composables/useAgentChat.ts, AgentDock.vue
     or the agent half of src/lib/hostBridge.ts. The forward-looking plan,
     the options weighed and the launcher's half are ROADMAP.md §5. -->

## What it is, and what of it exists

A chat panel in the canvas's bottom-left corner, beside the ⌘E insert dock. The
person types next to the page they are looking at; an agent edits the site
through the same MCP toolset any other client gets, and the canvas follows it
live.

**The model client is the person's own Claude Code install.** The launcher
spawns `claude -p` with JSONL on both pipes and forwards the stream to the page;
the harness, the authentication and the bill are all theirs. Nothing in this
repo talks to a model, and no API key is ever collected. The three alternatives
(the Agent SDK, our own loop) and why they lost are in ROADMAP §5.

**Shipped: the builder half.** The bridge protocol, the reducer and the panel,
tested against a recorded transcript through a faked host. **Not shipped: the
launcher half** — nothing spawns `claude` yet, so in a browser, and under
today's launcher, `available` stays false and *there is no button*. That is the
designed state, not a missing feature.

## The bridge is one contract with the launcher

`src/lib/hostBridge.ts`, over the `guano` `WKScriptMessageHandler` and
`window.__guanoHost` — the same channel that already carries save status and the
reauth round-trip (→ `docs/ui.md`, The two rails).

| page → host | the host's job |
|---|---|
| `{type:'agent-start'}` | spawn or resume, then answer `ready` or `unavailable` |
| `{type:'agent-send', text}` | one `{"type":"user","message":{"role":"user","content":text}}` line on stdin |
| `{type:'agent-interrupt'}` | the interrupt control request (below) |
| `{type:'agent-stop'}` | SIGTERM; keep the session id for a resume |

| host → page | |
|---|---|
| `__guanoHost.agentEvent(obj)` | one parsed JSONL line, or a synthetic `ready` / `unavailable` |
| `__guanoHost.agentExit({code, reason})` | the process is gone |

`{type:'ready', sessionId, replay?: []}` may carry every line the host has
streamed so far; `{type:'unavailable', reason}` is how "Claude Code is not
installed" arrives.

**`agent-start` is posted at BOOT**, from `useHostBridge.start()` beside the
save-status watcher — not when the panel opens. The button is gated on
`available`, and `available` is only true once the host has answered, so a page
that asked on open could never be opened: nothing would ever ask. Coverage:
the first case in `e2e/ui-agent-panel.spec.ts`.

**The handler stays main-frame-and-own-origin only** (launcher
`EditorSession.swift`). The canvas renders the person's own site, so a hostile
iframe inside it would otherwise be able to post `agent-send`.

## The wire, as recorded

Probed from `claude` 2.1.277 on 2026-10-18; the shapes are frozen in
`e2e/fixtures/agentStream.ts` so the reducer is tested against the wire rather
than against our idea of it. Lines arrive one JSON object per line.

| line | what the reducer does |
|---|---|
| `system/init` — `session_id`, `model`, `tools` | `available`, the model name, `idle` |
| `system/status` `requesting` | the thinking pulse |
| `system/thinking_tokens` — `estimated_tokens` | the only non-empty thinking signal there is |
| `user` with **`isReplay: true`** | OUR echoed question: confirms the pending bubble, or (on a replay) rebuilds the turn |
| `stream_event` `content_block_start` `tool_use` | opens the tool row — `name` and `id` are already here |
| `stream_event` `content_block_delta` `text_delta` | appends to the open text item |
| `assistant` — the consolidated message | the authority for a `tool_use`'s **input**, and for a text block's final text |
| `user` with `tool_result` blocks | closes the matching tool row, `is_error` and all |
| `system/permission_denied` — `tool_name`, `tool_use_id`, `message` | marks the row denied, **with the message** |
| `rate_limit_event` | shown only when `status !== "allowed"` |
| `result` — `is_error`, `result`, `permission_denials[]` | ends the turn |

A turn is bounded by **our send and the `result` line**, never by message
boundaries: every tool call is another API round, so one turn holds several
`message_start`s. Text items are keyed `${message.id}:${index}` because of
that — a second message restarts its block indices at 0, and a key of the index
alone made the second answer overwrite the first.

### Four ways this is visibly wrong if you forget

Each has a case in the spec, because none of them is a type error:

1. **The replayed question is ours.** Render the `isReplay` line as well as the
   bubble you already drew and every question appears twice.
2. **Thinking deltas carry `""`.** Display is omitted on current models, so a
   thinking bubble built from them is a permanently blank box.
3. **An interrupt is not a crash** — see below.
4. **A denial has to be shown** — see below.

## There is no permission prompt channel

`--permission-prompts host` means "the SDK host or `--permission-prompt-tool`",
and **`--permission-prompt-tool` is not a flag** on this build; it is named only
inside that help text. A raw spawned CLI is nobody, so a tool call that needs a
prompt is **denied automatically**, exactly as `none` would do. Probed with a
`Write` under `--permission-mode manual`: no control line of any kind, and the
model then said *"I need your permission to write the file"*.

So the panel runs `--permission-prompts none` with `--allowedTools
"mcp__guano__*"`, and **rendering the denial is not optional** — without it the
person reads a model asking for permission in a UI with no way to grant it.

A denial arrives twice, and the second must not erase the first: the live
`system/permission_denied` carries a sentence written for a person, while the
`result`'s `permission_denials[]` is a bare summary. The reducer keeps the
message it already has — writing the summary over it unconditionally is a bug
the spec caught, and the panel read `Write · not allowed in this panel` where a
real reason was available.

**Widening what the agent may do means the Agent SDK**, whose `canUseTool`
callback owns the control protocol the CLI will not speak (ROADMAP §5 step 3).
The reducer's input is a plain event object precisely so that swap costs nothing
above the spawn: the SDK emits the same message types.

The server-side agent policy remains the real boundary either way
(`docs/server.md`, Agent policy) — the panel's allowlist is a convenience, not
a security control, and the file tools are *disallowed* rather than confined
because the project folder contains `data/` (`docs/mcp.md`, the fence).

## An interrupted turn is not a failed one

The interrupt is a control request on stdin, and it is answered:

```json
{"type":"control_request","request_id":"<ours>","request":{"subtype":"interrupt"}}
→ {"type":"control_response","response":{"subtype":"success","request_id":"<ours>","response":{"still_queued":[]}}}
```

The turn then ends with `{"type":"result","subtype":"error_during_execution",
"is_error":true,"result":""}` — **the same shape a crash has, with an empty
message.** So the panel remembers that it asked and labels the turn *Stopped*;
an `is_error` result it did not ask for is a real failure and shows its text. A
process *exit* is a third thing and arrives through `agentExit`, which also
raises a notice, because by then the panel may not be open.

## Gated on the concern, never on the host

The button renders on `useAgentChat().available` — not on `host === 'launcher'`
and not on `hostBridge.available`. A launcher on a machine with no Claude Code
is a launcher with no AI button, and `docs/ui.md` already records two bugs from
gating on the cause rather than the intent.

Both dock buttons carry an `aria-label`: they are raw icon buttons, and the
`v-tooltip` directive only sets `aria-describedby` while the tooltip shows, so
neither had an accessible name at all — the insert dock's `+` had been that way
since it was written (the same hole `e2e/ui-a11y.spec.ts` already records for a
modal's Close).

## What the launcher still owes

ROADMAP §5 step 2, with the traps that are waiting there: a GUI app's `PATH`
does not contain `claude`; `ChildProcess` wires stdin to `/dev/null`; the MCP
config must be written by `guano connect --config`, never from Swift; SIGTERM
before SIGKILL; and the transcript has to be replayed after a reload, because
the web view reloads on reauth and the process outlives the DOM.

## Coverage

`e2e/ui-agent-panel.spec.ts` — nine cases through a faked host, over
`e2e/fixtures/agentStream.ts`. There is no unit-test runner here (→
`docs/gates.md`), so the reducer is tested through the DOM it drives.
