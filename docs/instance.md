# Instance identity and process lifecycle

<!-- Read this before touching server/instance.mjs, server/lifecycle.mjs,
     boot() or the CLI's connect path. CLAUDE.md points here. -->

## Which project a port is answering for

Several Guano projects on one machine all default to 4174, so the port names nothing — whichever instance boots first owns it, and an API token is minted into exactly ONE data dir.

A client configured for project A that reaches project B is answered with a **401 indistinguishable from a revoked token**. `guano mcp` exits on it before the MCP handshake, so the only thing the user is ever told is "MCP server not connected" while a valid token sits in a config file pointing at a live, healthy server. Nothing anywhere named the cause. Three pieces close it.

## `id` — opaque, minted once per data dir

Never changed. `/api/health` reports it, which is safe on the one unauthenticated route precisely because it is opaque: no path, no name, nothing derived from a secret, no store parse. The human-readable `name` is served only to an authed caller, on `/api/auth/me`.

`guano connect` bakes the id into the client entry as **`GUANO_INSTANCE`**, and `guano mcp` compares it against health **before presenting the token** (`instanceMismatch` in `mcp/server.mjs`), so the wrong project is refused by name — "expected instance b219e658, got 1dadfd6b" — instead of 401ing.

**`connect` mints the id when the data dir has none** (`ensureLocalIdentity`), rather than writing an entry without one. It is `boot()`'s own idempotent `ensureInstance`, so the server adopts whatever is on disk at its first start; the id just exists EARLIER. It has to, because `npm create @useguano` connects **before the server has ever run** — so `readIdentity` reached its "claim nothing about identity" branch and *every scaffolded project* got an id-less entry, permanently, with nothing telling anyone to reconnect after first boot. The router then falls back to the token test against whatever holds the port, and the day that entry's token goes stale the answer is a plain 401 reported as "no configured project is running" while `/api/health` answers 200 `ok`. Nine such entries, all claiming :4174, is what the bug looked like from outside. `PORT` goes into the fresh record for the same reason — it is this project's address and is otherwise unknowable until the server listens — and is never overwritten, because the live server records the port it actually got.

The scaffolder also has to **hand `PORT` across**: it imports `connect.mjs`'s `main()` directly, so `bin/guano.js`'s `process.loadEnvFile` never runs and the port written into `.env` a moment earlier was invisible. Connect fell back to the 4174 default and baked `http://localhost:4174` into the entry of a project whose own `.env` said 4180 — `pickPort` doing its job and the entry contradicting it.

An entry written before this existed carries no id, so the bare 401 is also given the sentence it was missing. An older instance reports no `instance` at all and must keep working, which is why **a missing field is never a mismatch**.

## `port` — written after `listen` resolves

Because the port a project owns is the one it actually got: recording what it asked for would remember a number that was already taken.

`boot()` then prefers the remembered port over the 4174 default whenever `PORT` is unset. The record is also why the walk warning can distinguish "something took the default" from "something took MY address" — the case where a client config has gone stale.

A `previewPort` sat beside it until the preview moved onto this server under `/_guano/preview` (see `docs/export.md`). **A project owns one port now**, which is also why `npm create @useguano` steps by one when it picks a free one rather than by two.

## ONE config entry, with a map of projects

There have been three schemes, and each fixed the one before it.

The fixed key `guano` silently **EVICTED** the previous project's entry, so connecting a second site disconnected the first with no evidence but Claude no longer reaching a site nobody had touched.

`guano-<slug>`, one `mcpServers` entry per project, fixed that — and introduced a worse nuisance. **Claude Desktop launches every entry it has at startup**, so every project not running that minute failed its handshake and raised its own "could not connect" alert. On a machine with four sites that is the normal state, and the alerts name a cause (a dead server) that is not a problem.

Now one entry, `mcpServers.guano`, whose env carries **`GUANO_PROJECTS`**: `{"<slug>": {url, token, instance, target, name}}`. One process, one toolset, and therefore **one tool list whatever the project count** — which matters, because the tool list is injected into the model's context on every turn and `check:mcp` budgets it at 80,000 B. Per-project entries would have paid that per running project.

`connect` folds every legacy `guano-*` entry (and a bare `guano` one) into the map, keeping each one's token and target: they are unambiguously ours, and leaving them would keep raising the alerts. An unrelated MCP server's entry is never touched. The slug is unique within the map, so two sites both called "Site" do not overwrite each other.

