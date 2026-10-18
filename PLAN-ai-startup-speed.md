# The AI panel's first turn — making it fast

Decided 2026-10-18, from watching the panel on a fresh project: a one-line
request sits for a long time showing *5 steps · Read the guide: styling*
before a single sentence appears, and reopening a project is slow too. Two
different waits are stacked here and they have different fixes:

1. **Getting to `ready`** — the process chain. `agent-start` → `isCurrent` →
   (maybe) `guano connect --embedded` (a Node boot + a token mint over HTTP)
   → `claude -p` boots → it spawns `node guano.js mcp` (loads the 242 KB
   runtime bundle + the 110 KB `GUIDE.md`, calls `/api/auth/me`) → `initialize`
   → `system/init`. Until today `connect` re-ran on EVERY spawn because
   `isCurrent` never matched (the stale-config bug, then the override-path
   bug — both fixed). What is left is probably 2–4 s and mostly Claude Code's
   own boot, which is not ours.
2. **The first turn** — model round-trips. The handbook's instructions say
   *"fetch what the job needs. Do it BEFORE your first write"*, so the model
   reads the rules, calls `get_guide` for `page-html`, waits, reads, calls for
   `styling`, waits… plus two or three `ToolSearch` calls the harness needs to
   load tool schemas (hidden from the transcript, not from the clock). Five to
   eight full API round-trips before any work, on Opus. **This is almost
   certainly what is being felt**, and nothing here has been measured yet.

Two decisions, made in conversation the same day:

- **Measure first.** Two timestamps say which bucket dominates. Nothing in
  steps 1–6 is justified until step 0 has numbers, and each later step records
  its before/after against the same prompt.
- **Collapse the round-trips before touching the model.** "Read with Sonnet,
  then build with the chosen model" was considered and set aside: you cannot
  switch models mid-turn (`set_model` applies between turns), so it means a
  hidden two-turn choreography for a partial saving — Sonnet still makes five
  calls if the handbook demands five. Remove the calls instead, for every
  model. Then revisit the DEFAULT model for the whole panel, which is the same
  idea minus the choreography.

Two repos: `builder` (this one) and `../launcher`. One commit per step, gates
per step. Read `docs/agent-panel.md` (the wire, Harness bookkeeping is
hidden), `docs/mcp.md` (Embedded mode, and the budget), `docs/gates.md`
(check:mcp's budget is never raised to fit — step 4 argues with that rule on
purpose, in writing), and `../launcher/CLAUDE.md`. `src/` keeps the
no-prose-comments rule — JSDoc only.

## Facts the plan rests on (verified 2026-10-18)

- `claude` 2.1.277. `claude --help` lists `--model <model>` (alias or full
  name) and `--fallback-model`. **No flag for deferred tool loading** was
  found in `--help`; the binary carries `DEFERRED`/`DEFERRABLE` strings and
  `CLAUDE_CODE_DISABLE_FAST_MODE`, but no documented switch for eager tools.
  Treat eager loading as UNAVAILABLE unless step 0 finds a switch; the
  fallback (step 1) needs no switch at all.
- `AgentLaunch.spawn` passes **no `--model`**: the model is whatever
  `--setting-sources user` brings, i.e. the person's `~/.claude/settings.json`
  (`"model": "claude-fable-5-1[1m]"` on the author's machine today — the
  panel's model is the person's TERMINAL default, which is the wrong default
  for a canvas).
- The model menu (`MODEL_CHOICES` in `src/lib/agentLabels.ts`: opus / sonnet /
  haiku) sends `agent-model` → a `set_model` control request → a fresh
  `system/init`. Not persisted anywhere: every spawn goes back to the settings
  default.
- `get_guide` (`tools.mjs` ~5843) takes ONE `section` slug (partial match) or
  `"toc"` or `"all"`. Sections and sizes in bytes: golden rules 6.6k, Inside
  the editor 5.6k, Workflow recipe 9.5k, **Page HTML 15.0k, Styling 15.2k**,
  Design standards 6.1k, Content 6.2k, Media 2.8k, Data 17.9k, Components
  11.2k, Class interactions 11.6k, Animations 21.4k, the rest under 8k each.
