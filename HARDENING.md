# Production hardening — working checklist

Branch: `hardening/production-readiness`

Tick a box when the step is committed and the gates named in its row are green.
Steps are ordered so every one leaves the tree green on its own.

**Gates, run after every step:**

```sh
npm run type-check
npm run check:mcp && npm run check:migrate && npm run check:html && npm run check:corpus
npm run build
npx playwright test            # needs a prior build; 359 tests today
```

`check:corpus` is the referee for anything touching the export. A byte of HTML
difference is a bug. The only legitimate diff is a runtime asset that was
deliberately rebuilt.

---

## Corrections found during design review

Five findings changed the approved plan. They are folded into the steps below.

1. **A live key bug, worse than the one we set out to fix.** `persist()` re-reads
   `projectStorageKey(activeBranchId.value)` *after* its awaits, while
   `persistMerged()` captures the key *before* them. So a save in flight across
   a branch switch reads the right key and writes the wrong one: the branch you
   just opened gets overwritten with a merge of the branch you left. The fix is
   to pass the key explicitly, which is also what makes the `resetTo` split
   correct rather than merely tidier. Step **B-3**.
2. **The one-process assumption is false.** CLAUDE.md documents the opposite: two
   instances sharing a data dir is the port-walk scenario it warns about. So the
   boot sweep must be age-gated, or it can delete the staging directory of a
   publish another process is mid-way through. Step **A-2**.
3. **`swapDir` needs rollback, not just cleanup.** It renames live aside, then
   staged in. If the second rename throws, the live directory is simply gone. A
   `finally` that removes the temp dir does not address this. Step **A-2**.
4. **Excluding media variants from backups is not enough.** Every snapshot
   already on disk contains variant entries that the import allowlist rejects,
   so a fix that only changes the writer leaves existing backups permanently
   unrestorable. Both halves are required, and the variant hash is 12 characters,
   not 16. Step **A-10**.
5. **Server-side closing needs an SSE hook.** `eventClients` holds long-lived
   responses that never end on their own, so `server.close()` would hang for the
   whole deadline without a hook that ends them first. Step **A-4**.

Two smaller ones: `replaceFromRemote` already *is* the adopt-without-writing
function, so it gets renamed rather than duplicated (**B-5**); and a `pagehide`
keepalive flush is impossible anyway, because keepalive caps a request body at
64 KB and a project blob is 216 KB (**B-8**).

---

## Phase 1 — Server lifecycle

- [x] **A-1 Logger.** New `server/log.mjs`: levels, ISO timestamp, `LOG_LEVEL`,
      `LOG_JSON=1`, `log.banner()` for the startup box, `newRequestId()`. Keeps
      existing message text verbatim so later migration is a one-token rename.
      *Nothing imports it yet, so this step cannot break anything.*
- [x] **A-2 Atomic primitives.** `server/util.mjs`: move `swapDir` in **with
      rollback**, add `withStagingDir`, `sweepStaleDirs` and
      `sweepOrphanTmpFiles` (both **age-gated**, default 60 min). Unique tmp name
      in `writeAtomic` plus an `fsync`, opt out with `GUANO_FSYNC=0`.
      The sweep regex must never match `store.pre-v2` — that is the only way back
      from the one-way migration.
- [x] **A-3 Self-cleaning swaps.** `server/export.mjs` adopts `withStagingDir`;
      `server/index.mjs` drops its local `swapDir`; `applyPackage` gets its
      `finally`. **Watch the write-path backstop** around `export.mjs:1832` — it
      is a security control, and moving ~70 lines into a callback is where it
      would silently stop working.
      *Gates: `check:corpus`, `export-images`, `export-structured-data`, `smoke`.*
- [x] **A-4 Shutdown.** New `server/lifecycle.mjs`: `beginRequest`,
      `withCritical`, `installShutdown`, `isShuttingDown`. Wrap publish, preview,
      `applyPackage`, `buildPackage` and `withStoreKeyLock`. Close SSE clients
      before closing the servers. Separate request and critical deadlines.
      Second signal forces exit.
- [x] **A-5 Boot order.** Split into `boot()` / `listenWalking()` / `main()` /
      `printBanner()`. The one-way migration finishes **before** the socket
      accepts. The port walk moves into a promise so no retry can re-enter boot.
      Add a boot watchdog that logs the stalled stage.
      *Gate: `smoke` — it is the only spec that depends on first-run boot order.*
- [x] **A-6 Health.** `GET /api/health` first in the chain after the public forms
      namespace. No auth, no store parse, no data-dir path in the body. 503 while
      draining and when the data dir is unwritable; 200 degraded for an empty
      store or a missing preview port, so a fresh instance can come up behind a
      load balancer. Covered by `e2e/lifecycle.spec.ts` rather than a file of
      its own — it needs the same spawned server.
