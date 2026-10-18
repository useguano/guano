# The AI panel: a Claude Code session inside the canvas

<!-- Read this before touching src/composables/useAgentChat.ts,
     AgentDrawer.vue, useHostBridge.ts or the agent half of
     src/lib/hostBridge.ts. The options weighed are ROADMAP.md §5; the
     launcher's half is ../launcher/PLAN.md Phases 4.6 and 4.8. -->

**The panel is Guano's main AI integration** (decided 2026-10-18). The
external client path — `guano connect` into Claude Desktop or a Claude Code
terminal — stays supported and is secondary: it pushes the person into another
app, and everything it needs to orient itself (`use_project`, the `set_target`
dialog, the pin file) exists only because an outside client knows nothing about
what the person is looking at. The panel knows the project, the branch, the
page and the selected element, and never asks for any of them.

## What it is, and what of it exists

The left rail's first button and a docked 16rem column (⌘J). The person types
beside the page they are looking at; an agent edits the site through the same
MCP toolset any other client gets, and the canvas follows it live.

**It is the third value of `useViewMode`'s one `column` ref**, so it is
mutually exclusive with Pages and Components for free, and it exists in **both
surfaces** — unlike the canvas dock it replaced, which could not appear in Play
at all. The shape and the reasons are in `docs/ui.md`; the transcript lives in
the `useAgentChat` singleton rather than the drawer, so closing the column and
reopening it brings the conversation back.

**The model client is the person's own Claude Code install.** The launcher
spawns `claude -p` with JSONL on both pipes and forwards the stream to the page;
the harness, the authentication and the bill are all theirs. Nothing in this
repo talks to a model, and no API key is ever collected. The three alternatives
(the Agent SDK, our own loop) and why they lost are in ROADMAP §5.

**Both halves are shipped.** The bridge protocol, the reducer and the panel
here, tested against a recorded transcript through a faked host; the spawn,
the MCP config and the stream in the launcher (`AgentSession.swift`,
`EditorSession.swift`). In a BROWSER nothing answers the bridge, so there is
still no button — see **Onboarding** below for what a launcher with no Claude
Code install shows instead.

## The bridge is one contract with the launcher

`src/lib/hostBridge.ts`, over the `guano` `WKScriptMessageHandler` and
`window.__guanoHost` — the same channel that already carries save status and the
reauth round-trip (→ `docs/ui.md`, The two rails).

| page → host | the host's job |
|---|---|
| `{type:'agent-start'}` | spawn or resume, then answer `ready` or `unavailable` |
| `{type:'agent-send', text, images?}` | one `user` line on stdin — a plain string, or with images a content array of image blocks then the text (verified with a real screenshot) |
| `{type:'agent-model', model}` | a `set_model` control request; the CLI answers it and then emits a fresh `system/init` naming the new model, which is how the page learns it took |
| `{type:'agent-target', target}` | `main` or a draft id — the branch the editor has loaded. The host waits for it before it spawns, and re-runs `guano connect --target` and respawns when it changes |
| `{type:'agent-interrupt'}` | the interrupt control request (below) |
| `{type:'agent-stop'}` | SIGTERM; keep the session id for a resume |

| host → page | |
|---|---|
| `__guanoHost.agentEvent(obj)` | one parsed JSONL line, or a synthetic `ready` / `unavailable` |
| `__guanoHost.agentExit({code, reason})` | the process is gone |

The host also sends one synthetic event of its own beside `ready` and
`unavailable`: `{type:'switching', target}`, emitted before a respawn onto
another branch. The reducer makes it `status: 'switching'` and the composer
waits for the `ready` that follows.

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
| `assistant` — **one block, alone, at array index 0** | the authority for a `tool_use`'s **input**, and for a text block's final text — see below |
| `user` with `tool_result` blocks | closes the matching tool row, `is_error` and all |
| `system/permission_denied` — `tool_name`, `tool_use_id`, `message` | marks the row denied, **with the message** |
| `rate_limit_event` | shown only when `status !== "allowed"` |
| `result` — `is_error`, `result`, `permission_denials[]` | ends the turn |

A turn is bounded by **our send and the `result` line**, never by message
boundaries: every tool call is another API round, so one turn holds several
`message_start`s. Text items are keyed `${message.id}:${index}` because of
that — a second message restarts its block indices at 0, and a key of the index
alone made the second answer overwrite the first.

