# Roadmap: launcher auth, host-aware chrome, collaboration, server deploy, the AI panel

Five workstreams worked out in design on **2026-10-17** and **2026-10-18**, in
the order they came up. Nothing here is built yet. Each one records what was decided, what the code
already does (with the file and line that proves it), the traps found while
reading, and what is still open.

This file is forward-looking, which is why it is NOT in `docs/` — that
directory holds one file per shipped subsystem, each recording an invariant and
the bug that produced it. When a workstream here lands, its content moves into
the `docs/` file named at the end of its section and the section is deleted
from this file.

The desktop launcher is a separate repo at `../launcher` (SwiftUI, macOS). Its
`PLAN.md` and `CLAUDE.md` are the authority on that side; this file is the
builder-side half plus the cross-repo decisions.

---

## 1. Launcher-owned auth — SHIPPED 2026-10-17

The launcher mints its own session; nobody meets `/admin/login` for a project
they started from their own Dock. Recorded in **`docs/server.md`** (Users /
auth): the loopback + process-secret route, `via` on the session record, the
`host` field, the no-`Secure` cookie, and the read-before-revoke on a password
change. Coverage: `e2e/auth-launcher-session.spec.ts`.

## 2. Host-aware chrome — SHIPPED 2026-10-17

The editor hides the App item, My account, Logout and the publish/save-status
button under the launcher, and the launcher's tab strip carries save state and
Publish instead. Recorded in **`docs/ui.md`** (The two rails): the three
affordances, why they are named for the concern, the `mt-auto` move, the
NAVLESS Account consequence, and the host bridge.

## 3. Live collaboration

**Goal.** More than one person in a project at once, without losing work.

**Status.** Direction decided (Option A). Scope of step 1 agreed. Not built.

### Most of the plumbing is already shipped

- `server/index.mjs:1545` broadcasts **every** store write over SSE, already
  tagged: `broadcastStoreEvent(key, isAgentRequest(req) ? 'agent' : 'human')`.
- `src/composables/useLiveSync.ts:75` throws the human ones away:
  `if (event.type !== 'store-write' || event.source !== 'agent') return`.
- The SSE client object already carries `guanoUserRole`
  (`server/index.mjs:1274`), so identity is attached server-side.
- `PUT /api/store/:key` already takes `If-Match` under a per-key lock and
  answers 412 rather than overwriting (`docs/server.md`). The browser
  deliberately sends no header and keeps last-writer-wins; MCP always sends it.
- `lib/merge.ts` already does a three-way per-item merge, and `adoptRemote`
  already applies remote bytes while writing nothing
  (`src/composables/usePersistence.ts:176`).

**What is missing is not infrastructure. It is a decision about what
"collaboration" means here.**

### Do not just delete that filter line

1. **Tabs cannot recognize their own writes.** The event carries
   `{type, key, source, ts}` — no user, no session. Flip the filter and every
   tab adopts the bytes it just saved. Needs a `sessionId` minted per editor
   tab, sent on the write, echoed in the broadcast, skipped on receipt.
2. **The echo becomes a storm.** `adoptRemote` sets `restoring = true` around
   `project.value = next` (`usePersistence.ts:182`), but the autosave chain is
   two *async* watchers deep — `watch(project, deep)` bumps `projectVersion`
   (`useProject.ts:12`) and the `projectVersion` watcher checks `restoring`
   (`usePersistence.ts:255`). Both flush after the synchronous
   `restoring = false`, so that guard cannot be holding. Today it does not
   matter, because the agent path sets `autosaveSuspended` first and that catches
   it. Adopt a human write without suspending autosave and each adopt writes
   back, which broadcasts, which makes every other tab adopt.
   **Verify with a throwaway `.tmp-test.ts` before building on it**, and expect
   the guard to need to become a generation check rather than a boolean.
3. **Lock-and-adopt is the wrong model for people.** Suspending the other side's
   autosave until 10s of quiet (`QUIET_MS`) is right for an agent, which writes
   in bursts between tool calls. Two humans typing would lock each other out
   alternately, forever.

### The fork, and the call

**Option A — presence plus merge-on-save.** The above, plus presence broadcast,
plus moving browser autosave onto `If-Match` + merge-the-412. Incremental,
reuses everything.

Its ceiling, stated honestly: `computeMerge` is **per-item, id-keyed** — pages,
components, collections. Two people on different pages merge cleanly. Two people
on the *same page* means one side's version of that whole page wins, and
conflicts default to Main. That is not Figma. It is "Dropbox for pages, with a
good conflict resolver."

