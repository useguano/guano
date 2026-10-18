# The AI panel is the main integration — realignment plan

Decided 2026-10-18. **The embedded AI panel (the left-rail drawer under the
launcher) is Guano's main AI integration.** The external client path (`guano
connect` into Claude Desktop or a Claude Code terminal) stays supported, but it
is secondary: it pushes people into another app, and everything it needs —
`use_project`, `set_target` dialogs, the pin file, the attestation fallback —
exists only because an outside client knows nothing about what the person is
looking at. The panel knows the project, the branch, the page and the selected
element. It must never ask for any of them.

This file is the executable plan. Two repos: `builder` (this one) and the
launcher at `../launcher` (Swift, `LauncherCore` is the tested package). Each
step is one commit, in order; the gates per step are listed. Read
`docs/agent-panel.md`, `docs/mcp.md` and `docs/instance.md` first, and
`../launcher/CLAUDE.md` before touching Swift. **Never write an MCP config from
Swift** (launcher rule); `guano connect --config <file>` is the only writer.

## What went wrong, concretely (the screenshot that started this)

First turn on a fresh project, "create a heading that says Hello":

1. `get_page {pageId: "/"}` → *no target set — call set_target first*. The
   per-project config only carries `target: main` when the agent policy already
   allows Main writes (`connect.mjs`, `mainAllowed`), so a fresh project has no
   target and the model had to call `set_target`. In print mode there is no
   elicitation dialog, so the attestation fallback let the model pick `main`
   itself. **Nobody asked the person.**
2. `get_page {pageId: "/"}` again → *no page with id "/"*. The context chip
   says `"Home" (/)` and `findPage` (`tools.mjs:1155`) only takes the uuid.
3. Three `ToolSearch` rows ("Looked up its tools"): Claude Code's deferred
   tool loading. The CLI hands the model tool names and it fetches each schema
   on demand. Not ours to control from the spawn; it recurs per session. It is
   harness bookkeeping and should not be rendered as something the agent did.

## The contract, in one place

**One signal: `GUANO_MCP_EMBEDDED=1`** in the entry's `env`, written only by
`guano connect --config <file> --embedded`. When `guano mcp` sees it:

| | external (today) | embedded (new) |
|---|---|---|
| which site | `GUANO_PROJECTS` map, pin file, `use_project` dialog | the one project in the file; `use_project` not listed |
| write target | `set_target` dialog / attestation / policy-gated `target` | the per-project `target` field, **always written**, from `--target <main\|draftId>`; `set_target` not listed; a write with no target is a hard refusal naming the editor, never a prompt |
| tool list | all 56 | the panel profile (below) |
| `initialize` instructions | golden rules + workflow recipe | same, with rules 5 and 6 replaced by the **Inside the editor** section |
| `get_status` | as today | adds `embedded: true`; `targetSet` is always true |
| Main policy | server refuses when `allowMainWrites` is off | unchanged server-side; the **drawer** surfaces it with the switch |

**Target follows the branch the editor has loaded.** The page posts
`{type:'agent-target', target}` (`'main'` or the draft id) at boot and whenever
`activeBranchId` changes. The launcher re-runs `connect --config … --embedded
--target X` if the file's target differs, then respawns `claude` with
`--resume`. A branch switch is rare; a respawn is seconds.

**The panel profile** — tools listed in embedded mode. Drop: `use_project`,
`set_target`, `publish` (already disallowed by the spawn; now not listed),
`list_integrations`, `list_form_submissions`. Keep everything else, including
`get_settings` / `update_settings` (tokens and fonts are design work) and
`preview` — unless it only returns a URL to open, in which case drop it too
(check its handler, `tools.mjs:11513`). `check:mcp` measures **both** profiles.

## Steps

### 0. Record the decision

- `ROADMAP.md` §5: a short "Realignment, 2026-10-18" subsection stating the
  decision and pointing at this file. Status line → "built; realignment in
  progress".
- `docs/agent-panel.md`, top: one paragraph — the panel is the main
  integration, the external client is supported and secondary.

Gate: none.

### 1. Pages are addressable by path

`tools.mjs` `findPage(project, pageId)`: accept the uuid, the short id a read
prints (if that is not already handled upstream — check `get_page {id}`), or a
**path** (`"/"`, `"/about"`). Match path exactly against `page.path`. Every
tool that takes `pageId` must go through `findPage` (`get_page`,
`set_page_html`, `edit_structure`, `update_page`, `delete_page`,
`set_page_seo`, `edit_elements`, and any other — grep `pageId`). Update the
`pageId` description once, in one sentence: "page id, or its path such as
`/about`". The refusal message keeps naming `list_pages`.

Gates: `check:mcp` (descriptions grew), `e2e/mcp-reads.spec.ts` + a case in
`mcp-tool-contracts.spec.ts` (path resolves; unknown path refuses).

### 2. The context chip speaks in tool terms

`src/components/editor/sidebar/AgentDrawer.vue` `context`: the prompt names the
page as `"Home" (pageId: <page.id>, path: /)`. The label stays as it is.
Also `e2e/ui-agent-panel.spec.ts` "a send posts the typed text with the page
context": assert `pageId:` is in the posted text.

Gates: `type-check`, that spec.

### 3. Harness bookkeeping is not an action

`src/composables/useAgentChat.ts` reducer: a `tool_use` named `ToolSearch` (and
any other non-`mcp__guano__` tool that is pure lookup — keep the list in
`lib/agentLabels.ts` as `HARNESS_TOOLS`) is not added to the activity bubble
and does not count as a step; its `tool_result` is consumed silently. The
`ToolSearch` label in `agentLabels.ts` can go. A denied harness tool still
renders (a denial is never hidden — `docs/agent-panel.md`). New spec case with
a fixture turn containing a `ToolSearch` call: the bubble says `N steps` without
it.

Gates: `type-check`, `e2e/ui-agent-panel.spec.ts`.

### 4. `guano connect` learns `--embedded` and `--target`

`packages/guano/mcp/connect.mjs`:

- `--embedded`: only valid with `--config <file>`; writes
  `env.GUANO_MCP_EMBEDDED = "1"` on the entry. Refuse it without `--config`
  with a sentence (the shared Claude configs must never be embedded).
- `--target <main|draftId>`: writes the project's `target` field
  **unconditionally** (today it is written only when `mainAllowed`; keep that
  rule for the external path, i.e. when `--target` is absent). Validate the
  value: `main` or a uuid-shaped id. `new:<Name>` is not accepted here.
- Neither flag touches the agent policy. `--yes` semantics unchanged.
- `--print` shows both.

`check:cli` already runs `--help`: add both flags to `HELP` and the
subcommand's usage line.

Gates: `check:cli`, `e2e/instance-identity.spec.ts` (add: an embedded entry
round-trips through `parseProjects` with its target; `--embedded` without
`--config` exits 1).

### 5. `guano mcp` embedded mode

`packages/guano/mcp/tools.mjs` + `server.mjs`:

- `createToolSet({ …, embedded })`: `server.mjs` passes
  `process.env.GUANO_MCP_EMBEDDED === '1'`. The toolset filters the panel
  profile out of `tools` and `toolMap` (a call to a dropped tool is `unknown
  tool`, which is already the answer).
- Target: in embedded mode `envTarget` comes from the project's `target` as
  today (`configuredTarget`). If it is empty, every write refuses with: *"the
  editor has not told the agent which branch is open — reopen the AI panel"*.
  No `set_target` path, no attestation, no dialog.
- `get_status`: `embedded: true`, and `targetSet` reflects the configured
  target. The description's "propose a DRAFT" sentence is external-only; in
  embedded mode trim it from the tool description (descriptions are built at
  toolset creation, so branch on `embedded` there).
- `GUIDE_INSTRUCTIONS` becomes a function of `embedded`: the intro, the golden
  rules **with rules 5 and 6 replaced by** the new `## Inside the editor`
  section (step 6), and the workflow recipe with its target step removed.
  Export `guideInstructions(embedded)`; keep `GUIDE_INSTRUCTIONS` as the
  external value so nothing else moves.