- Embedded `initialize` instructions are **19,366 B (~4.8k tokens)** today:
  intro + golden rules (minus 5 and 6) + Inside the editor + the recipe minus
  `set_target`/`publish`. `check:mcp` budgets `tools/list` (80,000 B; panel
  77,086 B / 48 tools) and only PRINTS the instructions size.
- Claude Code prompt-caches the system prompt and tool list. The `result`
  line carries `usage` with cache figures — step 0 reads them, so "bigger
  instructions are cached after turn one" is checked, not assumed.
- `ToolSearch` takes `select:a,b,c` — several schemas in ONE call. The model
  does not know that unless told.
- `--resume <id>` replays Claude Code's OWN session file into context, not
  the launcher's `AgentTranscript` (whose `ceiling` bounds only what is
  replayed to the PAGE). The resume cost grows with the conversation and
  nothing bounds it.

## Steps

### 0. Measure — and record the numbers before anything moves

Both halves, one prompt, three runs each, on a fresh project with the
checkout override on (`AppModel.builderRepoOverride` — it now reaches the
agent too). The prompt: *create an email capture landing page for a SaaS
company named "Atelier"*.

**Page** (`useAgentChat.ts`): a `timings` ref — `startedAt` (the
`agent-start` post), `readyAt` (`ready`), `initAt` (`system/init`), per turn
`sentAt`, `firstTextAt` (first `text_delta`), `doneAt` (`result`), and the
turn's call counts: tool calls, of which `ToolSearch`, of which `get_guide`.
Render ONE mono meta line under a finished turn — `14.3s to first word · 6
calls (3 guide, 2 harness)` — the same `self-start` mono style as the context
line. Not dev-only: a person who finds it slow should be able to say by how
much. Also keep the `result` line's `usage` (`input_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`) on the turn, so a
later step can see whether the instructions were served from cache.

**Launcher** (`AgentSession.swift`): log the spawn milestones to the project
log (⌘L) with elapsed ms — `agent-start received`, `isCurrent: true/false`,
`connect done`, `claude spawned`, `system/init`. The launcher already logs
lines; these are five more.

Record the three runs in `docs/agent-panel.md` under a new **Startup
cost** section: ready-time, first-word time, call count, cache figures. Every
later step appends its own before/after to that table.

Gates: `type-check`, `build`, a case in `e2e/ui-agent-panel.spec.ts` that
the meta line reads `… calls` after `AGENT_BUSY_TURN` with the right count
(`3 calls (2 guide)`), `swift test`.

**Decide from the numbers which of steps 1–6 to do.** If ready-time
dominates, step 6 and the launcher log come first; if first-word dominates
(the expectation), steps 1–4 in order.

### 1. One `ToolSearch`, not three

The harness hands the model tool NAMES and makes it fetch schemas on demand —
three hidden round-trips on the first real session. `ToolSearch` accepts
`select:a,b,c`. So the handbook names the set, per job, and tells the model to
load it in one call:

- `GUIDE.md` → **Inside the editor** gains a short **Your tools** line: *"Load
  what the job needs in ONE `ToolSearch`:
  `select:mcp__guano__get_page,mcp__guano__set_page_html,mcp__guano__edit_structure,mcp__guano__edit_elements,mcp__guano__list_components,mcp__guano__get_guide`.
  Add `create_component`/`update_component` for component work,
  `update_settings` for tokens and fonts, `suggest_next` at the end."*
- `AgentLaunch.systemPrompt` says the same in one sentence (the launcher's
  half is appended whatever the client did with the instructions).

This needs no Claude Code switch and survives whatever deferred loading does
next. If step 0 DID find an eager-loading switch, test it here as an
alternative and keep whichever measures better; note that eager puts ~19k
tokens of schemas in every turn, cached or not.

Gates: `check:mcp` (instructions size noted, external `tools/list`
unchanged at 79,355 B); `swift test` (the prompt assertion); a real run whose
timing line shows **1 harness call**.

### 2. `get_guide {for}` — one call per job