**Option B — real-time co-editing (CRDT).** The data model suits it: node ids
are stable and the tree is the single source of structure. The exit cost is most
of the persistence layer — the store is whole-blob key-value, autosave
deep-watches and serializes the entire project every 500ms, undo/redo are
whole-project JSON snapshots (cap 50, in-memory) where CRDT needs per-user undo
scoped to your own changes, and the MCP path reads-modifies-writes the whole blob
under `If-Match`. All four assume "the document is a blob you replace."
Weeks-to-months, in the one subsystem where a bug silently eats someone's work.

**Decision: Option A** — not as a stepping stone, as the answer, unless evidence
appears that people want to co-edit a single page simultaneously.

### Order

1. [ ] **Presence only.** New SSE event type, no store changes at all: who is
       connected, which page, which node selected. This buys most of the *felt*
       collaboration, and — more usefully — it makes A's coarse merge
       acceptable, because people stay out of each other's way once they can see
       each other. **Ship this alone and watch what happens before building
       anything else.**
2. [ ] **Session identity on writes**, so self-echo is distinguishable.
       Prerequisite for everything below.
3. [ ] **`If-Match` + merge-on-412 for browser autosave.** The agent path
       already does this; this gives humans the same contract. Highest
       data-safety value per line.
4. [ ] **Node-level merge granularity.** Push `computeMerge` below the page,
       keyed on node id. Turns "same page = someone loses" into "same page,
       different sections = fine." This is where the remaining value is.

### Two things that may make this moot

- **Drafts may already be the answer.** Create draft → work → apply to site is
  shipped, merges three-way, and handles "two people, one project" without any
  of the above. For a team that is not literally co-editing one page, the
  product answer might be "make drafts more obvious" — a UI pass instead of a
  quarter.
- **Collaboration through the launcher puts the server on someone's laptop.** It
  binds all interfaces, so LAN collaboration physically works today. But the
  launcher's rule is that a project tab *is* its server's lifetime — the host
  closes the tab and everyone else's editor dies mid-edit. If collaboration is a
  real goal, that rule and the always-on story must be settled first. It is a
  topology question, not a sync one. See §4.

Lands in: `docs/server.md` (Persistence & storage, Branches & merge).

---

## 4. Deploying to a real server

**Status.** Recommendation made. Choice between (a) and (b) still open.

Publish method `server` means *this host serves both* — the site at `/` and the
editor at `/admin` (`docs/export.md:77`). On a laptop that is localhost, so
picking it locally publishes nothing to the world. Two ways out, matching the
two topologies settled on 2026-09-06:

### (b) Move the studio to a server — recommended first

The graduation the topology note already anticipates: *"laptop-local Guano is
valid until a client needs to log in."*

**The migration is already built, and it is not SSH.**
`GET /api/project-export` / `POST /api/project-import`, admin-only, surfaced as
Settings → Snapshots (`docs/export.md:131`). The package is a zip of `store/` +
`media/`. So:

1. Stand up Guano on the server (SSH, once).
2. Hit its `/admin/setup`, create the admin.
3. Snapshot on the laptop → upload on the server.

What deliberately does **not** travel: users, sessions, invites, `publish.json`
(the GitHub PAT, form recipients) and `integrations.json` (SMTP, API secrets).
That is correct — they are host-bound credentials — but it means the post-import
checklist is "re-enter your secrets," and the handoff UI must say so rather than
letting someone discover it when forms stop sending.

- [ ] **Write the install doc.** Node `^22.18 || >=24.12`, the package, a data
      dir, a systemd unit, a reverse proxy, DNS.
- [ ] **Lead with TLS.** The session cookie is `Secure` by default
      (`server/auth.mjs`), so without TLS nobody can log in and the failure looks
      like "login succeeds then bounces." Caddy in front is the two-line answer.
      `COOKIE_SECURE=0` exists but is the wrong fix for anything public.
- [ ] **Say that one instance = one project = one site.** An agency with six
      clients runs six processes behind one proxy, not one install.
- [ ] **Launcher: a "Move this project to a server" handoff** — take the
      snapshot, save the file, show the install command, link the docs, list the
      secrets to re-enter.
- [ ] **Verify the snapshot round-trips into a fresh instance.** Suspected gap:
      the "re-enter your secrets" step is not surfaced anywhere today.

**Do not build VPS provisioning into the launcher.** Choosing a provider, owning
cert renewal, debugging someone's firewall — unbounded support surface for an app
whose job is running local projects.