- `scripts/measure-mcp.mjs`: measure both `createToolSet({embedded:false})` and
  `({embedded:true})`, print both totals, fail if either exceeds `BUDGET`. The
  embedded list is smaller by construction; **the budget is not raised**.

Gates: `check:mcp`, `e2e/mcp-tool-contracts.spec.ts` (embedded toolset omits
the five tools; a write with no target refuses with the editor sentence;
`get_status.embedded`), `e2e/mcp-tools-security.spec.ts` (embedded must not
loosen the untrusted-content fence or the file-root confinement).

### 6. The handbook gets an **Inside the editor** section

`packages/guano/mcp/GUIDE.md`, new `## Inside the editor` placed right after
the golden rules. Content, in the handbook's voice:

- You are a panel beside the canvas. The person sees every write land.
- The site and the branch are decided by the editor: the target is set, never
  ask about Main or a draft, never look for `set_target` or `use_project`.
- The context line at the top of each message names the page by `pageId` and
  path and the selected element by `ref` or `data-id`; start there.
- Main may be refused by the server's agent policy: relay the sentence, which
  names the switch in the drawer, and stop. Do not retry, do not make a draft.
- Publishing is the person's button.
- Keep replies short (the system prompt says it too; the handbook is what the
  model trusts).

`docs/mcp.md` and `GUIDE.md` must stay in sync (CLAUDE.md rule): add the
embedded mode to `docs/mcp.md` under **The write target** and a new short
section **Embedded mode**.

