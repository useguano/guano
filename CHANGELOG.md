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

### Added

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