### (a) SSH/rsync publish of the static site — only if asked for

A fourth method beside `zip`/`github`. It slots into an existing seam: reuses
`readDirFiles`, the admin/editor gate enforced before the export, the per-user
rate limit, and `settings.publishing.apiOrigin` so forms on the remote site still
reach the studio with CORS read from the published snapshot.

Three traps:

1. **Do not hand-roll SSH.** `zip.mjs` and `smtp.mjs` earned the zero-dependency
   streak, but SSH is key exchange and cipher negotiation — a different risk
   class. Either take `ssh2`, or shell out to `rsync -e ssh --delete` (which also
   gives incremental sync and the delete-removed-routes semantics `github`'s
   replace-root already has). Shelling out depends on the binary existing: fine
   on a Mac or a normal VPS, not fine in a slim container. Pick knowingly.
2. **The key goes where the PAT goes.** `server/data/publish.json`, write-only
   through `/api/publish-config`, never `/api/store`, never the project blob,
   never an export. The destination host and path come from stored config, **not
   the request body** — the same reasoning that keeps the GitHub repo out of the
   request, or anyone who can publish gets to point your key at their box.
3. **Verify the host key.** `StrictHostKeyChecking=no` is the tempting line and
   it is a MITM hole. Trust-on-first-use with the fingerprint shown for approval
   is right, and the device-code authorize flow already has that UX.

Lands in: `docs/export.md` (Publish methods), plus a new "Deploying" section in
the README.

---

## 5. The AI panel: Claude Code inside the editor

**Goal.** A chat with the site's agent, opened from the canvas, under the
launcher. The person types next to the page they are looking at; the agent's
edits land on that page as it works.

**Status.** Built; realignment in progress. Direction decided (option 1
below) on 2026-10-18, wire format probed on a real machine, both halves
shipped. The realignment below is what is left.

### Realignment, 2026-10-18

**The embedded AI panel is Guano's main AI integration.** The external client
path (`guano connect` into Claude Desktop or a Claude Code terminal) stays
supported, but it is secondary: it pushes people into another app, and
everything it needs — `use_project`, `set_target` dialogs, the pin file, the
attestation fallback — exists only because an outside client knows nothing
about what the person is looking at. The panel knows the project, the branch,
the page and the selected element, and must never ask for any of them.

The executable plan is `PLAN-ai-panel.md` at the repo root: one signal
(`GUANO_MCP_EMBEDDED=1`, written only by `guano connect --config … --embedded`),
a target that follows the branch the editor has loaded, and a smaller tool
profile. It is deleted when its last step lands and the docs carry it.

### The decision: drive the person's own `claude` CLI, headless

Three ways to put a model behind a chat box were weighed:

1. **Spawn the installed `claude` binary** in print mode with JSONL on both
   pipes, and render the stream. The harness, the auth and the bill are the
   person's existing Claude Code install. **Chosen.**
2. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) in a node sidecar —
   the same harness as a library. Cleaner than parsing a CLI, but it is a
   second integration surface for the same thing, and it still needs the
   person's Claude credentials. Not for step 1; nothing below precludes it.
3. Our own loop on the Anthropic SDK with the guano tools attached. Rejected:
   it makes every user bring an API key to a self-hosted AGPL tool, and makes
   context management, compaction and the permission model ours to own.

**Why (1) is cheap here and not elsewhere:** the project is already an MCP
server the person's Claude Code can reach — `guano connect` mints the token and
writes the entry (`packages/guano/mcp/connect.mjs`), and `mcp/server.mjs:317`
speaks stdio to whichever client launches it. The chat needs a *client*, and
the person has one installed. What exists today supplies the tools; this
section supplies the box.

### What was observed (2026-10-18, `claude` at `/opt/homebrew/bin/claude`)

```sh
printf '%s\n' '{"type":"user","message":{"role":"user","content":"…"}}' \
| claude -p --input-format stream-json --output-format stream-json --verbose \
    --include-partial-messages --replay-user-messages \
    --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources ""
```

One JSON object per stdout line, in this order for a one-turn exchange:

| line | what it is | the panel does |
|---|---|---|
| `{"type":"system","subtype":"init","session_id","tools":[…],"cwd",…}` | the session is up; first line | remember `session_id` (for `--resume`), show the model name once it arrives |
| `{"type":"system","subtype":"status","status":"requesting"}` | a request is in flight | the "thinking" pulse |
| `{"type":"user","message":{…},"isReplay":true}` | our own stdin line echoed back (from `--replay-user-messages`) | flip the pending bubble to sent — **do not render it a second time** |
| `{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"thinking"}}}` | thinking begins | pulse. **The `thinking_delta`s that follow carry `""`** — display is omitted on current models, so never build a thinking bubble from them |
| `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"pong"}}}` | a token | append to the open assistant bubble |
| `{"type":"assistant","message":{"content":[…]}}` | **ONE block, alone, at array index 0** (corrected 2026-10-18: it is not the message so far — keying it by array index doubled every paragraph) | source of truth for a `tool_use`'s input and a text block's final text; reconciled against the block the stream opened, never by index |
| `{"type":"user","message":{"content":[{"type":"tool_result",…}]}}` | a tool answered (not a replay — no `isReplay`) | close the matching tool row, mark `is_error` |
| `{"type":"rate_limit_event","rate_limit_info":{"status","resetsAt","unifiedWindows":…}}` | the plan's windows | surface when `status !== "allowed"` — the probe machine showed `overageDisabledReason: "out_of_credits"`, which is exactly the message a person needs to see |
| `{"type":"result",…,"is_error","session_id","total_cost_usd","duration_api_ms"}` | the turn is over | close the turn, re-enable the composer |

**One turn holds several `message_start`s** — every tool call is another API
round — so turns are bounded by *our send* and *the `result` line*, not by
message boundaries. `--replay-user-messages` is what makes the send
acknowledgeable at all; without it the first evidence a line landed is the
model's first token.

### Step 0's answers (probed 2026-10-18, `claude` 2.1.277)

**The interrupt is confirmed.** Write to stdin:

```json
{"type":"control_request","request_id":"<ours>","request":{"subtype":"interrupt"}}
```