Gates: `check:mcp` (instructions size, both profiles).

### 7. The launcher: target, respawn, embedded connect

`../launcher`, `LauncherCore` first (tested), then the app:

- `GuanoCLI.connect(…)`: new `embedded: Bool = false`, `target: String? = nil`
  → `--embedded`, `--target <x>`. `ClaudeConnectionService.connect` passes
  them through. Test in `AgentTests.swift` / the connect tests.
- `AgentMCPConfig.isCurrent(fileAt:project:target:)`: also require
  `env.GUANO_MCP_EMBEDDED == "1"` and the project's `target == target`. The
  comment block there explains why the port is not compared; add why the
  target is.
- `AgentCommand` gains `.target(String)`. `EditorSession.handle` accepts
  `agent-target` with `target` validated as `main` or a uuid (same
  character-class discipline as `agent-model`).
- `AgentSession`: remembers `desiredTarget`. `start` waits for it if unknown
  (the page posts it right after `agent-start`; keep `agent-start` at boot as
  today). `spawn` runs `connect --config … --embedded --target X` when
  `isCurrent` is false. On `.target(X)` with a different X while running:
  interrupt if a turn is in flight, `stop()` keeping the session id, then
  `start` again → `--resume`. Emit a synthetic `{type:'switching', target}`
  event before and the ordinary `ready` after, so the page can say what is
  happening.
- `AgentLaunch.disallowedTools`: unchanged. The profile is what hides
  `set_target` and `use_project`; the spawn list stays a convenience.
- `AppModel` wiring for the new command, same place as `.setModel`
  (`AppModel.swift:1016`).

Gates: `swift test` in `LauncherCore`; build the app; a real run against a
fresh project, then switch branch in the editor and confirm a write lands on
the draft.

### 8. The page: branch → target, the Main switch, onboarding

- `src/lib/hostBridge.ts`: `{ type: 'agent-target'; target: string }` out;
  `{type:'switching', target}` in (reducer sets `status = 'switching'`).
- `src/composables/useHostBridge.ts`: watch `usePersistence().activeBranchId`
  with `immediate`, post `agent-target` after `agent-start`. Post it again on
  every `ready` that arrives without a target having been acknowledged (a
  reload replays `agent-start`; the target must follow).