**Every Claude client on the machine gets the entry**, in order: Claude Code's `~/.claude.json` first, then Claude Desktop's config. It wrote Desktop's and nothing else, so a Claude Code user got the whole success path — minted token, `✓ MCP project … →` — and no tools, because the entry lived in a file their client does not read, and neither `--config` nor `--print` is mentioned where that user would be looking. Claude Code goes first because it needs no quit, so a Desktop left open cannot cost the write that would have worked. The asymmetry: Desktop's config file is ours to create (an MCP entry is the whole of what it holds), while `~/.claude.json` is Claude Code's own state, so its **absence** means that client has never run here and nothing is written — a stub would be inventing another tool's private state.

**One instance is one key.** An entry already carrying our instance id is this project under an older slug — a data-dir folder, from before the project was named — so `connect` takes that key over and overwrites it, dropping any further duplicates. Asking only whether the base slug was taken meant a reconnect wrote a SECOND entry for one site: two keys, one instance, both reachable at one url, and `resolve()` refusing to guess between them. The fold's own identity check had just proved that legacy entry was us, and nothing used the answer.

**`target` is per project.** It was one `GUANO_MCP_TARGET` for the whole entry; with several projects behind one entry, pinning Main for a landing page would have pinned it for a client's live site too.

What is lost: the project no longer appears in the tool name (`mcp__guano__get_page`, not `mcp__guano-landing__get_page`). `get_status` and the startup log name the live project instead.

## Which project is live

**An entry addresses a DATA DIR, not a port.** `dir` is the authority on where a local project is — the rule the rest of this file already states — while `url` is a cached guess that is wrong the first time a port moves. `identifyEntry` reads `<dir>/instance.json`, written AFTER `listen()` resolves, so it is the port the server actually got; `url` remains for remote instances (no local dir) and for entries written before this, so an old map keeps working and `connect` upgrades it in place. Ports moved constantly once the desktop launcher began pinning one per project from its `.env` and stopping the server with its tab: every "it cannot connect" report was a live project at an address the map remembered wrong, and the only cure was another `connect` that added a working entry beside the dead one.

This is also what finally makes cleanup possible. `disconnect` never removes an entry it cannot DISPROVE, and a port with nothing on it disproves nothing — so before `dir`, an entry whose port had merely been freed was undeletable and the map could only grow. A dir that is GONE, or that now holds a different instance id, is proof **offline**, with no port involved.

**`connect` reads its write back** before printing the success line. A write can be reverted between the two — Claude Desktop flushing its in-memory config as it quits is the case that happens — and a `✓ config updated` printed over a reverted write is the worst available outcome: it sends someone looking for a dead server for an hour. It now fails by name and exits 1 instead.


`packages/guano/mcp/projects.mjs`. **The agent must never be the one that decides which site it writes to** — a node id addresses one tree and a token is minted into one data dir, so a misdirected write is not a smaller version of the right write, it is an edit to someone else's site reported as success.

Resolution order:

1. **`GUANO_MCP_PROJECT`** — pinned in the entry's env. The human edited a config file, which is the one consent channel a prompt-injected agent cannot reach. Never asked, never overridden.
2. **The sole reachable project** — if exactly one mapped project answers `/api/health` with its own instance id, that is the one. Starting a server is a human action the agent has no way to perform (it has no shell; its only reach is HTTP to something already running), so this is **consent by action** and needs no prompt. It is also the whole plug-and-play case: one local project, nothing configured.
3. **Otherwise refuse and name the candidates.** Guessing between two running projects is how "which site am I editing" becomes a question nobody can answer from the outside.

A probe is cached for 5s, so a burst of tool calls does not re-probe every project, and a project started mid-session is picked up within a call or two — **no restart to switch projects**.

**When either side carries no instance id, identity is settled by the TOKEN, not waved through.** "A missing id is never a mismatch" is right for an old SERVER and wrong for an old ENTRY: every entry written before ids existed says `:4174`, because that was the only default there was, so each one matched whatever project held that port — five dead projects reading as one running instance, the ambiguity the map exists to end. A token is minted into ONE data dir, so an instance that **accepts** it is that project as surely as the id says so. Only a plain 401 is a no; a PENDING token is this instance's token already (the scaffolder mints one before the admin exists), and a 403, a 404 from an older build or a 5xx is not an answer about identity and must not exclude a project that is plainly up. This is also what turned a port the project had drifted off into a bare 401 reading as "your token is dead" — the report that opened the bug.

**The refusal distinguishes "nothing answered" from "something answered and is not you."** `identifyEntry` returns `{ok, answered, why}` rather than a boolean, and `resolve()` reports the second case as a stale entry naming the instance it saw. One sentence, and it is the whole difference between a two-minute reconnect and an afternoon: the old message said "none of the configured projects is running — start one with `guano dev`" to someone whose server was running, healthy, and answering the probe, so every fix attempt went looking for a dead server that did not exist. `identifyEntry` is shared with `guano disconnect --stale` deliberately — two implementations of "is this entry dead" would eventually disagree about what to delete.