- [x] **A-7 Logging migration, index.mjs.** 22 call sites to `log.*`, two to
      `log.banner()`. Add the request id to the 500 body and teach both
      catch-alls the `err.expose` convention the publish path already uses.
- [x] **A-8 Logging migration, rest.** `export-media.mjs`, `media.mjs`,
      `public/deliver.mjs` — six lines.
- [x] **A-9 Retention.** New `retention` namespace in `readPublishConfig`
      (separate from `forms`, which is a data-protection obligation, not disk
      housekeeping). `pruneSnapshots` keeps N newest with a floor of 1;
      `pruneVariantCache` evicts by **atime**, since a cache hit is a read and an
      mtime policy would evict exactly the files every publish uses.
- [x] **A-10 Snapshot restore bug.** `buildPackage` stops bundling the variant
      cache **and** `applyPackage` accepts variant entries anyway, for the
      backups already on disk. Unknown paths under `media/` are skipped with a
      log line instead of failing the whole restore; anything outside
      `store/`, `media/` and `manifest.json` still hard-rejects.
      *Gate: extend `store-snapshots` to publish a raster first, so the spec stops
      passing vacuously. Lift `pngDataUrl` out of `export-images` into the
      fixtures.*
- [x] **A-11 Lifecycle spec.** New `e2e/lifecycle.spec.ts`, spawning its own
      server on a scratch port: SIGTERM exits 0, an in-flight request still
      completes, two signals exit non-zero, an old temp dir is swept and a fresh
      one survives.

## Phase 2 — Security boundaries

- [x] **S-1 Store keys.** Known-key allowlist for every role, and an
      authoritative merge for `guano-branches` so a contributor cannot restamp
      `createdBy` and delete other people's drafts. Put the DELETE branch inside
      `withStoreKeyLock` — it is the one store mutation outside it today.
      *Gates: `store-roles`, `store-agent-security`.*
- [x] **S-2 Unlock handler.** Use the proxy-aware `clientIp` so ten bad guesses
      stop locking out every visitor; reject `\` in the redirect exactly as
      `site-runtime.js` already does; move the per-attempt scrypt off the event
      loop. Raise the minimum from 4 to 8 characters.
      *Gate: `store-site-password`, which already asserts the `//` case.*
- [x] **S-3 scrypt.** Optional `kdf` on the user record and on `cfg.site`;
      verify with the record's own parameters, defaulting to the legacy
      `N=16384`; new passwords at `N=131072` with `maxmem` raised; rehash on a
      successful login. Cap passwords at 256 characters.
      **Assert the legacy fallback before changing the cost**, or every existing
      password stops verifying.
- [x] **S-4 Preview token.** `POST /api/preview` mints a short-lived HMAC; the
      preview server exchanges it for a short-TTL cookie and 401s otherwise.
      Give the preview form handler its own limiters so flooding it cannot spend
      the live site's submission budget.
      *Gate: extend `store-preview` — anonymous access to that port is currently
      unasserted.*
- [x] **S-5 SSRF.** Replace the string prefix checks in `server/net-guard.mjs`
      and the deliberate duplicate in `packages/guano/mcp/tools.mjs` with
      `node:net` BlockList, covering IPv4-mapped, NAT64 and site-local v6.
      *Gate: add the literals to the refusal list in `mcp-tools-security`.*
- [x] **S-6 Role gates.** Publish-config and site-password become admin-only,
      matching agent-policy. Rate-limit before buffering auth bodies, cap them at
      4 KB, add `no-store` and a referrer policy to `/api`, cap SSE clients per
      user.
- [x] **S-7 Auth persistence.** Log every swallowed write failure and return 500
      from the create and invite paths, so a user or token cannot succeed in
      memory and vanish on restart.
- [x] **S-8 Dependencies.** `npm audit fix` clears all seven. Bump the MCP SDK to
      1.32.1 and confirm `sharp` lands on 0.35.5 — it is the only one of the
      seven in a real request path.

## Phase 3 — Editor robustness

- [x] **B-1 Ack sequence.** `src/lib/store.ts`: per-op `seq`, per-key acked
      high-water mark, a `storeAck` tick and `ackedSeq()`. `storeSet` stays
      synchronous and returns the seq, so no caller changes.
- [x] **B-2 Error text.** Read the server's `{error}` body; classify retryable
      (network, 5xx, 429, 412) against terminal (400, 403, 404, 507); drop a
      terminal op instead of retrying it forever. Fix the 401 path that returns
      before clearing `inflight` and pins `pendingWrites` above zero.