**An `assistant` event carries ONE block, alone, at array index 0 — not the
message so far.** The stream put the answer at index 1, after a thinking
block; the consolidated event then arrived as `content: [{text}]`, so keying it
by its array position made it a *second* item under `msg:0` beside the streamed
one under `msg:1`, and the first real session rendered every paragraph twice.
The reducer now remembers which text block the stream opened (`openText`) and
hands the consolidated text to that; a consolidated text with nothing open — a
replay that carried no stream events — becomes its own item. The first fixture
had encoded the wrong shape by hand and the test passed on it, which is why
`e2e/fixtures/agentStream.ts` builds every block from the recorded wire now.

### Four ways this is visibly wrong if you forget

Each has a case in the spec, because none of them is a type error:

1. **The replayed question is ours.** Render the `isReplay` line as well as the
   bubble you already drew and every question appears twice.
2. **Thinking deltas carry `""`.** Display is omitted on current models, so a
   thinking bubble built from them is a permanently blank box.
3. **An interrupt is not a crash** — see below.
4. **A denial has to be shown** — see below.

## What the transcript shows, and what it hides

A session is mostly tool calls: the first real one made seven in a row before
its first sentence, and a row per call turned the column into a log. So:

- **Consecutive tool calls collapse into one activity bubble** between the
  sentences — `3 steps · Listed the pages`, with the running step named while
  it runs — and expand on click to the list. Each call is described in words
  (`describeTool` in `lib/agentLabels.ts`: `get_guide {section}` → *Read the
  guide: styling*), never by its wire name; the raw input sits under it,
  truncated.
- **The strip above the composer says what the agent is doing right now** —
  the running tool's description, else *Writing…* / *Thinking…* — with the
  Stop button beside it. It only exists while a turn runs.
- **The person's message is a filled bubble on the right**; the model's words
  are plain text, rendered through a token-based markdown-lite
  (`lib/agentMarkdown.ts`: paragraphs, bold, inline code, lists, headings as
  bold lines, fenced code) into Vue nodes — **never `v-html`**: the text is a
  model's output over content the site's users wrote.
- **The page/element context is a small mono line**, above the bubble and in
  the composer's toolbar — it stretched to full width as a badge in a flex
  column, which is what `self-start` is for.
- **The composer is one box**: a bare textarea, attachments as thumbnails
  above it, and a toolbar — the context, `+` (images, up to 5 MB each, read
  with `FileReader`, posted as base64), the model menu (`opus` / `sonnet` /
  `haiku` aliases; disabled mid-turn), and a round send arrow. Enter sends,
  Shift-Enter breaks the line.
- **How much the model says is the launcher's system prompt**, which asks for
  one or two plain sentences and no inventories — a 16rem column cannot carry
  the three-screen recap the first session wrote.

**The lock scrim covers the canvas, not the app.** `AgentLockHost` used to
mount in `App.vue` as `fixed inset-0`, swallowing every key: while the agent
worked the chat itself was frozen, which is the one surface that must stay
live. It mounts in `BuildView` over the canvas region now, `absolute inset-0`,
and lets keystrokes through to any editable element — the point was to keep
the person's hands off the tree mid-write, not off the keyboard.

## Suggesting the next move

Decided 2026-10-18, revised the same day after watching it. Asked for *"a simple
coming-soon page for Acme"*, the first agent invented the palette, the copy, the CTA
and two placeholder addresses, told the person what it had decided, and stopped — no
interactions, no second language, no SEO, and no way to reach any of them except by
knowing to type it. The second half of that is the bug; **the first half is the
feature.**

The fix shipped as two tools, `ask_user` and `suggest_next`. One of them lasted a day.

### Why there is no `ask_user`

It was built, and the first real session with it showed why it should not exist. With
the tool unavailable in that session the model fell back to prose and asked three
open questions in a numbered list — *what does Atelier actually do? who is it for?
dark and editorial, or light and airy?* — before writing a single element. Even with
the chips rendering correctly, that is a form in front of a canvas.

**A page they can react to beats a form they have to fill in.** The person is looking
at the thing being built. A choice they dislike costs one click to undo and they can
SEE what they are undoing, which is not true of a question about a palette they have
not seen yet. So the agent makes the choices a request leaves open, builds, and says
in one sentence what it chose.

**The exception is facts, not taste.** Invent a palette, a layout, section headings,
placeholder copy — all one edit from right. Never invent a phone number, an email
address, a postal address, a price, a statistic, a person's name, or a legal or
medical claim: those are wrong in a way an edit does not fix, and they reach a real
visitor. An obvious placeholder, named as one, is the answer.

The rule lives in `GUIDE.md` → **Build first. Do not ask.** and in
`AgentLaunch.systemPrompt`. Twice, because it has to hold on the first message of a
session, before any `get_guide` call.

### `suggest_next` is the correction channel