## Removing a project: `guano disconnect`

`packages/guano/mcp/disconnect.mjs`. The map had no remove. `connect` adds a key and folds legacy ones in, and that was all of it, so a project that was deleted, rebuilt, renamed or moved to another port stayed in `GUANO_PROJECTS` forever. The only way out was to hand-edit `claude_desktop_config.json` — **which Claude Desktop rewrites from memory on quit**, so the edit silently reverts and the next attempt is a bigger hand-edit. That is the loop: ten entries, nine dead, nothing in the file saying which one is real.

`--list` prints every entry with a live verdict (live / stale / down). Bare, it removes the project in the current folder. `<slug>` removes one by name. `--stale` removes the ones `identifyEntry` can DISPROVE.

Two rules. **It never removes an entry it cannot disprove** — a project that simply is not running this minute is indistinguishable from one that no longer exists, and deleting the first costs a token the user has to re-mint; only an address that ANSWERS, as somebody else or refusing the entry's own token, is proof. And **the folder's own entry is matched by identity, never by slug**: first the instance id, then by hashing each entry's token against this data dir's `api-tokens.json` — offline, so it works for a project that is down or whose port somebody else holds, and it is the only thing that can address the id-less entries the bug above produced. No match prints the candidates instead of guessing. It takes the same quit guard as `connect`, because a removal that silently reverts is worse than one that refused.

Per-project session state — the write target, the compare-and-swap baseline, a translation worklist handle — is **dropped when the live project changes** (`syncProject` in `tools.mjs`). All three are addresses into one project's blob, and carrying any of them across a switch means a write built on project A's bytes landing in project B.

## The MCP client serves while nothing is running

`main()` used to `process.exit(1)` whenever it could not reach the instance. The process died before the MCP handshake, so the client could only report "could not connect" — which is the alert above.

An unreachable instance is **`status === 0`** from `api.mjs` and nothing else, which is what makes the two cases separable. Not running: log it and serve, and let the first tool call say which project to start. A revoked token, a pending setup, or the wrong project on the port: still exit loudly, because those are states a human has to fix and failing quietly would hide them behind tools that 401 one at a time.

## Connecting a remote instance

`guano connect --url https://studio.example.com`.

Everything the local flow does to prove it may mint a token touches the data dir — the nonce file `/api/auth/connect` reads back, and the direct write `--offline` falls back to — and that route is **loopback-only** besides. Neither is possible from another machine, so a VPS could not be connected at all.

**The remote stand-in for "I hold the data dir" is "I can sign in to this instance's `/admin` as an admin."** That is a device authorization (`server/device.mjs`): the CLI asks for a short code, prints it and opens the browser, the human approves it at `/admin/authorize` where they are already signed in, and the CLI polls until it can collect the token.

Four endpoints. `POST /api/auth/device` and `POST /api/auth/device/token` are **unauthenticated**, because they are the calls made before any credential exists; the device code is the secret, compared in constant time and **spent on first success**. `GET /api/auth/device/:code` and `POST …/approve` are **admin + session only** — an API token must never be able to approve one, or an agent could authorize another client to the instance it is already talking to.

The pending record lives **in memory**, for ten minutes, capped at a dozen. There is nothing worth persisting in a single-use ten-minute secret, and keeping it off disk means no file for the boot sweep, the retention timer or a snapshot to carry. A restart loses pending codes and the CLI reports the expiry it would have reported anyway.

The user code avoids `0/O/1/I/5/S` because it is read off one screen and typed into another. The start endpoint is rate-limited per address and the lookup harder still — the short code is the only guessable surface in the flow. The poll interval is enforced server-side (`429` with `retry-after`, which the CLI waits out rather than giving up).

**The consent screen is where a remote connect picks the agent policy** — the same two switches the local flow takes as `--main`/`--publish`, asked in a UI that explains them. That is better than a flag, and it is also why a remote connect accepts neither.

`--token guano_…` remains the escape hatch, and the only option for a headless runner with no browser to approve anything in. Either way `--url` must be `https:` (plain `http:` only for localhost), because the token travels on every request. Identity comes from `/api/health` and the project name from `/api/auth/me`.

Note that **the data-dir rule below does not apply to a remote entry**: it exists to stop `connect` probing a *default port* and baking whatever answers into this project's entry. A remote url is named explicitly by the human, so the address is the contract and health is the only identity source there is.

## The data dir is the authority on identity, never the port

