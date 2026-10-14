# Instance identity and process lifecycle

<!-- Read this before touching server/instance.mjs, server/lifecycle.mjs,
     boot() or the CLI's connect path. CLAUDE.md points here. -->

## Which project a port is answering for

Several Guano projects on one machine all default to 4174, so the port names nothing — whichever instance boots first owns it, and an API token is minted into exactly ONE data dir.

A client configured for project A that reaches project B is answered with a **401 indistinguishable from a revoked token**. `guano mcp` exits on it before the MCP handshake, so the only thing the user is ever told is "MCP server not connected" while a valid token sits in a config file pointing at a live, healthy server. Nothing anywhere named the cause. Three pieces close it.

## `id` — opaque, minted once per data dir

Never changed. `/api/health` reports it, which is safe on the one unauthenticated route precisely because it is opaque: no path, no name, nothing derived from a secret, no store parse. The human-readable `name` is served only to an authed caller, on `/api/auth/me`.

`guano connect` bakes the id into the client entry as **`GUANO_INSTANCE`**, and `guano mcp` compares it against health **before presenting the token** (`instanceMismatch` in `mcp/server.mjs`), so the wrong project is refused by name — "expected instance b219e658, got 1dadfd6b" — instead of 401ing.

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

**`target` is per project.** It was one `GUANO_MCP_TARGET` for the whole entry; with several projects behind one entry, pinning Main for a landing page would have pinned it for a client's live site too.

What is lost: the project no longer appears in the tool name (`mcp__guano__get_page`, not `mcp__guano-landing__get_page`). `get_status` and the startup log name the live project instead.

## Which project is live

`packages/guano/mcp/projects.mjs`. **The agent must never be the one that decides which site it writes to** — a node id addresses one tree and a token is minted into one data dir, so a misdirected write is not a smaller version of the right write, it is an edit to someone else's site reported as success.

Resolution order:

1. **`GUANO_MCP_PROJECT`** — pinned in the entry's env. The human edited a config file, which is the one consent channel a prompt-injected agent cannot reach. Never asked, never overridden.
2. **The sole reachable project** — if exactly one mapped project answers `/api/health` with its own instance id, that is the one. Starting a server is a human action the agent has no way to perform (it has no shell; its only reach is HTTP to something already running), so this is **consent by action** and needs no prompt. It is also the whole plug-and-play case: one local project, nothing configured.
3. **Otherwise refuse and name the candidates.** Guessing between two running projects is how "which site am I editing" becomes a question nobody can answer from the outside.

A probe is cached for 5s, so a burst of tool calls does not re-probe every project, and a project started mid-session is picked up within a call or two — **no restart to switch projects**. A missing `instance` on either side is never a mismatch, for the same reason as above.

Per-project session state — the write target, the compare-and-swap baseline, a translation worklist handle — is **dropped when the live project changes** (`syncProject` in `tools.mjs`). All three are addresses into one project's blob, and carrying any of them across a switch means a write built on project A's bytes landing in project B.

## The MCP client serves while nothing is running

`main()` used to `process.exit(1)` whenever it could not reach the instance. The process died before the MCP handshake, so the client could only report "could not connect" — which is the alert above.

An unreachable instance is **`status === 0`** from `api.mjs` and nothing else, which is what makes the two cases separable. Not running: log it and serve, and let the first tool call say which project to start. A revoked token, a pending setup, or the wrong project on the port: still exit loudly, because those are states a human has to fix and failing quietly would hide them behind tools that 401 one at a time.

## Connecting a remote instance

`guano connect --url https://studio.example.com --token guano_…`.

Everything the local flow does to prove it may mint a token touches the data dir — the nonce file `/api/auth/connect` reads back, and the direct write `--offline` falls back to — and that route is **loopback-only** besides. Neither is possible from another machine, so a remote connect carries a token the human made in the editor (My account → API tokens) instead of minting one.

`--url` must be `https:` (plain `http:` only for localhost): the token travels on every request. Identity comes from `/api/health`, and the project name from `/api/auth/me`. The agent policy is that instance's own, set in its Settings → MCP, since the file lives in a data dir this machine cannot write.

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
