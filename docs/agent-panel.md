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

## Asking and suggesting

Decided 2026-10-18, from the second real session. Asked for *"a simple coming-soon
page for a tech startup named Acme"*, the agent invented the palette, the copy, the
CTA and two placeholder email addresses, told the person what it had decided for
them, and stopped — no interactions, no second language, no SEO, and no way to reach
any of those except by knowing to type it. Both halves of that are design, not bugs:
nothing told it to **ask** rather than guess, and nothing told it to **end on the next
move**.

So two MCP tools, **embedded profile only** (`PANEL_ONLY` in `tools.mjs`; the schemas
and the refusals are `docs/mcp.md` → Embedded mode):

```
ask_user      {questions: [{id, question, options: [{label, hint?}] (2–5), freeText?}] (1–4)}
suggest_next  {suggestions: [{label, prompt}] (1–4)}
```

**Both are inert on the server.** They validate, echo a count and return. The whole
effect is here: the panel reads the `tool_use` input the `assistant` event carries and
renders clickable options. **`claude -p` cannot block on a person**, so the contract is
a sentence in the description and in the result alike — call it, say nothing more, end
the turn — and the answer is simply the next user message. If a session shows the model
calling `ask_user` and then carrying on building, **the handbook sentence is not strong
enough: fix the words, not the tool.**

They are not in the external profile. Claude Desktop and a Claude Code terminal are
already a chat, and a tool whose contract is "stop talking and wait" is wrong in the one
place talking is all there is.

### One batch, then build

The rule the model is given is *ask ONCE, with two to four questions, then work* — not a
dialogue. A 16rem column beside a canvas is not a place to hold a conversation about a
page that could already exist, and every round is a round the person is watching
nothing happen. A second round is allowed only when an answer made a genuinely new
choice appear.

The questions that are worth asking are the ones a person can answer: **named moods, not
adjectives** (*stark editorial* over *warm and rounded*, never "modern" versus "clean"),
what sections, which pages, and what must not be invented. Both rules and a worked
example of each tool live in `GUIDE.md` → **Inside the editor**, which
`guideInstructions(embedded)` injects whole, and in `AgentLaunch.systemPrompt`, which
the launcher appends whatever the client did with the MCP instructions. Twice, because
the behaviour has to be right on the first message of a session.

### An ask is not a step

`ask_user` and `suggest_next` become **item kinds of their own** —
`{kind:'ask', key, questions, picks}` and `{kind:'suggest', key, suggestions, picked}` —
and `segment()` gives each a segment of its own. They are conversation, not work: neither
joins the activity bubble, neither counts towards `3 steps · …`.

**The trap is the ordering.** The id is registered as a prompt tool in
`content_block_start`, BEFORE anything can reach `upsertTool` with it — that event
already names the tool, and an ask opened as a tool row once reads *1 step · Ask user*
for the rest of the turn. The item itself is built in `ingestAssistant`, which is the
authority for a `tool_use`'s input and for these two carries the whole of the call. The
`tool_result` is consumed in silence, like a harness tool's.

**A denied one is un-hidden back into a denied tool row**, by `permission_denied` and by
the result's `permission_denials[]` alike. A denial is never hidden, whatever the tool.

### What the chips do

- **One question sends on the click.** There is nothing to collect, so the message is
  the label.
- **Several go through the one composer.** Clicks mark picks, the placeholder becomes
  *Pick above, or type an answer*, and the send arrow enables once every question has a
  pick **or** there is typed text. It then sends `Q: <question> → <label>` lines plus any
  typed text as ONE message — composed in `send()`, not in the drawer, so the person's
  bubble and the line on the wire are the same string. **There is no second send button**
  (`docs/ui.md`).
- **A suggestion sends its own `prompt`, verbatim.** Never applied unasked.
- **A typed message is always a valid answer.** The composer stays live, and a
  half-picked batch sends no `Q` lines at all: a typed answer replaces the chips rather
  than arriving beside them.
- **Chips are kept once spent** — dimmed, the picked one highlighted — so the transcript
  still reads as what was asked and what was answered. They go inert as soon as a later
  turn exists or a turn is running, which is also what stops a second click landing a
  second message.
- **Every chip is a real `ButtonUI` with its label as its accessible name.** There is no
  chip primitive in `src/components/ui/`; `variant="outline"`, picked becomes `default`.
  A chip is the only way to answer without typing, so one with no name takes the feature
  away rather than making it awkward (`e2e/ui-a11y.spec.ts`).

Coverage: `e2e/ui-agent-panel.spec.ts` cases (a)–(e), over `AGENT_ASK_TURN`,
`AGENT_ASK_ONE`, `AGENT_SUGGEST_TURN` and `AGENT_ASK_DENIAL` in
`e2e/fixtures/agentStream.ts` — built with `agentToolCall` like every other call,
because the panel has to pick these two names out of the same stream everything else
arrives on.