- [x] **B-3 Key-tagged baseline.** `persist(snapshot, key)`, a baseline tagged
      with the key it belongs to, a pending baseline promoted only on ack, and a
      write generation guard. **This is correction 1** — the branch-switch
      write-to-wrong-key bug.
- [x] **B-4 Undo through merge.** `apply` routes through `persistMerged`, which
      rewrites `history[pointer]` **in place** when the call came from history,
      instead of truncating the redo arm. No write at all while autosave is
      suspended for an agent run.
      *Gate: a new concurrent-undo assertion in `store-concurrency`; land them
      together.*
- [x] **B-5 resetTo split.** Rename `replaceFromRemote` to `adoptRemote` and use
      it for create-branch and switch-branch; add `commitReplacement` for
      merge-into-Main and have it return the snapshot actually stored, so the
      kept draft's merge base cannot disagree with the new Main. Delete
      `resetTo`.
- [x] **B-6 Publish ordering.** `commit`/`saveNow` return their promise;
      `usePublish` awaits the save and the flush and refuses to publish while
      `storeError` is set; `switchBranch` and `previewMerge` await too.
- [x] **B-7 Notices.** New `useNotice.ts`, `NoticeHost.vue` (z-115, above the
      tooltip host, bottom-centre so it clears both canvas corners) and
      `errorReporting.ts` wired to `app.config.errorHandler`,
      `unhandledrejection` and `storeError`. First `aria-live` region in the app.
      Add the new rung to CLAUDE.md's z-index ladder.
- [x] **B-8 Unload guard.** `hasUnsavedWork` derived from the existing save
      status so it can never disagree with the pill the user is looking at; a
      conditional `beforeunload`; a `pagehide` `saveNow()`; and a deliberate-
      navigation flag so logout and the 401 bounce never prompt.
      *No direct gate is possible — Playwright dismisses the prompt. Noted
      honestly rather than papered over.*
- [x] **B-9 uid helper, lib.** New `src/lib/shared/ids.js` with a
      `getRandomValues` fallback for non-secure contexts, then the 14
      bundle-reachable call sites. **Rebuild and commit the MCP runtime bundle in
      the same commit.**
- [x] **B-10 uid helper, rest.** The remaining ~31 call sites in composables and
      components. Add a convention line to CLAUDE.md and a CI grep, since there
      is no linter to enforce it.
- [x] **B-11 Accessibility, minimal.** Dialog semantics, focus trap and focus
      restore in `ModalHost`; `alertdialog` and initial focus in `ConfirmModal`;
      an accessible name on the modal close button; `aria-live` on the save pill;
      `aria-describedby` and keyboard reachability for tooltips.
      New `e2e/ui-a11y.spec.ts`.

## Phase 4 — Infra, docs, release

- [x] **I-1 Docker.** `Dockerfile` on `node:22-slim`, non-root, `/data` volume,
      `HEALTHCHECK` against `/api/health`. Plus `.dockerignore` and a
      `compose.yaml` showing the volume, `TRUST_PROXY` and a TLS-terminating
      proxy. **Not built here** — no Docker daemon was running on this machine,
      so every path it copies was checked against the server's imports instead.
      Build it once before relying on it.
- [x] **I-2 CI.** `.github/workflows/ci.yml`: type-check, the three cheap checks,
      build, then Playwright. `check:corpus` runs only when `.corpus/inputs` is
      present, since it is local and gitignored.
- [x] **I-3 Docs.** Fix the package README's claims of a bundled component
      library, `npm create guano` and the two MCP tools that do not exist, and the
      seven real tools it omits. Drop "DSL editor" from the package description.
      Document `STORE_QUOTA`, `GUANO_PREVIEW_PORT`, `PORT_STRICT` and everything
      this branch adds. State that HSTS is the proxy's job and that
      `store.pre-v2/` is deletable once an upgrade is verified.
- [x] **I-4 Release.** `.nvmrc` and `CHANGELOG.md` are in. The tag waits for
      the branch to land on main — tagging a side branch would name a commit
      that is not what shipped.

---

## Manual checks no test covers

- `docker stop` during a publish leaves the live site intact and no `site.tmp-*`
  directory behind.
- A password created before S-3 still logs in, and is rehashed at the new cost.
- A snapshot taken before A-10 still restores after it.

## Deliberately out of scope

A streaming zip writer, applying human events for live multi-tab sync, the full
ARIA sweep of every primitive, DNS-rebinding pinning in the SSRF guards,
multi-process support, and admin internationalisation.
