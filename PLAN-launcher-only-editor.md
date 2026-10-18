# The editor is launcher-only; the deployment is Play

Decided 2026-10-18, evening (supersedes the same morning's "launcher-first,
not launcher-only"). Three sentences hold the whole thing:

1. **Admin and Editor use the launcher, and only the launcher.** The Build
   surface — structure, settings, custom code, integrations, publish, invites
   — never sits behind a public browser login. Every builder needs a Mac.
2. **The deployed instance serves Play.** Contributors and reviewers in the
   browser, plus the published site and its forms. They never install
   anything. Once deployed, **the VPS is the source of truth** and the
   launcher is a window onto it.
3. **The protection is enforced at the API, not by hiding UI.** *A browser
   session is never a builder session.* Builder capability needs a credential
   the launcher holds; a cookie session is capped at contributor whatever the
   account's role.

Three precisions were asked and answered the same evening: (1) "editor" means
the Build surface — content roles keep the browser; (2) the rule is at the
API; (3) "login in the launcher" means per-instance sessions held by the app,
not a Guano account. Both topologies survive: **solo** = laptop + static
export, no invites; **team** = deploy, then invite.

This file is the executable plan. Two repos, `builder` and `../launcher`;
one commit per step, gates per step. Read `docs/server.md` (Users / auth —
the whole section, it holds every refusal and the hole each closed),
`docs/instance.md` (Connecting a remote instance), `docs/export.md` (Project
package export/import, Publish methods), `docs/agent-panel.md`,
`../launcher/CLAUDE.md` (its hard rules — two of them are rewritten here, on
purpose, in step 7). `src/` keeps the no-prose-comments rule.

## Facts the plan rests on (verified 2026-10-18)

**Auth, as it is.**
- Roles `admin | editor | contributor | reviewer`. `isBuildRole` in
  `server/auth.mjs` is read by **13 gates** in `server/index.mjs` (lines 154,
  1090, 1169, 1411, 1589, 1606, 1612, 1780, 2182, 2236, 2375, 2571, 2728);
  every "may this account build" check goes through it by design, so a role
  added later is refused by default. That discipline is what makes step 1
  one helper rather than thirteen edits.
- `requestUser(req)`: session cookie first, then a `guano_` API-token bearer.
  `isAgentRequest(req)` = a bearer with no session. **A token is judged by
  how it authenticated**, not its owner's role — the two publish-bookkeeping
  blobs refuse agents on exactly that reasoning.
- **The session already knows how it was minted.** `createSession(userId,
  {via})` records `via`; `sessionVia(req)` reads it; `GET /api/auth/me`
  answers `host: 'launcher' | 'browser'`, and the SPA's `useAuth` turns that
  into three computeds (`showsAppHome`, `showsAccountControls`,
  `showsPublishControl`) that hide the chrome the app's window provides.
  Today `via` changes what is SHOWN, never what is ALLOWED.
- `POST /api/auth/launcher-session` mints a `via: 'launcher'` session for the
  instance's owner on **loopback + the spawn secret** (`GUANO_LAUNCHER_SECRET`,
  per start, never on disk). It cannot work for a server the app did not
  spawn. Before setup it answers 409.