`readIdentity` in `mcp/connect.mjs`. Probing an address first is the same bug one layer up: with no `GUANO_URL` set, `connect` would read health off 4174, find whichever project won it, and bake ANOTHER project's id and address into this project's entry — connecting Claude to the wrong site while reporting success.

So it reads `instance.json` first, and consults a running server only to confirm it is the same instance (then the live port wins) or to learn an address for a dir with no record yet. An explicit `GUANO_URL`/`PORT` is a contract and still wins.

**`connect` resolves the data dir the way the server that will run does** — an explicit `GUANO_DATA_DIR`, then `<cwd>/data`, then `<cwd>/server/data`, and only then the packaged default — and **pins `GUANO_DATA_DIR`** for every server module it then loads, because `util.mjs` reads it once at import time and `agent-policy.mjs` derives its own file from that.

Imported from `packages/guano/`, `util.mjs` resolved to `packages/guano/server/data`, a directory a repo clone's `npm run serve` never reads: the nonce landed there, the server looked in `<repo>/server/data`, and connect died with `nonce mismatch — run guano connect from the instance machine`, which is the one thing that was never wrong. That refusal now names the directory the server actually reads.

## `.env` is loaded by the CLI

`process.loadEnvFile` in `bin/guano.js` — Node's own, so the zero-dependency rule holds. Nothing read it before, so the `PORT` the scaffolder documented was inert; a real env var still wins, since `loadEnvFile` does not overwrite.

`npm create @useguano` now picks a **free port**, stepping by two because a site needs its preview port above it, and writes a real `.env` with it — so a new project's address is an explicit, non-colliding fact in a file the user can read.

Coverage: `e2e/instance-identity.spec.ts` — the stable id, the remembered port reclaimed while the default is still held, the two refusals, and two projects connecting without evicting each other.

## `boot()` runs before the socket accepts anything

That ordering is the point: the one-way v2 migration used to run inside an `async` listen callback nobody awaited, so the server was already serving while blobs were rewritten under it, outside the per-key lock.

A throw in `boot()` refuses to start rather than serving an unmigrated store. The EADDRINUSE port walk lives inside `listenWalking`'s promise so no retry can re-enter boot, and `BOOT_TIMEOUT_MS` logs the stalled stage rather than leaving a silent hang.

## SIGTERM drains

`installShutdown` stops accepting, ends the SSE change feed — those responses never finish on their own, so `server.close()` would wait out the whole deadline on connections working exactly as designed — then waits on in-flight requests and on `withCritical` sections under **two** deadlines: a request and an export are different obligations, and cutting an export between its two renames is what leaves no live site at all.

Critical sections are a Set, not a counter, so a slow drain names what it is waiting on. A second signal exits `128+signum`. A signal during boot lets the current blob finish, since `migrateSchema` is idempotent and the next boot resumes.

## `GET /api/health`

The one unauthenticated `/api` route, since a probe carries no credential — which constrains it: no path, no user count, no secret, no store parse (`published.json` is hundreds of KB) and no probe file written (that is the debris the boot sweep exists to clear).

503 only for draining and an unwritable data dir. An empty store is 200 `degraded`, or a fresh instance could never come up behind a load balancer.

## Logging goes through `server/log.mjs`

Levels, `LOG_LEVEL`, `LOG_JSON=1`, and `log.banner` for the startup box — a timestamp in front of an ASCII box is worse, and under JSON it would be mangled.

Every response carries `x-request-id`, one access line per request at `info`, and both catch-alls put that id in the body and honour `err.expose`. **Never add a bare `console.*` to `server/`.**

## The staging primitives live in `server/util.mjs`

`swapDir` ROLLS BACK: it renames live aside then staged in, and a failing second rename used to leave no live directory at all.

`withStagingDir` cleans up in a `finally`, which the export and the package import both lacked — any throw stranded a full copy of the site forever.

`writeAtomic` fsyncs and uses a per-process tmp name: two writers shared one `${file}.tmp` and the loser's rename ENOENT'd into an empty catch.

`sweepStaleDirs` / `sweepOrphanTmpFiles` collect the debris at boot, **age-gated at an hour** — two instances CAN share a data dir (the documented port-walk case), so a young staging dir may belong to a live publish. The base list is exact: `store.pre-v2` is the only way back from the migration.

## Retention

One daily timer: form submissions, snapshots (newest N, floored at 1) and the media variant cache — the last by **atime**, because a cache hit is a read, so an mtime policy would evict exactly the files every publish uses.

A snapshot above `SNAPSHOT_MAX_BYTES` is refused, because `createZip` builds in memory.

`buildPackage` leaves the variant cache out, and `applyPackage` accepts it anyway for the backups already on disk — it rejected them outright, so any instance that had published a resizable raster had unrestorable snapshots.