## The brief

Decided 2026-10-18, from the same session. The person who typed *"a simple
coming-soon page for Acme"* did not have less to say — **they had no place to say
it.** The brief is that place: a stepper in the drawer, one decision per screen,
that ends by sending one well-formed prompt and by setting the things that are a
fact rather than an interpretation.

`BriefStepper.vue`, mounted by `AgentDrawer` in place of the transcript while
`briefOpen`. The presets, the tables and the template are `src/lib/agentBrief.ts` —
pure data and pure functions, so a brief compiles headlessly.

### Two cards on an empty project

`isEmptyProject` (`useProject`) is the seed and nothing more: one page whose body
has no children, no components, no collections (`createProject`,
`src/lib/factories.ts`). When it is true and the transcript is empty, the list
area shows **Build a brief** and **Just chat** instead of the placeholder
sentence. Once the site has content the cards go, and a **New brief** item stays
in the composer toolbar — a brief then restyles rather than starts over.

**Empty means empty, and it is derived, never cached.** It has to go false the
moment the agent writes one element, or a reload mid-build would offer the cards
over a live transcript.

**The Main-writes notice and the cards are the same slot, and the notice wins.**
Offering a brief to an agent that cannot write Main is a dead end.

### The intake

| # | screen | goes to |
|---|---|---|
| 1 | What is it, and who is it for? — **required** | prompt |
| 2 | What should a visitor do? (sign up · buy · contact · book · read · download · just look) | prompt — it decides the hero and the CTA, which is the thing the Acme run guessed |
| 3 | Pages or sections | prompt |
| 4 | Palette — eight mood presets, then optional primary / accent / background pickers | **tokens** (light + `dark`); a picked colour overrides its token. The mood name is also in the prompt |
| 5 | Light or dark? | **token** `theme.colorMode` |
| 6 | Shape — 4 stops: not rounded · rounded · very rounded · bubbly | **token** `theme.radius`; the stop name in the prompt |
| 7 | Grid — 4 stops: structured · loose · playful · wild | prompt, one fixed sentence per stop |
| 8 | Motion — 4 stops: still · subtle · lively · showy | prompt; *still* also turns off the offer afterwards |
| 9 | Tone & type | prompt; the font direction picks a fixed Google Fonts pairing → `fonts.googleFontsUrl` + the family tokens |
| 10 | Imagery | prompt |
| 11 | Languages | **project** `locales` + `defaultLocale`, set BEFORE the build so content is written translatable from the first page |
| 12 | Logo & brand | **media** — the asset lands in the library and its path goes in the prompt |
| 13 | References — up to 3 screenshots, an optional URL each | the images ride on the `agent-send`; the URLs are named in the prompt |
| 14 | Anything I must use, or must not invent | prompt, under a heading the rules tell the model is law |

**Skip is on every screen but the first.** Fourteen is the ceiling, not the floor —
a brief answered on two screens is a valid brief, and a skipped screen is simply
absent from the prompt.

**Finish sends, so Finish is unmistakable**: one primary button, *Build it*, dead
until screen 1 is answered. Next on the last screen is not Finish.

**The stepper is not a modal.** It replaces the transcript inside the column, and
`docs/ui.md`'s rule is that a persistent column never closes on Escape — so here
Escape closes the stepper, not the column. The answers survive it: they live in a
plain `<script>` block rather than in `<script setup>`, whose consts are
per-instance and so forgot fourteen screens the moment Escape unmounted the
stepper. The first version did exactly that, and the spec caught it.

### A token is a fact, a sentence is a wish

This is the whole shape of the thing. The palette, the radius scale, the colour
mode, the fonts and the locales are **written into the project** by the stepper,
through the same `useSettings` / `useLocale` path Settings → Design uses — so
`useThemeTokens` restyles the canvas live and undo covers them
(`docs/theming.md`). The prompt then says they are already set and closes with
*build on them, do not replace them.*

Grid and motion are **sentences**, from a fixed table, because nothing in
`ProjectSettings` holds "playful" — the model gets a word and a line saying what
it means, so two briefs on the same stop ask for the same thing.

**The writes land before the send.** If a run shows the agent "setting the theme"
after a brief, either the closing line is not strong enough or the settings write
did not resolve first — check that ordering in `build()` before anything else.

### No WebFetch, and the URL is text

A reference carries a **screenshot**, and the URL beside it is a note in the
prompt. The spawn allows `mcp__guano__*` only, and opening `WebFetch` would hand
a prompt-injected agent an outbound channel — the fence is `docs/mcp.md`,
**Untrusted content**, and the allowlist is per spawn, not per message. Do not
"just allow it for the brief".

Coverage: `e2e/ui-agent-panel.spec.ts` cases (f)–(j) and `e2e/ui-a11y.spec.ts`.

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
