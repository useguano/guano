# Changelog

## Unreleased

### Fixed — data loss

- **A publish killed mid-swap left no site at all.** The exporter builds into a
  staging directory and renames it over the live one; `docker stop` between
  those two renames removed the live site and put nothing back. The server now
  drains on SIGTERM, and the directory swap rolls back rather than leaving the
  live copy gone.
- **A save in flight across a branch switch wrote to the wrong key** — the
  draft you had just opened was overwritten with a merge of the one you left.
- **Undo reverted another writer's work.** Cmd+Z wrote this tab's whole
  previous snapshot with no re-read, so anything an agent or a second session
  had changed since vanished, while the save pill read Saved.
- **A snapshot taken after a publish could not be restored.** Backups bundled
  the exporter's resize cache, which the import then refused by name, failing
  the whole restore. Both halves are fixed, including for backups already on
  disk.
- **Closing the tab mid-autosave dropped the edit** with nothing said.
- **A created user, invite or API token could vanish on restart.** The four auth
  writers swallowed their errors, so on a full or read-only disk they succeeded
  in memory and answered 200.

### Fixed — security

- **A contributor could take over and delete another person's draft** by
  rewriting the draft index, which was not covered by the content merge.
- **The preview port served every unpublished draft to anyone who reached it.**
  It is now reachable only through the signed link the editor is handed.
- **The private-site rate limiter ignored `TRUST_PROXY`**, so behind a proxy ten
  wrong guesses locked every visitor out of the site.
- **An open redirect after unlocking a private site** (`next=/\evil.test`).
- **The outbound request guard missed every IPv6 spelling of a private
  address**, including `[::ffff:127.0.0.1]`, which reached a real connection.
- **Editors could overwrite the GitHub token and the site password.** Both are
  admin-only now; reads, which carry no secret, stay open to editors.
- Password hashing raised to the current OWASP cost, with per-record parameters
  so existing passwords keep working and migrate as people sign in.
- Seven dependency advisories cleared, one of them critical.

### Fixed — agents

Everything below came out of one agent session building a site over MCP.

- **An element with an "open" and a "close" load timeline was primed visible.**
  The baked first frame took whichever binding was listed last; it now takes,
  per property, the binding that starts first — one shared rule for the
  exporter, the published runtime and the canvas.
- **Replacing markup adopted the old node's bindings onto a renamed ref.** A
  node whose `data-ref` differs from the candidate's is never adopted by
  position any more, and every write reports the positionally-adopted nodes
  that still carry bindings as `carriedBindings`.
- **A background colour and a background image evicted each other.** `bg-*`
  classes are grouped by what they set — colour, image, size, position,
  attachment — instead of one group; gradient directions (`bg-linear-to-*`),
  `bg-fixed`/`bg-local`/`bg-scroll` and bare arbitrary properties
  (`[mask-image:…]`) are accepted.
- **The preview link answered "open this preview from the editor" to anything
  without a cookie jar.** The token hit now serves the page directly and sets
  the cookie in the same response, so an agent can look at its own preview.
- `get_page {elements: "refs"}` ignored `includeInteractions`; an instance
  part is addressable by its HTML tag (`p`) as well as its type (`paragraph`);
  a `count` track no longer needs a placeholder `to`; `GUANO_MCP_TARGET` is
  honoured at startup instead of only after a `set_target` round trip.

### Added

- **`delay` on an animation binding** (ms), so one "pop-in" serves every beat
  of a sequence instead of a copy per offset. Every trigger but scrub; the
  forward play only. In the binding options and in `bindAnimations`.
- **Setup-time agent onboarding.** `npm create @useguano` asks whether to
  connect Claude Desktop and the two permissions a connected agent needs —
  edit the live project, publish — and does the connect before the server has
  ever run. The token is pending until `/admin` creates the admin, which binds
  it; the setup form shows the chosen permissions instead of asking again.
  `guano connect` gained `--main` / `--publish` / `--yes` / `--offline`, works
  before setup, and sets `GUANO_MCP_TARGET=main` when Main is allowed.
- `GET /api/health`, reporting `degraded` and `stopping` so a load balancer can
  drain an instance before it closes.
- Graceful shutdown with separate deadlines for requests and for long work.
- Structured logging: levels, `LOG_LEVEL`, `LOG_JSON`, and a request id in every
  response and every 500.
- Retention for snapshots and the media variant cache.
- A Dockerfile with a healthcheck, a compose example, and CI running every gate.
- An error surface in the editor: uncaught errors and refused saves now say
  what happened, with the server's own wording.

### Changed

- The one-way v2 schema migration finishes before the server accepts requests.
- Dialogs are real dialogs: named, announced, focus moved in and trapped,
  returned on close.
- `crypto.randomUUID` replaced throughout, so the editor works over plain HTTP
  on a LAN address instead of white-screening on the first insert.