A job-shaped parameter beside `section`: `for: "build-page" | "edit-page" |
"style" | "components" | "content" | "motion"`, each returning its two or
three sections in ONE response, in `tools.mjs`'s `get_guide` handler:

| `for` | sections | ~bytes |
|---|---|---|
| `build-page` | page-html, styling, design-standards | 36k |
| `edit-page` | page-html | 15k |
| `style` | styling, design-standards | 21k |
| `components` | components, nesting, slots, variants | 20k |
| `content` | content, media, data | 27k |
| `motion` | interactions, animations, class-interactions | 35k |

Under the per-result ceiling that made `section: "all"` fail (~110 KB), with
room. The tool description names `for` FIRST — *"`for: "build-page"` returns
everything a page build needs in one call"* — and the Workflow recipe's
opening line changes from *"fetch the sections the job needs"* to *"one
`get_guide {for}` for the job, then work"*. `section` stays for the external
client and for a single topic.

Gates: `check:mcp` (the description grows by one sentence; the panel's
`tools/list` must stay under budget and the external byte count is recorded
— it WILL move by that sentence, which is allowed; what is not allowed is
raising the budget); `e2e/mcp-tool-contracts.spec.ts` — each `for` returns
its sections, in order, under 60 KB, and an unknown `for` answers with the
list; a real run showing **1 guide call** on the Atelier prompt.

### 3. Trivial edits read nothing

The rule is unconditional today — *before your first write* — so *make the
heading say Hello* costs the same orientation as a page build. The handbook
gets a ladder, in **Inside the editor**:

- A one-element change named precisely (text, a class, an attribute, a
  link): **no handbook**. The context line gives the address; `edit_elements`
  or `edit_structure` and done.
- A section or a page: `get_guide {for: "build-page"}` once, then work.
- A kind of work you have not done in this session (motion, data, a
  component): its `for`, once.
- Never re-read a section already in this conversation.

`AgentLaunch.systemPrompt` carries the first bullet only (*"a precise
one-element edit needs no reading — do it"*).

Gates: `check:mcp`; `swift test`; two real runs — *make the heading say
Hello* with **0 guide calls**, and the Atelier prompt still at 1.

### 4. Decide whether the essentials move INTO the instructions

The measured question. After steps 1–3 the Atelier prompt should be at ~2
round-trips of orientation. The remaining option is zero: inline the core of
Page HTML and Styling into `guideInstructions(embedded)` so turn one already
knows the format. That roughly doubles the instructions (~19k → ~40k B,
~10k tokens).

Do it ONLY if step 0's `usage` shows `cache_read_input_tokens` covering the
system prompt on turn two — i.e. the cost is paid once per session, not per
turn. If caching is not happening, stop here and say so in the doc.

If it is: a trimmed **essentials** version of each section (the element
table, the attribute rules, the class rules — not the worked examples)
goes into a new `## Essentials` section of `GUIDE.md` that
`guideInstructions(embedded)` includes and the external path does not. Then
`docs/mcp.md` → Embedded mode records the economics in words: **the external
client pays the instructions every turn and the panel pays them once; the
`tools/list` budget is unchanged and still never raised; the instructions
size is a separate, deliberate number for the panel.** `check:mcp` prints
both and gates neither — add a printed line that names the embedded
instructions as a chosen cost, so the next person does not "fix" it.

Gates: `check:mcp`; the before/after row in **Startup cost**; the Atelier
prompt at **0 guide calls** and the first-word time recorded.

### 5. The panel's default model is the panel's, not the terminal's

Today the panel runs whatever `~/.claude/settings.json` says — the person's
terminal model, on the author's machine a 1M-context Fable. For writing a
strict HTML subset against a handbook, on a canvas where the person is
watching, speed matters more than the last few points of quality.

- `AgentLaunch.spawn` gains `model: String` and passes `--model <alias>`;
  default **`sonnet`**.
- The menu's choice is REMEMBERED per project in the launcher
  (`UserDefaults`, keyed by `ProjectID.path`, like `setupEmailKey`) and
  passed at the next spawn, so picking Opus sticks for that project. The page
  keeps sending `agent-model` mid-session as it does now.
- `MODEL_CHOICES` order becomes sonnet / opus / haiku so the default is
  first; the label logic is unchanged.

Not a hidden two-phase "read with Sonnet, build with Opus": that cannot be
done inside one turn, and after steps 1–3 there is little reading left to
hand off. One model per session, chosen by the person, defaulting to the
fast one.

Gates: `swift test` — `--model sonnet` in the spawn by default, the
remembered choice overrides it; `e2e/ui-agent-panel.spec.ts` — the menu
shows what `system/init` names; a real run's first-word time against step 4's
row.

### 6. The process chain, only if step 0 says so

If ready-time is the larger number:

- Confirm `isCurrent: true` on the second spawn in the launcher log (the two
  fixes today should make it so). If it still re-runs `connect`, that is a
  bug to find before anything else.
- `claude -p` boot is not ours. What is: the MCP server loads `GUIDE.md`
  (110 KB) and the runtime bundle (242 KB) and calls `/api/auth/me` before
  answering `initialize`. Measure `node guano.js mcp` to `ready (stdio)` on
  its own; if it is over ~500 ms, lazy-load the guide (read on the first
  `get_guide`, not at boot — `GUIDE_HASH` can be computed then too).
- Fast mode: Claude Code has it (`/fast`, Opus with faster output,
  `CLAUDE_CODE_DISABLE_FAST_MODE` exists). Find what `/fast` writes to
  settings and whether `-p` honours it under `--setting-sources user`. If
  yes, it is the person's own setting and the panel inherits it — document
  that in `docs/agent-panel.md` as the way to make Opus faster; do not set it
  for them.

Gates: the launcher log numbers before/after, in the table.

### 7. Reopen: resume is unbounded

`--resume` replays Claude Code's own session file, so a long conversation
makes every reopen slower and every later turn heavier. The launcher's
`AgentTranscript.ceiling` bounds only the page replay, not this.

Decision for the executor to confirm with the author before building:
**resume only when the session is short; otherwise start fresh and say so.**
The launcher knows the turn count (it counted `result` lines); above N (start
with 20) spawn `.fresh` and emit a `ready` whose first replay line is a
synthetic note the page renders as a quiet meta line — *"Started a new
conversation; the last one was long."* The alternative (always fresh on
reopen) loses history for no reason on short sessions.