- `useAgentChat`: `status: 'switching'` → the strip above the composer reads
  *Switching the agent to <branch name>*; composer disabled until `ready`.
- **Main policy notice.** In `AgentDrawer.vue`, when the loaded branch is Main
  and `useAuth`'s agent policy has `allowMainWrites: false`: a notice at the top
  of the transcript, *The AI can't edit Main yet*, with a `ButtonUI` *Allow* for
  admins that flips the same setting `SettingsPanel.vue` flips (reuse its
  request; do not add a second endpoint), and a plain sentence for everyone
  else. Errors through `useNotice()`.
- **Onboarding when Claude Code is missing.** Today an `unavailable` answer
  hides the rail button entirely. Panel-first means the person must discover
  the feature: the button renders once the host has **answered at all**
  (`ready` or `unavailable`), still never on `host === 'launcher'` — the
  answer is the concern, which keeps `docs/agent-panel.md`'s rule intact.
  The drawer's unavailable state distinguishes *not installed* (install
  instructions: `npm install -g @anthropic-ai/claude-code`, sign in once in a
  terminal, then a *Retry* button → `restart()`) from *stopped* (reason +
  Retry). In a browser nothing has answered, so there is still no button.
- Spec cases in `e2e/ui-agent-panel.spec.ts`: `agent-target` is posted after
  `agent-start` and again on a branch switch; `switching` disables the
  composer and names the branch; the unavailable-but-answered host shows the
  button and the install guide; the Main notice appears for an admin on Main
  with the policy off and not on a draft.

Gates: `type-check`, `build`, that spec, `e2e/ui-a11y.spec.ts` (new buttons
need names).

### 9. Docs sweep

- `docs/agent-panel.md`: new sections **Embedded mode is the server's contract
  too**, **The target follows the branch**, **The panel profile**, **Harness
  bookkeeping is hidden**, **Onboarding**. Update the bridge tables (two new
  messages). Update "Gated on the concern" with the answered-host rule.
- `docs/mcp.md`: embedded mode (step 6), and reframe the opening: the panel is
  the primary client, the external one still gets the full protocol.
- `docs/instance.md`: the per-project config file the launcher owns, the two
  new `connect` flags, and that `GUANO_MCP_EMBEDDED` is only ever written there.
- `docs/gates.md`: `check:mcp` measures two profiles.
- `docs/server.md`, Agent policy: the drawer's Allow switch is the same
  setting, just reachable where the refusal is seen.
- `README.md` / any landing copy: the panel is how you use AI in Guano; Claude
  Desktop and Claude Code "also connect" via `guano connect`.
- `../launcher/PLAN.md` + `CLAUDE.md`: the agent session's target rule and the
  connect flags.
- Delete this file in the last commit and fold anything still true into the
  docs above.

## Traps

- **Never let the agent pick a target in embedded mode**, even as a fallback.
  A missing target is a bug in the launcher/page handshake and must surface as
  one, not be papered over by `main`.
- **The config file is written by `connect`, never by Swift.** Adding
  `--target` to `connect` is the whole mechanism.
- **A respawn mid-turn** must interrupt first (`agent-interrupt`), or a write
  built against the old branch lands after the switch.
- **`check:mcp` budget is never raised.** Two profiles, same number.
- **`docs/mcp.md` ↔ `GUIDE.md` sync** is a CLAUDE.md rule; step 6 touches both.
- **Denials are never hidden**, including a denied harness tool (step 3).
- **Do not gate the rail button on `host === 'launcher'`** (two recorded bugs
  in `docs/ui.md`); gate on the host having answered.
- **The e2e suite shares one data dir**: run the affected spec, not the suite,
  and a wall of tail failures is one leak upstream.
- Deferred tool loading (`ToolSearch`) is Claude Code's; if a flag turns it off
  on the installed build, record it in `docs/agent-panel.md` but do not use it
  by default — eager loading puts the whole tool list in every turn.