and the CLI answers on stdout:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<ours>","response":{"still_queued":[]}}}
```

then ends the turn with `{"type":"result","subtype":"error_during_execution",
"is_error":true,"result":""}`. **An interrupted turn is indistinguishable from a
crashed one by the result line alone** — same subtype, and the `result` string
is EMPTY, so trap 9's "render the error text" would render nothing. The panel
must remember that it asked and label the turn *Stopped*; a `result` error it
did not ask for is a real failure.

**The permission `control_request` does not exist, and the plan's step 3 was
wrong about it.** `--permission-prompts host` means "the SDK host or
`--permission-prompt-tool`" — and **`--permission-prompt-tool` is not a flag on
this build**; it appears only inside that help text. A raw spawned CLI is
therefore nobody, so with `host` and no SDK on the other end a tool call that
needs a prompt is **denied automatically**, exactly as `none` would. Observed
with a `Write` call under `--permission-mode manual`: no control line of any
kind, and the model then said *"I need your permission to write the file"* with
nothing anywhere to grant it.

A denial is not silent, though — it arrives twice, and both are the panel's to
render:

| line | |
|---|---|
| `{"type":"system","subtype":"permission_denied","tool_name","tool_use_id","message"}` | live, as it happens, with a sentence written for a person |
| `result.permission_denials[]` — `{tool_name, tool_use_id, tool_input}` | the turn's summary |

Three consequences:

1. `--permission-prompts none` is **forced**, not chosen. Nothing is lost by it
   on this build.
2. **Rendering `permission_denied` is step 1 work, not step 3.** Without it the
   panel shows a model asking for permission and a UI with no answer to give —
   the worst version of this feature.
3. **Step 3 moves to the Agent SDK** (option 2), whose `canUseTool` callback
   owns the control protocol the CLI will not speak. That makes option 2 the
   upgrade path rather than an alternative, and it is the reason to keep the
   reducer's input a plain event object: the SDK emits the same message types.

Two smaller things the probe settled:

- **`content_block_start` for a `tool_use` already carries `name` and `id`** (with
  `input: {}`; the arguments arrive as `input_json_delta`). So the row can appear
  the moment the call starts and have its input filled by the consolidated
  `assistant` event — which remains the authority for the input, as planned.
- **`{"type":"system","subtype":"thinking_tokens","estimated_tokens":N}`** is the
  only non-empty thinking signal, and it is a good pulse.
- A sandboxed read-only `Bash` (`echo hi`) is auto-allowed even under
  `--permission-mode manual`. Irrelevant once Bash is disallowed, but "manual
  prompts for everything" is not true.

Flags that decide the panel's shape (all from `claude --help` on this build):

- **`--permission-prompts host|none`** (default `host`) — who answers a prompt
  in print mode. `host` means the process that holds the pipes answers a
  `control_request` on stdin; `none` means anything that would have prompted
  is denied. **Step 1 runs with `none`** and pre-approves the one toolset it
  wants: `--allowedTools "mcp__guano__*"`. The server-side agent policy is the
  real boundary (`docs/server.md`, Agent policy), so a tool call the panel
  never prompts for is a tool call the server still refuses when it should.
- **`--restricted`** removes Bash and the other code-running tools and
  confines the file tools to the working directories. **Not enough on its own
  — see trap 4.** Add `--disallowedTools Read Edit Write MultiEdit NotebookEdit
  Glob Grep` on top, so what is left is the guano toolset and the web tools.
- **`--mcp-config <file> --strict-mcp-config`** — only this server, from a
  file the launcher owns. The entry comes from `guano connect --config <that
  file>`, never from Swift (launcher `CLAUDE.md`: never write an MCP config
  from Swift). Confirmed in `connect.mjs:71`: an explicit `--config` target is
  `needsQuit: false`, so **the Claude-Desktop-is-running refusal does not
  apply** to this path and `quitDesktop()` stays out of it. Also note that
  target is `stdio: false`, i.e. the written entry has no `type` key — verify
  `--mcp-config` accepts a `command`-only entry; if it does not, pass the
  entry inline with `type: "stdio"` added, which is still not "writing a
  config".
- **`--session-id <uuid>` / `--resume <id>`** — a fresh id per project the
  first time, `--resume` after that. The id is the launcher's to remember per
  project; the page never mints one (and never calls `crypto.randomUUID`; the
  launcher's `UUID()` is fine, this is Swift).
- **`--setting-sources user`**, cwd = the project folder — the person's model
  and effort preferences apply, no project-level hooks or `CLAUDE.md`s are
  loaded from a folder a site owner did not write.
- **`--append-system-prompt`** — three sentences: this chat sits inside the
  Guano editor; the human is looking at the canvas and sees every write land;
  publishing is the human's button, not a tool (and `mcp__guano__publish` is in
  `--disallowedTools` so the model cannot try).

### Where it lives

**The left rail's first button, and a docked 16rem column.** Decided
2026-10-18, after one commit as a canvas dock: a chat is a place you work for
minutes at a time, so a floating panel over the canvas was the wrong shape —
it covered the page it was editing, and a canvas affordance cannot exist in
Play, which is where contributors live. It is now the third value of
`useViewMode`'s one `column` ref (`'pages' | 'components' | 'agent' | null`),
which makes it mutually exclusive with the other drawers by the type alone, and
`visibleColumn` lets it through in both surfaces like Pages does. Recorded in
`docs/ui.md`; the transcript lives in the singleton, not the drawer, so closing
the column keeps the conversation.

**Shown by concern, not by host.** `useAuth` deliberately exports
`showsPublishControl` and never `isLauncher` (`docs/ui.md`, The two rails; two
bugs from gating on the cause). The rail button follows the rule: a new
`useAgentChat` singleton owns `available` (false until the host has answered
that it found a `claude` binary), and the button renders on that. `host ===
'launcher'` is never the test — a launcher on a machine with no Claude Code is
a launcher with no AI button.

**Launcher: one `AgentSession` per project, beside `EditorSession`.** Keyed the
same way (`AppModel.swift:797` creates sessions per `ProjectID`), started
lazily on the first `agent-start`, torn down with `serverStopped()`
(`EditorSession.swift`) and when the tab closes. It owns the child process,
the per-project session id, and the transcript so far (so a page reload can be
replayed into; see trap 8).

### The bridge, extended

`src/lib/hostBridge.ts` posts `{type}` objects out through the `guano`
`WKScriptMessageHandler` and the host calls back on `window.__guanoHost`.
Four messages out, two callbacks in:

| page → host | host does |
|---|---|
| `{type:'agent-start'}` | spawn or resume; reply `agentEvent({type:'ready', sessionId, replay:[…]})`, or `agentEvent({type:'unavailable', reason})` |
| `{type:'agent-send', text, images?}` | write one `user` line to stdin — a string, or a content array of image blocks then the text |
| `{type:'agent-model', model}` | a `set_model` control request (probed 2026-10-18: answered, then a fresh `init` names the new model) |
| `{type:'agent-interrupt'}` | the stream-json interrupt (confirmed — step 0) |
| `{type:'agent-stop'}` | SIGTERM, drop the session (the id is kept for resume) |

| host → page | |
|---|---|
| `__guanoHost.agentEvent(obj)` | one parsed JSONL line, or one of the two synthetic ones above |
| `__guanoHost.agentExit({code, reason})` | the process went away; the composer disables with the reason |

`EditorSession.swift:224` only accepts a message from the **main frame of the
project's own origin**, and that must stay exactly as it is: the canvas renders
the person's site, and a hostile iframe there would otherwise be able to send
`agent-send`. JSON into `evaluateJavaScript` goes through the same
`JSONSerialization` + `[0]` indexing that `sessionLost` already uses
(`EditorSession.swift:154`) — never string-interpolate a model's output into JS.

`useHostBridge.ts` installs the callbacks once and already watches
`usePersistence().status`; the agent callbacks install in the same place.

### What the page gains from being in the page

- **Context travels with the message.** `useAgentChat.send()` prefixes the
  typed text with the active page's slug and, when something is selected, the
  selected node's `data-id`/`ref` — shown in the composer as a chip, not typed.
  That is the whole reason to have the chat *here* and not in a terminal.
- **Edits are already live.** `server/index.mjs:1545` tags every store write
  by `isAgentRequest`, and `useLiveSync.ts:75` adopts exactly the agent ones,
  suspending autosave for `QUIET_MS` and offering `takeOver`. Nothing new is
  needed for the canvas to follow the agent; the existing agent-lock pill is
  the right UI while a turn runs.
- `requestReveal()` / `selectElement()` in `useElement` exist for a later
  "jump to what it just edited" affordance; not step 1.

### Contributors may drive it, for content only — decided 2026-10-18

**The decision.** A contributor can use the AI panel, and only for **text,
translation and new posts**. Not structure, not style, not components, not
publishing.

**That is already a thing the server enforces, word for word.**
`server/contributor-merge.mjs` exists and its first line names its allowlist:
node `content`/`src`/`background`/`locales`, page/entry `seo` + `status`,
collection `entries` (full CRUD), `comments` — text, translations, posts. A
contributor's project write keeps ALL structure and `settings` from the stored
blob and takes only that; a structural edit is silently dropped, and custom
code or the publish target is a **named 403** because a silent drop reads as
success. So this decision needs no new policy vocabulary. It needs the agent's
write to arrive as the contributor.

**And that is one line of existing code away.** The merge gate is
`user.role === 'contributor' && isProjectBlobKey(key)`
(`server/index.mjs:1685`), and for a token request `user` is **the token's
owner**. So:

- a token owned by an **admin** — which is what `guano connect` mints — gives a
  contributor's turn the admin's full structural power, governed only by the
  admin-set agent policy. **This is the hole, and it is open today** for any
  client holding that token.
- a token owned by a **contributor** goes through `mergeContributorProject`
  automatically, with no new code at all.

So the implementation is **one agent token per driving person**, not one per
project. `docs/server.md` already states the principle this rests on: *a token
is judged by how it authenticated, not by its owner's role* — here we want the
owner to BE the driver, which is the same rule pointed the right way.

**Three things it needs, none of them the panel's UI:**

1. **A per-driver token.** `guano connect` mints one token for the connecting
   user and writes one entry per project. A contributor's panel needs a
   contributor-owned token — either a `--config` file per (project, person), or
   a short-lived token the server mints for the session user when the panel
   starts. The second is better: it binds the agent's identity to the browser
   session that opened the chat, and it expires.
2. **The panel in Play.** Contributors are pinned to Play (`useViewMode`), so
   an Edit-only dock is invisible to exactly the people this decision is about.
   That answers the question this section used to leave open: **yes, it exists
   in Play** — and a contributor's Play surface has no Layers and no selection,
   so the context chip is page-only there.
3. **A mixed tool must refuse, not be merged away.** `edit_elements` writes
   content AND classes/variants/bindings; the merge would silently drop the
   structural half, which this repo has already decided reads as a lie. A
   contributor-scoped toolset should refuse the structural keys **by name**,
   the way the custom-code 403 does, so the agent is told and can say so.
   The allowlist that fits the decision: `set_translations`,
   `get_translation_worklist`, `upsert_entries`, `upload_media`, `set_page_seo`,
   the reads — and `edit_elements` restricted to `content`/`locales`.

**What gates all of it: a contributor has no host.** The panel spawns `claude`
through the desktop launcher, and a contributor reaches the editor in a
BROWSER, over the LAN or a remote URL. `available` is false there and there is
no button — so contributor access does not arrive with step 2 at all. It
arrives with **§4b**, when the studio runs on a server and the agent runs
server-side, which is also the first moment whose Claude credentials pay for a
contributor's turn becomes a real question. Until then this section is a
decision on the record, not work in flight.

The one piece worth doing BEFORE then, because it is a live hole rather than a
future feature: an agent token's writes are governed by its owner's role, and
`guano connect` hands out an admin's. Minting per driver — or at minimum
refusing a contributor-driven turn on an admin token — is server work that
stands on its own.

### Traps, numbered because the plan refers to them

1. **A GUI app's PATH is not the terminal's.** `claude` lives in
   `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin` depending on how it
   was installed, and none of those are in a `.app`'s environment. Resolve it
   explicitly (those three, then `$SHELL -lc 'command -v claude'` as the last
   resort), and report "Claude Code is not installed" through `available`
   rather than failing the first send.
2. **`ChildProcess` wires stdin to `/dev/null`**
   (`ChildProcess.swift`, `process.standardInput = FileHandle.nullDevice`).
   The agent needs a writable stdin pipe. Add a spawn option for it rather than
   a second class; the line-splitting and the flush grace are exactly right for
   JSONL and must be kept.
3. **Nesting.** A `claude` spawned from inside a Claude Code session refuses
   unless `CLAUDECODE` is unset in its environment. The launcher is not nested,
   so this only bites the developer probing from a terminal — the probe above
   ran `env -u CLAUDECODE`.
4. **The project folder contains `data/`.** `--restricted` confines the file
   tools to the working directory — which is the project, which holds
   `data/store/guano-project__main.json`, every token and `agent-policy.json`.
   A confined `Edit` on the store is a write that bypasses the whole agent
   policy. That is why the file tools are *disallowed*, not merely confined,
   and why the MCP server itself never touches the data dir
   (`docs/mcp.md`, the fence). Do not relax this for convenience.
5. **No elicitation in print mode.** The guano server's consent dialogs
   (`set_target`, `use_project`, `publish`) are MCP elicitation; a headless
   client declares none, so `set_target` falls to the ask-in-chat attestation
   path (`tools.mjs` ~5955, `docs/server.md`) and `use_project` refuses. Both
   are fine here: the launcher's connect already asked the two policy
   questions, so the written entry carries `target: main` when Main is
   allowed and the agent otherwise works in a draft the editor shows. Publish
   is simply not the agent's — see the flags.
6. **Gate on the concern.** Not `host === 'launcher'`, not `hostBridge.available`
   — `useAgentChat().available`, which is false until the host has said yes.
7. **Thinking deltas are empty; several `assistant` events arrive per turn;
   the replayed `user` line is ours.** All three are in the table above and
   each will produce a visibly wrong transcript if forgotten: a blank
   "thinking" bubble, a duplicated answer, a doubled question.
8. **A page reload loses the DOM, not the process.** The web view reloads on
   reauth (`reauth(reload: true)`) and on the person's own ⌘R. The
   `AgentSession` keeps the transcript it has streamed and replays it on the
   next `agent-start`; the page never persists it (it is runtime state, like
   selection — never in `project`).
9. **`result` can be an error.** `is_error: true` with the text in `result`;
   render it in the turn, re-enable the composer, keep the session. A process
   *exit* is different and comes through `agentExit`.
10. **Kill order.** SIGTERM first, like the server — a turn mid-write is a
    tool call the guano server will finish or refuse on its own; what must not
    happen is a SIGKILL that leaves the child's MCP server orphaned holding
    the token file open.

### Order

0. **Probe the two unverified wire shapes** — **DONE 2026-10-18**, written up
   under *Step 0's answers* above. The interrupt is as expected; the permission
   `control_request` does not exist on this build, which pulled denial-rendering
   into step 1 and moved step 3 to the Agent SDK.
1. **Builder first, host faked — DONE 2026-10-18.** Shipped as
   `src/composables/useAgentChat.ts` (the singleton + reducer),
   `src/components/editor/canvas/AgentDock.vue`, the four messages and two
   callbacks on `hostBridge.ts`, ⌘J in `useEditorShortcuts.ts`, and
   `e2e/ui-agent-panel.spec.ts` (9 cases) over
   `e2e/fixtures/agentStream.ts`. Written up in **`docs/agent-panel.md`**.
   Three things came out differently than planned, each recorded there:
   **`agent-start` is posted at BOOT**, not on open — the button is gated on
   `available`, so a page that asked on open could never be opened;
   **rendering a denial is step-1 work** (step 0), and the `result`'s summary
   must not overwrite the live `permission_denied` message, which it did until
   the spec caught it; and **both dock buttons needed an `aria-label`**, the
   insert `+` included — `v-tooltip` only sets `aria-describedby` while
   showing, so neither icon button had an accessible name. Original shape, for
   the record: `hostBridge.ts` messages + callbacks;
   `useAgentChat.ts` (singleton: `available`, `status`, `turns`, `sessionId`,
   `model`, `send`, `interrupt`, the reducer over the table above);
   `AgentDock.vue` beside `InsertDock` with the footprint rules above;
   ⌘-shortcut registered in `useEditorShortcuts.ts` next to ⌘E
   (`useEditorShortcuts.ts:47`, `buildOnly`), key chosen after checking the
   four registration sites (`docs/ui.md`, Shortcuts) for a free one. **e2e:**
   `addInitScript` installs a fake `window.webkit.messageHandlers.guano` that
   records posts, and the test feeds the recorded probe transcript through
   `window.__guanoHost.agentEvent` line by line, asserting the bubbles, the
   tool row, the single rendering of the replayed question, and that the
   button is absent until `ready`. Shippable alone: without a host the button
   does not exist.
2. **Launcher.** `ClaudeCLILocator` (trap 1); writable stdin on `ChildProcess`
   (trap 2); `guano connect --config <app-support>/mcp/<slug>.json` at
   first use and whenever the project's port or token changes (connect owns
   staleness — `ConnectionListParser` already reads its verdicts); `AgentSession`
   with the spawn line assembled from the flags above; the bridge handlers in
   `EditorSession.handle(message:)`; replay on reload (trap 8). **Tests:** a
   `StreamJSONReader` over the recorded transcript in `LauncherCoreTests`, the
   locator over a fake filesystem, and a real-run test gated the way
   `RealConnectTests` is.
3. **Permissions as a real surface — and therefore the Agent SDK** (option 2).
   The CLI cannot be asked (step 0), so an inline approve/deny row means
   swapping the child process for `@anthropic-ai/claude-agent-sdk` in a node
   sidecar and answering its `canUseTool`. Everything above survives that swap
   except the spawn itself: the SDK emits the same message types the reducer
   already consumes. Until then the toolset is what `--allowedTools` says, and
   anything else is denied with the denial shown.
4. **Later, each on evidence:** "jump to what it edited"; the panel in Play;
   the transcript surviving a launcher relaunch (Claude Code keeps the session
   under `~/.claude/projects/`, but reading its on-disk format is a bet on a
   format nobody promised); the same panel on a server-hosted studio (§4b),
   which is the first time the agent runs on a machine that is not the
   person's and so the first time credentials are a design question.

Landed in: **`docs/agent-panel.md`** (the bridge protocol, the wire table, the
four ways a transcript goes wrong, the permission and interrupt findings), a
section in `docs/ui.md` (the corner now holds two docks), the ⌘J row in the
README, and the registry line in `CLAUDE.md`. Still owed: the launcher's
`PLAN.md` as a Phase 4.6, when step 2 lands — at which point this section goes
away and `docs/agent-panel.md` carries all of it.

---

## Suggested order

1. **§1 + §2 together.** One change, and §2's `store.ts` re-mint is what keeps
   §1 from rotting. Smallest, highest certainty, unblocks the launcher.
2. **§4(b) install doc + snapshot verification.** Mostly writing, over machinery
   that already works, and it answers the question users actually ask.
3. **§5 step 2** (steps 0 and 1 are done — the builder half is in, behind a
   faked host). What is left is the launcher: one process, one config file
   written by `guano connect --config`, and the replay on reload.
4. **§3 step 1, presence only.** Then stop and watch before committing to the
   rest of Option A.
5. Everything else, on evidence.

## Still open

- **§4:** (a) or (b) first — or both? (b) is recommended.
- **§3:** is Option A's per-page ceiling acceptable, or is co-editing one page a
  real requirement? The answer changes the whole workstream.
- **§3:** does the launcher's "a tab is its server's lifetime" rule survive
  collaboration? If not, that decision comes before any sync work.
- **§5:** nothing blocking. The shortcut is settled (**⌘J**), and contributors
  are settled: content only, which `contributor-merge.mjs` already enforces —
  see that section. What it waits on is §4b (a contributor has no desktop host)
  and a per-driver agent token.