```
suggest_next {suggestions: [{label, prompt}] (1–4)}
```

**Inert on the server** (`PANEL_ONLY` in `tools.mjs`; the refusals are `docs/mcp.md` →
Embedded mode). It validates, echoes a count and returns. The whole effect is here: the
panel reads the `tool_use` input the `assistant` event carries and renders clickable
options. **`claude -p` cannot block on a person**, so the contract is a sentence in the
description and in the result alike — call it, say nothing more, end the turn — and a
pick is the next user message, the suggestion's `prompt` verbatim.

**This is what lets the agent build without asking**, so after a first build one or two
suggestions should UNDO a choice it made — a different palette, a different tone — and
the rest move forward. An agent that only ever offers "add animations" has made its
decisions unchallengeable.

### A suggestion is not a step

It becomes an **item kind of its own** — `{kind:'suggest', key, suggestions, picked}` —
and `segment()` gives it a segment of its own. It is conversation, not work: it does not
join the activity bubble and does not count towards `3 steps · …`.

**The trap is the ordering.** The id is registered as a prompt tool in
`content_block_start`, BEFORE anything can reach `upsertTool` with it — that event
already names the tool, and one opened as a tool row once stays a step for the rest of
the turn. The item itself is built in `ingestAssistant`, the authority for a
`tool_use`'s input. The `tool_result` is consumed in silence, like a harness tool's.

**A denied one is un-hidden back into a denied tool row**, by `permission_denied` and by
the result's `permission_denials[]` alike. A denial is never hidden, whatever the tool.

### What the chips do

- **A click sends the suggestion's own `prompt`, verbatim.** Never applied unasked.
- **Chips are kept once spent** — dimmed, the picked one highlighted — so the transcript
  still reads as what was offered and what was taken. They go inert as soon as a later
  turn exists or a turn is running, which is also what stops a second click landing a
  second message.
- **Every chip is a real `ButtonUI` with its label as its accessible name.** There is no
  chip primitive in `src/components/ui/`; `variant="outline"`, picked becomes `default`.
  A chip is how a person redirects a build they were never asked about, so one with no
  name takes that away rather than making it awkward (`e2e/ui-a11y.spec.ts`).

Coverage: `e2e/ui-agent-panel.spec.ts`, over `AGENT_SUGGEST_TURN` and
`AGENT_SUGGEST_DENIAL` in `e2e/fixtures/agentStream.ts` — built with `agentToolCall`
like every other call, because the panel has to pick this name out of the same stream
everything else arrives on.

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

## Embedded mode is the server's contract too

The panel is Guano's **main** AI integration, and the MCP side knows it. One
signal — **`GUANO_MCP_EMBEDDED=1`** in the entry's `env`, written only by
`guano connect --config <file> --embedded` — and `guano mcp` becomes the
editor's agent rather than an outside client:

| | external client | the panel |
|---|---|---|
| which site | the `GUANO_PROJECTS` map, the pin file, a `use_project` dialog | the one project in the file; `use_project` is not listed |
| write target | `set_target`'s dialog, the chat attestation, or a policy-gated `target` | the per-project `target` field, **always written**; `set_target` is not listed, and a write with no target is a hard refusal naming the editor |
| tool list | all of them | the panel profile (below) |
| `initialize` instructions | the golden rules + the workflow recipe | the same, with rules 5 and 6 replaced by the handbook's **Inside the editor** |
| `get_status` | as before | adds `embedded: true` |

The full write-up, with `PANEL_DROPPED` and `guideInstructions(embedded)`, is
`docs/mcp.md` → **Embedded mode**. `check:mcp` measures both profiles against
one budget.

**Never let the agent pick a target in embedded mode, even as a fallback.** A
missing target is the launcher/page handshake having failed and must surface
as that. `main` as a default would write to the live site because a message
was lost.

### The panel profile

Dropped: `use_project`, `set_target`, `publish`, `list_integrations`,
`list_form_submissions`. Kept: everything else, `get_settings` /
`update_settings` included — tokens and fonts are design work — and `preview`,
which is not just a link: it renders the target and returns the same
`warnings` publish does, the only review the panel can run.

## The target follows the branch

`useHostBridge` watches `usePersistence().activeBranchId` with `immediate` and
posts `agent-target` right after `agent-start`. The launcher holds the spawn
until it arrives, re-runs `connect --config … --embedded --target X` when the
file's target differs, and respawns `claude` with `--resume`.

A branch switch mid-session therefore **interrupts first**, then stops keeping
the session id, then starts again. Without the interrupt, a write the model
built against the branch the person just left lands after the switch.