- **The device flow** (`server/device.mjs`, four endpoints): `POST
  /api/auth/device` + `/device/token` unauthenticated; `GET /device/:code` +
  `/approve` admin + SESSION only ("an API token must never be able to approve
  one"). Approve mints `createApiToken(user.id, name)` — **a token for the
  approving user**. The consent screen is where a remote connect picks the
  agent policy. Ten-minute in-memory records, capped per address.
- `POST /api/auth/setup` takes `setupCode` from anywhere but loopback; the
  launcher already posts it locally (`AppModel.completeSetup`). Remotely it
  needs the code printed at the server's first start.
- `POST /api/users/invite` returns `{…invite, token}` — a **link**, not an
  email. SMTP is optional.
- `api-tokens.json` records have no `kind`. Every token is an agent token.

**Client, as it is.**
- `useAuth.canBuild` = admin|editor from `role`. `useViewMode` watches it and
  pins a non-builder to Play (`mode = 'preview'`, `setMode('build')` refused).
  **Ten** component/view files key on `canBuild` or the three `shows*`
  computeds. So if `/api/auth/me` reports a capped role, the SPA pins itself
  with no new code.
- `/setup`, `/login`, `/invite/:token`, `/authorize` are SPA routes and stay:
  the VPS first admin, a browser login, an invite, a device approval.

**Launcher, as it is.**
- `Tab`: `.home`, `.editor(ProjectID)`, `.site(ProjectID, URL)`. A
  `ProjectID` is a folder path. `RegistryEntry` is `{path, addedAt,
  startOnLaunch}` — `projects.json` stores folder paths only (a hard rule).
- `EditorSession` has one `EditorOrigin(port:)` (localhost) and mints through
  `mintSession(origin.port)` → the secret route → writes the cookie into
  WebKit's store. A 401 re-mints.
- `AppModel.connectRemote(url:token:)` runs `guano connect --url` through a
  **lender** project's CLI (any local project's `node_modules`) and renders
  the `DeviceAuthorization {verifyURL, userCode}` the CLI prints. `--embedded`
  and `--target` are NOT threaded through `GuanoCLI.connectRemote`.
- The app bundles its own Node (`Contents/Resources/node`). It does not bundle
  `@useguano/guano`.
- `AgentSession.start` takes a `ProjectInfo` because it needs a folder's CLI.
- `WorkspaceKeychain` already stores one generic-password item. The hard rule
  "the app stores no credential" means passwords; the MCP config `guano
  connect` writes already holds agent tokens on disk.

**Deploy, as it is.**
- `GET /api/project-export` / `POST /api/project-import`, admin-only: a zip
  of `store/` + `media/`, never users, sessions, invites, `publish.json` or
  `site`. Import strict-allowlists, requires a manifest, atomically swaps.
- Publish methods `server | zip | github`; `server` IS this host, so a
  VPS-hosted instance serves the site and its forms with no `apiOrigin`.
- `npm create @useguano` scaffolds a folder, asks the Claude questions, runs
  `npm install`. That is the VPS installer today, whether it knows it or not.

## The design, in one paragraph each

**Token kinds — as a PREFIX, not a field.** A launcher token is
`guanol_…`; an agent token stays `guano_…`. The kinds are different TYPES to
every parser: `requestUser` recognises `Bearer guano_` and nothing else, so a
launcher token cannot resolve as an agent bearer — not "is refused", cannot
be read — and the session exchange below parses `guanol_` alone. Only two
sites in the codebase parse the prefix today (`server/index.mjs`
`requestUser`, `packages/guano/mcp/server.mjs` `whoami`). A `kind` field is
stored on the record as well, for the admin's token list, but the prefix is
the enforcement: a field is a check someone can forget, a prefix is not. A
launcher token is minted ONLY by the device flow when the request says
`kind: 'launcher'`, and the consent screen says so in words — *"Guano
Launcher on Francois's MacBook wants builder access"* is a different sentence
from *"Claude wants to work on this site"*. This is the load-bearing
distinction — see the first trap, and the named test in step 1.

**Builder sessions.** `POST /api/auth/launcher-session` learns a second proof.
Today: loopback + the spawn secret. Added: `Authorization: Bearer guanol_…`
— the launcher prefix, which is the only one this route can read — over
`https:` (plain `http:` for localhost only, as `connect --url` already
rules), whose owner has a build role → a session for THAT user
with `via: 'launcher'`. Rate-limited per address like setup. Two proofs of one
claim — *I am this person's launcher, for this instance* — and one session
kind at the end of both. Nothing else mints `via: 'launcher'`.