Gates: `swift test` on the choice; a case in the panel spec for the note.

### 8. Docs, and delete this file

`docs/agent-panel.md` → **Startup cost** holds the table and the reasoning for
each lever; `docs/mcp.md` → Embedded mode holds step 4's economics and step
2's `for`; `docs/gates.md` gets one line that `check:mcp` prints the
instructions size as a chosen number for the panel. `../launcher/CLAUDE.md`'s
AI-panel bullet mentions the default model and the resume rule. Delete this
file in the last commit.

## Traps

- **Nothing before the numbers.** The screenshot strongly suggests the first
  turn dominates, but "strongly suggests" is not a measurement, and step 5 in
  particular is a product change that should be argued from a row in the
  table, not from a hunch.
- **The budget is never raised, and step 4 is not an exception.** It changes
  the INSTRUCTIONS, which `check:mcp` prints and does not gate; the
  `tools/list` budget is untouched. Write the economics down or the next
  person will trim it back.
- **The external profile stays byte-identical except where a step says
  otherwise.** Step 2's description sentence moves it; record the new number.
  Nothing else here touches it.
- **Prompt caching is checked, not assumed.** Step 4 depends on it. The
  `result` line's `usage` is the evidence; if `cache_read_input_tokens` is
  zero on turn two, bigger instructions are a per-turn cost and step 4 is off.
- **One `ToolSearch` means naming the tools exactly.** A typo in the
  `select:` list costs a second call and the model will not say so. The
  gate is a real run's harness count, not the prose.
- **`set_model` is between turns.** No step may rely on changing the model
  inside a turn; that is why the two-phase idea is set aside, not deferred.
- **Do not hide the timing line.** The point of step 0 is that a person who
  says "it is slow" can say by how much. A dev-only flag defeats it.
- **The e2e suite shares one data dir**: affected spec only, `pkill` any
  stray `playwright`/`server/index.mjs` first.
