# Roadmap: launcher auth, host-aware chrome, collaboration, server deploy

Four workstreams worked out in design on **2026-10-17**, in the order they came
up. Nothing here is built yet. Each one records what was decided, what the code
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

## Suggested order

1. **§1 + §2 together.** One change, and §2's `store.ts` re-mint is what keeps
   §1 from rotting. Smallest, highest certainty, unblocks the launcher.
2. **§4(b) install doc + snapshot verification.** Mostly writing, over machinery
   that already works, and it answers the question users actually ask.
3. **§3 step 1, presence only.** Then stop and watch before committing to the
   rest of Option A.
4. Everything else, on evidence.

## Still open

- **§4:** (a) or (b) first — or both? (b) is recommended.
- **§3:** is Option A's per-page ceiling acceptable, or is co-editing one page a
  real requirement? The answer changes the whole workstream.
- **§3:** does the launcher's "a tab is its server's lifetime" rule survive
  collaboration? If not, that decision comes before any sync work.