`AgentMCPConfig.isCurrent` compares the target for the same reason it does not
compare the port: the port is a cached guess that `guano mcp` re-reads from
`instance.json`, while the target is read from the config file and nowhere
else. It also requires `GUANO_MCP_EMBEDDED`, so an external entry for the same
project never passes for the panel's.

The page re-posts the target on any `ready` that has not seen one, because a
reload replays `agent-start` and the host cleared what it knew with the page
that told it.

## Harness bookkeeping is hidden

Claude Code hands the model tool NAMES and makes it fetch each schema on
demand, so the first real turn carried three `ToolSearch` rows reading *Looked
up its tools* — three of the seven steps the person was shown, none of them
something the agent did. `HARNESS_TOOLS` in `lib/agentLabels.ts` is the list;
a `tool_use` naming one is kept out of the activity bubble and the step count,
and its `tool_result` is consumed in silence.

**A denied harness tool still renders.** `permission_denied` and the result's
`permission_denials[]` both un-hide the row they name — a denial is never
hidden, whatever the tool.

The flag that would turn deferred loading off is Claude Code's, not ours, and
eager loading puts the whole tool list in every turn. Hiding the rows is the
cheaper answer.

## Onboarding

The drawer's unavailable state distinguishes two things, because they need
different sentences. *Not installed* gets the install guide — `npm install -g
@anthropic-ai/claude-code`, sign in once in a terminal, then **Retry** —
inside the transcript. *Stopped* keeps the terse strip with the reason and the
restart button.

The **Main policy notice** sits at the top of the transcript when the loaded
branch is Main and the server's `allowMainWrites` is off: *The AI can't edit
Main yet*, with an **Allow** button for admins that sends the same
`PUT /api/agent-policy` Settings → MCP → Agent permissions sends. It is the
same setting, reachable where the refusal is seen, not a second endpoint.

## Gated on the concern, never on the host

The button renders on `useAgentChat().answered` — whether the host has replied
AT ALL, `ready` or `unavailable`. Not on `host === 'launcher'` and not on
`hostBridge.available`: `docs/ui.md` records two bugs from gating on the cause
rather than the intent.

It used to be gated on `available`, i.e. on the answer being yes, so a
launcher on a machine with no Claude Code was a launcher with no AI button.
Panel-first turned that from a tidy rule into a hole: the one person who needs
the install instructions could not reach the surface that holds them. The
answer is still the concern — in a browser nothing answers, so there is no
button, which is what the rule was protecting.

Both dock buttons carry an `aria-label`: they are raw icon buttons, and the
`v-tooltip` directive only sets `aria-describedby` while the tooltip shows, so
neither had an accessible name at all — the insert dock's `+` had been that way
since it was written (the same hole `e2e/ui-a11y.spec.ts` already records for a
modal's Close).

## Who may drive it

**Builders today; contributors for content only, when it becomes possible.**
Decided 2026-10-18 (ROADMAP §5): a contributor may ask for text, translations
and new posts, and nothing structural.

The enforcement for that already exists and is not the panel's: a contributor's
project write goes through `server/contributor-merge.mjs`, whose allowlist IS
that decision — node `content`/`src`/`background`/`locales`, page/entry `seo` +
`status`, collection `entries`, `comments`. The gate is `user.role ===
'contributor'`, and for a token request `user` is **the token's owner**. So an
agent token owned by a contributor is scoped correctly with no new code, and an
agent token owned by an admin — which is what `guano connect` mints — is not
scoped at all. **One token per driving person is the whole implementation**, and
until it exists a contributor-driven turn must not run on an admin's token.

One consequence for this file's own code, when that lands: the context chip has
no selection to name in Play, because that surface has no Layers tree. The
other one is already paid for — the drawer exists in Play, which the canvas
dock never could.

Nothing is reachable for a contributor yet regardless: the panel needs a
desktop host to spawn `claude`, and a contributor reaches the editor in a
browser, where `available` is false.

## What the launcher owns

`AgentSession.swift` and `EditorSession.swift`, with the traps that shaped
them: a GUI app's `PATH` does not contain `claude` (`ClaudeCLILocator`);
`ChildProcess` wires stdin to `/dev/null`; **the MCP config is written by
`guano connect --config`, never from Swift** — adding `--target` to `connect`
is the whole mechanism behind the branch switch; SIGTERM before SIGKILL; and
the transcript is replayed after a reload, because the web view reloads on
reauth and the process outlives the DOM.

## Coverage

`e2e/ui-agent-panel.spec.ts` — through a faked host, over
`e2e/fixtures/agentStream.ts`. There is no unit-test runner here (→
`docs/gates.md`), so the reducer is tested through the DOM it drives.