**The rule.** One helper in `server/auth.mjs`, `effectiveRole(req, user)`:
the user's role when the request is a builder session (`sessionVia === 
'launcher'`) or an agent bearer (agents keep their own gate, the agent
policy); otherwise `min(role, 'contributor')`. **All 13 gates read
`isBuildRole(effectiveRole(req, user))`** instead of `isBuildRole(user.role)`,
so an admin in a browser is a contributor at the API: content merge on
writes, 403 on users/invites/publish/settings/tokens. `/api/auth/me` reports
`role` (the account's) AND `effectiveRole`, and `canBuild` from the latter —
the SPA pins itself to Play.

**The remote tab.** `Tab.remote(RemoteID)` where a `RemoteID` is an `https`
origin + the instance id `/api/health` answered with. A `remotes.json` beside
`projects.json`: `{url, instance, name, addedAt}` — **never a token**. The
launcher token lives in the Keychain, one item per instance, like the
workspace lock. `EditorSession` gets a second origin kind and a second mint
(the token exchange); a 401 re-exchanges; a refused exchange (revoked token)
shows **Reconnect**, which is the device flow again. No spawn, no supervisor:
running is the health probe, exactly as for a local project.

**Deploy is a move.** A card action **Move to a server…**: the URL → the
device flow (mints the launcher token; a project with no admin yet takes the
setup code first and `completeSetup` posts it, as the modal already does
locally) → `GET /api/project-export` locally → `POST /api/project-import`
remotely → the card becomes a remote card → the local folder is archived
(renamed `.moved-<date>`, never deleted by the app). **Bring back to this
Mac** is the same two calls reversed and is refused while anyone else holds a
session on the remote — the server answers who does. Never a sync.

**The chatbox on it.** The app bundles `@useguano/guano` beside its Node,
for instances it does not own; the lender wart goes. `GuanoCLI.connectRemote`
learns `--embedded --target`. The launcher, holding a builder session, mints
the AGENT token itself through the existing admin tokens API and passes it as
`--token` — **one device approval per instance, not two.** `AgentSession`
takes an *agent host* (local folder or remote) instead of a `ProjectInfo`.
`get_status.versionMismatch` is surfaced in the panel, because now the CLI
is the app's and the server is somebody's VPS.

**Two people, one branch.** The browser's autosave is last-writer-wins; the
MCP server already sends `If-Match` and gets 412. The editor's autosave sends
`If-Match` too, and a 412 becomes a notice — *someone saved this branch;
reloading* — through `useNotice`, then a reload of the blob. Independent of
everything above, and the one step that also protects two Macs in one studio
today.

## Steps

### 0. Record the decision, and rewrite the rules it bends

Before any code, the sentences the code will be checked against.

`docs/server.md` → Users / auth gains **Builder sessions** (the rule, the two
proofs, the token kinds and WHY they exist — the first trap below, written
out). `../launcher/CLAUDE.md` rewrites two hard rules: *"the app stores no
credential"* → *"the app stores no password; it holds revocable per-instance
tokens in the Keychain, as the MCP config already holds agent tokens on
disk"*; *"`projects.json` stores folder paths only"* keeps its sentence and
gains *"remote instances live in `remotes.json`, by origin and instance id,
never by token."* `docs/instance.md`'s data-dir rule already exempts remote
entries. The memory file is already written.

Gate: the docs read as a consistent system before a line changes. No commit
to code in this step.

### 1. Token kinds and the builder session (server)

`server/auth.mjs`:
- `createApiToken(userId, name, {kind = 'agent'})` mints `guano_` for
  `agent` and `guanol_` for `launcher`; the record carries `kind`;
  `apiTokenRecord(raw)` resolves either prefix and returns the kind. `GET
  /api/tokens` lists it so an admin can see which is which. `requestUser` and
  `isAgentRequest` keep matching `Bearer guano_` only — that line is the
  enforcement and gets a comment saying so.
- `effectiveRole(req, user)` as designed above; `isBuilderRequest(req)` =
  `sessionVia(req) === 'launcher' || isAgentRequest(req)`.

`server/device.mjs` + `server/index.mjs`:
- `POST /api/auth/device` accepts `kind`; `GET /device/:code` returns it so
  `/authorize` can say which sentence; `approve` passes it to
  `createApiToken`. Default `agent`.
- `POST /api/auth/launcher-session`: the bearer proof. Order of checks:
  https (or localhost) → `Bearer guanol_` present (a `guano_` bearer is
  **403 by name**: *"an agent token cannot open the editor"* — it is not
  merely unrecognised, it is named, so an agent that tries learns why) →
  token resolves → build role → rate limit → `createSession(owner, {via:
  'launcher'})`. The secret proof is unchanged and still loopback-only.
- `GET /api/auth/me` adds `effectiveRole`, and `canBuild` is computed from it
  server-side so the SPA has one source.
- The MCP server (`packages/guano/mcp/server.mjs`, `whoami` on boot) refuses a
  launcher-kind token with a sentence naming it. `check:mcp` is unaffected —
  nothing in `tools/list` moves.

**The 13 gates are NOT changed in this step.** They still read `user.role`.
This step adds the primitives; step 2 flips the gates, so the two can be
reviewed apart.

Gates: `e2e/auth-launcher-session.spec.ts` — the bearer proof mints
`via:'launcher'` for a `guanol_` token over the test server's loopback (the
https rule is tested by assertion on a non-loopback request being refused), a
contributor's launcher token is refused; **the trap, as one named test in
`e2e/store-agent-security.spec.ts`: "an agent token cannot open the editor,
and a launcher token cannot drive the MCP"** — mint one of each, present each
to the other's door, both 403 by name. This test is the security argument of
the whole plan; it exists before the gates flip and it never goes away.
`check:mcp` byte-identical.

### 1b. One e2e login fixture, on launcher sessions — BEFORE the gates flip

The suite's real cost is not the gates, it is that **13 specs each carry
their own copy of `openEditor`**, every one logging in through the browser
form. After step 2 that is a contributor session and every UI spec that
builds is pinned to Play. So the fixture moves first, while the gates still
read `user.role`, and the full suite proves it green before anything is
enforced.

- `e2e/fixtures/session.ts`: ONE `openEditor(page)` replacing the 13 copies.
  It does setup or login as today, then mints a launcher session through the
  secret route — `POST /api/auth/launcher-session {secret}` over the suite
  server's loopback — and writes the cookie into the context. The suite's
  shared server gets `GUANO_LAUNCHER_SECRET` in `playwright.config.ts`'s
  `webServer.env` (today only `auth-launcher-session.spec.ts` spawns its own
  server with it).
- A second helper, `openEditorInBrowser(page)`, keeps the form login for the
  specs where the browser IS the point: the contributor and reviewer specs,
  `auth-*`, and step 2's new "a browser admin is pinned to Play" case.
- Nothing else changes. Every spec passes exactly as before, because
  `user.role` still decides.

Gates: the FULL suite once (`docs/gates.md`: ordering rule, one data dir,
7–19 min). Green here means step 2's failures, if any, are the gates and not
the fixture.

### 2. A browser session is never a builder session

Every `isBuildRole(user.role)` in `server/index.mjs` becomes
`isBuildRole(effectiveRole(req, user))` — all 13, in one commit, with a grep
in the commit message proving zero remain. `protectedWriteDenial` and the
contributor merge then apply to an admin in a browser exactly as to a
contributor: structure dropped, custom code / publish target / `smtp` /
`integrations` refused by name, `GET /api/store` redacted. Users, invites,
tokens, publish by any method, snapshots, project export/import: 403 for a
browser session whatever the role.

`launcher-session`'s secret proof means **nothing changes locally**: a
project in the launcher on this Mac is a builder session already.

The SPA needs almost nothing: `useAuth` reads `canBuild` off `/api/auth/me`
instead of deriving it from `role`, and ten files follow. `SettingsPanel`'s
Users section and the invite button hide on `!canBuild` as they do for
contributors. The one new sentence: a browser-signed-in admin sees, under
their name, *"You are signed in from a browser. Building happens in Guano
Launcher."* — because otherwise an admin who opens the VPS in Safari reads
their own site as read-only and files a bug.

Gates: `e2e/store-agent-security.spec.ts` — an admin's browser session
(login via `/api/auth/login`) is refused `POST /api/users/invite`, `POST
/api/published`, `PUT /api/agent-policy`, project import; its project write
is content-merged (a structural change is dropped, a custom-code change is
403 by name); the same admin's launcher-kind session is allowed all of them.
`e2e/ui-*`: already on launcher sessions since step 1b, so the suite passes
on the gates alone. Run the FULL suite a second time here; a failure now is
a gate, which is what you want to be looking at.

### 3. The remote tab (launcher, no agent yet)

`LauncherCore`: `RemoteID {origin: URL, instance: String}`, `RemoteEntry`,
`RemoteRegistry` (`remotes.json`), `LauncherTokenKeychain` (one item per
instance id, the launcher token), `RemoteSessionClient` — the bearer
exchange, a pure `decode` like `LauncherSessionClient`, answers `.cookies`
/ `.reconnect` (401/403 on the token) / `.failed`.

`Tab.remote(RemoteID)`; `OpenProjects.toDrop` learns remotes (a remote is
dropped only when removed from `remotes.json`). `EditorSession` takes an
`EditorOrigin` that is either `localhost:port` or a remote origin, and a
`mint` that is either the secret or the exchange. The `guano` message
handler is already main-frame-own-origin; the origin is the remote's.

**Add a server…** on Home: URL → health probe (the instance id becomes the
`RemoteID`) → if `needsSetup`, ask for the setup code and run
`completeSetup` against it → the device flow with `kind: 'launcher'`
(`verifyURL` opens in the user's browser where they sign in and approve; the
app polls `/device/token`) → token to the Keychain → the remote card.
**Remove** forgets the entry and revokes the token through the tokens API.

Not in this step: the AI panel on a remote tab shows *"The AI panel works on
remote projects from step 4"* — honest, not a dead button. `agent-start`
answers `unavailable` with that reason.

Gates: `swift test` — the registry round-trips, `toDrop` with remotes, the
exchange `decode`; a hand run against a VPS (or a second laptop over
Tailscale — the rules are the same): sign in once, close and reopen the app,
the tab comes back signed in; revoke the token in Settings → MCP → the tab
offers Reconnect, not a login form.

### 4. Deploy is a move

`AppModel.moveToServer(id, remote)`: the remote must exist as a remote card
(step 3) or be added inline. Sequence, each step reported in the card's
placeholder the way creation is: export locally (`GET /api/project-export`
through the local launcher session) → import remotely (`POST
/api/project-import` through the remote builder session; admin-only, which
the token's owner must be) → the `.env` project name and the publish method
`server` written on the remote through `update_settings`-equivalent store
write → the local card becomes the remote card → the local folder is renamed
`<name>.moved-<yyyymmdd>`; a **Reveal in Finder** on the card says where.

**Bring back to this Mac** is the reverse and refuses when `GET
/api/users/members` shows another session active in the last ten minutes —
the server already tracks sessions; add `lastSeenAt` to the member view.
After a bring-back the remote keeps running as Play for its contributors,
but it is no longer the source of truth and the remote card says so until it
is removed. That is the one state with two copies, and it is loud.

The New Project modal gains **Where: on this Mac / on a server** — the server
path is "add a server, set it up, create there": `completeSetup` against the
remote with the setup code, then an import of an EMPTY package (the seed
`createProject` makes), so a team project never has a local copy at all.

Gates: `swift test` on the sequence's decision points (a pure `MovePlan`
like `OpenProjects`); a hand run: a local project with media and a draft
moves, opens remote with both intact, and the local folder is renamed, not
gone.

### 5. The chatbox on a remote project

- The app bundles `@useguano/guano` at `Contents/Resources/guano` (the
  `Makefile` stages it from `../builder/packages/guano` the way it stages
  Node). `ProjectFolder.cliScript(builderRepo:)` becomes
  `cliScript(builderRepo:bundled:)`; a remote always uses the bundled or the
  override, never a lender. `ClaudeConnectionService.connectRemote` loses
  `lender`.
- `GuanoCLI.connectRemote` threads `--embedded` and `--target`;
  `connect.mjs` must accept the three together — verify, it was never tried.
- The agent token: the launcher, holding a builder session, calls `POST
  /api/tokens {name: "AI panel on <machine>", kind: "agent"}` and passes the
  result as `--token`. One approval per instance. The agent policy on the
  remote governs it as it governs any agent.
- `AgentSession` takes `AgentHost` = `.local(ProjectInfo)` |
  `.remote(RemoteID, cli: URL)`; `AgentMCPConfig.isCurrent` matches a remote
  entry by instance id. `GUANO_MCP_FILE_ROOT` for a remote is
  `~/.guano/payloads/<slug>` as `connect --url` already sets.
- `get_status.versionMismatch` renders in the panel as a one-line strip:
  *"The server runs Guano 0.1.14, this app 0.1.13 — update the app."*

Gates: `swift test` (spawn args for a remote host, `isCurrent` by instance);
`check:mcp` unchanged; a hand run: two Macs, two launchers, one VPS, both
panels write to the same draft, both canvases follow.

### 6. If-Match in the editor's autosave

`usePersistence` sends `If-Match: <sha256 of the blob it loaded>` on every
project PUT, keeps the hash the server answers with, and on **412** reloads
the blob and notifies — *"Someone saved this branch; your view was
refreshed"* — through `useNotice`, never silently. The MCP server's
compare-and-swap is the model (`docs/mcp.md`, `serializeHandler`). Undo
history survives a reload where it can (same node ids), and the notice says
when it could not.

Gates: `e2e/ui-persistence.spec.ts` — two pages on one branch, the second
save gets 412 and reloads; `check:corpus` unchanged.

### 7. Docs, the CLI, and delete this file

- `docs/server.md` Users / auth: Builder sessions (from step 0, now with the
  gates and the fixture change). `docs/agent-panel.md`: the remote host.
  `docs/export.md`: Move, and the two-copies state. `docs/ui.md`: the
  browser-admin sentence. `../launcher/CLAUDE.md`: the two rewritten rules
  and the remote tab. `../launcher/PLAN.md`: a phase entry.
- `npm create @useguano` is the **server installer** now: it loses the Claude
  questions (the panel is the integration; a VPS has no Claude), prints the
  setup code's location, and its README says *"then add this server in Guano
  Launcher"*. The CLI keeps `dev`/`start`/`connect` for Linux, Windows and
  servers.
- Delete this file in the last commit.

## Traps

- **An agent token must never become a builder session.** This is why the
  kinds are a PREFIX. Agents are gated by the agent policy (`allowMainWrites`,
  `allowPublish`) because they are judged *by how they authenticated*. If the
  exchange endpoint accepted any `guano_` token, an injected agent would
  trade its token for a cookie, stop being an agent in the server's eyes, and
  write Main with the policy off. So `guano_` and `guanol_` are different
  types to every parser — `requestUser` cannot read a launcher token, the
  exchange cannot read an agent token — and each door still refuses the other
  BY NAME so the attempt is visible. The named test in step 1 holds both and
  exists before anything is enforced.
- **Thirteen gates, one helper, zero stragglers.** The commit that flips them
  includes `grep -c "isBuildRole(user.role)" server/index.mjs` → 0 in its
  message. A new route written later must call `effectiveRole`; say so where
  `isBuildRole` is defined.
- **The e2e fixture moves BEFORE the gates (step 1b), never with them.** 13
  copies of `openEditor` log in through the browser form; after step 2 that
  is a contributor session. Consolidate to one fixture on launcher sessions
  first and run the suite green, so step 2's run can only fail on a gate. One
  big uncertain commit becomes two small green ones.
- **`sessionVia` before `destroyUserSessions`** — already documented for
  `/api/auth/update`; the exchange endpoint re-issuing a session on password
  change must keep the same order.
- **The token travels on every request: https only**, exactly as `connect
  --url` rules. Plain `http:` for localhost alone, so the e2e server still
  works.
- **Hiding UI is not the rule.** The SPA pinning to Play is a consequence of
  `/api/auth/me`, not the enforcement. A test that only checks the UI tests
  nothing.
- **A move is not a sync.** The only two-copies state is after a bring-back,
  and the remote card says so until removed. No background reconciliation,
  ever.
- **One approval per instance.** The launcher mints the agent token itself.
  Two device flows for one server is the kind of thing people stop doing.
- **Every builder needs a Mac, and no offline building after deploy.** Both
  are chosen. Write them in the README before someone discovers them.
- **Contributors and reviewers never see the launcher.** Their invite opens
  in a browser. A builder's invite link opens the app (`guano://` URL scheme,
  registered in `Info.plist`, carrying origin + invite token).
- **`one instance = one project = one site`** is unchanged by any of this.
- **The e2e suite shares one data dir**: affected spec only, and `pkill` any
  stray `playwright`/`server/index.mjs` before a run — except step 2, which
  runs the full suite once by necessity.
