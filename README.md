# Guano

Guano is a self-hosted visual website builder. You build pages on a live canvas
with a layers tree — insert and arrange elements, style them with Tailwind classes,
add interactions, build reusable components and
CMS collections, translate into locales, leave comments, and work in drafts before
applying to the live site. Publishing compiles everything to a fully static site (plain HTML +
one CSS file + a ~1.5 KB runtime) that the built-in server hosts at `/` — or
ships as a zip, or pushes straight to a GitHub repo. The admin editor lives at
`/admin`; invite editors, contributors and reviewers with role-based access.

## Quickstart

```sh
npm create @useguano   # asks for a folder name, installs guano, connects Claude Desktop
cd my-site
npm run dev            # → http://localhost:4174
```

Or from a clone of this repo: `npm install && npm run build && npm run serve`.

Open `http://localhost:4174/admin`, create the first (admin) account, build,
publish. The published site is served at `http://localhost:4174/`.

The scaffolder also asks whether to connect **Claude Desktop** over MCP and the
two permissions a connected agent needs answered — may it edit the live
project, may it publish (both default no). It does the connect right there,
so after `npm run dev` and the admin account there is nothing else to set up:
open Claude and the agent is working. See [Working with an AI
agent](#working-with-an-ai-agent).

Requires Node `^22.18.0 || >=24.12.0`.

## Developing (two processes)

The admin SPA and the API are separate processes in dev — run both:

```sh
npm run serve   # terminal 1: API + publish + static site on :4174
npm run dev     # terminal 2: Vite dev server with HMR on :5173
```

Edit at `http://localhost:5173/admin` (Vite proxies everything outside `/admin`
— `/api`, `/media`, and the exported site at `/` — to :4174). `npm run
type-check` runs the only static gate (vue-tsc); `npm run test:e2e` runs the
Playwright smoke suite — it needs a prior `npm run build` (the e2e server
serves `dist/` on an isolated port and data dir).

## Deploying

The mental model: **Guano is the studio, the site is the product.** The editor
always lives wherever the Guano server runs; the published site is a portable
static export that can live on that same host or anywhere else. Pick one of two
topologies — both are fully supported, and the only difference is the publish
method you choose in Settings → Publish.

### Topology 1 — all-in-one

One host runs Guano and serves everything. Point the site's domain at it:
`yoursite.com` is the published site, `yoursite.com/admin` is the editor.
Publish method: **server** (the default — every publish refreshes `/` in place).

Best for solo builders and single-site owners: one host, one cert, zero extra
config. Trade-off: the site is up only while the Guano process is.

### Topology 2 — studio + static site

Guano runs on *your* infrastructure (`studio.youragency.com`); clients and
editors log in there. Publishing pushes the export to a GitHub repo (publish
method: **github** → Pages/Netlify/anything watching the repo) or hands you a
zip (**zip**) to drop on any static host. The client's domain serves the static
export; the studio host never appears on it.

Best for agencies and client work: the site gets CDN speed and survives the
studio being down, and auth/data stay per-instance on your box. The export is
fully portable (root-absolute URLs, plain HTML + one CSS file + a ~1.5 KB
runtime).

One setting matters here: if the site uses **forms**, set **Settings → Publish →
Studio URL** to this instance's public address (`https://studio.youragency.com`).
The static pages are files on someone else's host, so a submission posts back to
the studio, which validates and stores it. The studio only accepts a submission
from the site's own domain (Settings → General → Domain), and never with
cookies. Leave it empty in topology 1 — there the site and the studio are the
same host.

### Either way

The editor needs a **persistent Node process with a writable disk** — a VPS,
Railway, Fly.io, Render, etc. **It cannot run on Vercel/Netlify or any static
host** — only the published site can. On platforms with ephemeral filesystems,
mount a volume and point `GUANO_DATA_DIR` at it, or your users, media, and site
vanish on redeploy.

```sh
npm ci && npm run build
NODE_ENV=production PORT=80 node server/index.mjs
```

There's no Dockerfile yet, but the recipe is exactly the three lines above on a
`node:22` base (install, build, run; declare a volume for the data dir).

Rules that hold in every topology:

- **One instance = one project = one site.** An agency with five clients runs
  five instances (five data dirs behind one reverse proxy, or five containers).
  That's deliberate — auth, content, and backups are isolated per client.
- **Server-backed features need the studio reachable.** Form submissions, the
  mail they send and any webhook forward all run on the Guano process. A site
  with no forms needs nothing beyond the static files.
- **Behind a reverse proxy (nginx, Caddy, a PaaS router), set `TRUST_PROXY=1`**
  so login rate limiting sees real client IPs from `X-Forwarded-For` instead of
  lumping everyone under the proxy's address. Never set it without a proxy in
  front — the header is client-spoofable.
- **HTTPS is required for real use** (the session cookie is `Secure` by
  default); terminate TLS at the proxy or platform.
- **Laptop mode is valid** — run Guano locally and publish via zip/github. The
  moment a client needs to log in, the instance moves to a public host; that's
  the line.

## Running it

### Docker

```sh
docker build -t guano .
docker run -d --name guano -p 4174:4174 -v guano-data:/data guano
```

`compose.yaml` is the same thing with a volume, a restart policy and a grace
period long enough for an export to finish. The image declares a healthcheck
against `/api/health`, which reports `stopping` while the server drains, so an
orchestrator moves traffic off before the socket closes rather than racing it.

### Health

`GET /api/health` is the one unauthenticated `/api` route — a probe carries no
credential. It answers 200 when the instance can serve and 503 when it cannot
(draining, or an unwritable data dir); an empty store on a first run is 200
`degraded`, so a fresh instance still comes up behind a load balancer. It
reports no path and no secret.

### One process per data dir

Every lock, rate limiter, session map and cache is in-process. Two Guano
processes sharing one `GUANO_DATA_DIR` will disagree about all of them — run
one, and scale by running more instances with their own data, not more workers
over the same one.

### Shutting down

`SIGTERM` stops accepting, lets work that has already started finish, then
exits. A publish builds into a staging directory and renames it over the live
one, so a kill between those renames is what leaves a site with nothing in it.
A second signal exits immediately. Give the process ~45s to stop.

### The preview port

`PORT + 1` serves the preview site, which renders UNPUBLISHED pages. It is
token-gated — the url `POST /api/preview` returns carries a signed token, good
for an hour; the first request with it is answered directly and sets a cookie
for the rest, so a plain `fetch` or an agent can read the page too — but do not
publish the port unless you need to reach previews from another machine. A
bare `http://localhost:4175/` answers "preview link missing or expired": open
a fresh preview from the editor or the `preview` tool and use the whole url.

### HSTS

Terminate TLS at the proxy, and set `Strict-Transport-Security` there. Guano
does not send it: the header belongs to the origin as a whole, including
whatever else that hostname serves.

## Keyboard shortcuts

Both surfaces (Edit and Play):

| Key | Action |
|---|---|
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘S` | Save now |
| `⌘P` | Publish |
| `C` | Comment mode — then click where the comment goes |

Edit only:

| Key | Action |
|---|---|
| `⌘E` | Insert dock |
| `⌘⇧E` | Effects drawer |
| `⌘C` / `⌘X` / `⌘V` | Copy / cut / paste elements |
| `⌘D` | Duplicate |
| `⌘G` | Wrap in a div |
| `Backspace` | Delete |
| `⇧↑` / `⇧↓` | Move the selection one slot |

The canvas (page canvas and components board):

| Key | Action |
|---|---|
| `⌘+` / `⌘-` / `⌘0` | Zoom in / out / reset |
| Hold `Space` + drag | Pan |
| `⌘`+wheel, or pinch | Zoom |

The layers tree, while it has focus:

| Key | Action |
|---|---|
| `↑` / `↓` | Walk rows |
| `→` / `←` | Expand or step in / collapse or step out |
| `⌘⇧↑` / `⌘⇧↓` | Extend the selection |
| `S` / `D` / `I` | Style / Data / Interactions, with the panel's first field focused |
| `Enter` | Rename the row's ref |

`Escape` peels one layer per press: a pending target pick, then the insert dock
or the effects drawer, then an open panel (focus goes back to the tree), then a
drawer's search or detail pane. It never closes a docked column.

On Windows and Linux, `⌘` is `Ctrl`.

## Working with an AI agent

Guano ships an MCP server (`guano mcp`) that lets an agent read and write the
same project the editor does — pages as a strict HTML subset, components,
collections, interactions, animations, translations — through the authed HTTP
API with a `guano_` token. The agent handbook it serves is
`packages/guano/mcp/GUIDE.md`.

`npm create @useguano` connects Claude Desktop for you: it mints the token into
`./data`, writes the two permissions beside it, and writes the `mcpServers`
entry into Claude's config (quit Claude first — it overwrites its config from
memory on quit; the scaffolder waits if it is open). The token is **pending**
until the admin account is created at `/admin`, which binds it, and the setup
form shows the permissions you chose instead of asking again. When Main is
allowed the config also carries `GUANO_MCP_TARGET=main`, so the agent never
asks "Main or a draft?".

Everything an agent may do is **off by default** and server-enforced,
whatever the agent claims a human approved: write Main (otherwise it works in
a draft you apply yourself), publish (otherwise it can still preview), ship
custom code, read form submissions. Change any of them in **Settings → MCP →
Agent permissions**. To connect later, or another machine running the
instance: `npm run connect` (`--main` / `--publish` answer the questions,
`--print` emits the snippet for any other MCP client). Details and the manual
setup for other clients are in `packages/guano/README.md`.

## Backup

Everything lives in the data dir (default `server/data/`): `store/` (projects,
drafts), `media/`, `users.json`, `sessions.json`, `site/` (the current export).
**Backup = copy that directory.** Settings → Backup → Snapshots keeps the same
package on the server; the newest ten are kept.

`store.pre-v2/` is a copy taken before the one-way v2 schema migration. It is
never pruned, and it is safe to delete once an upgrade is verified. For project content + media only, Settings →
Export project downloads a portable `.zip` you can re-import elsewhere.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4174` | server port |
| `GUANO_DATA_DIR` | `server/data` | data location — absolute path; set this on any real deploy (`SB_DATA_DIR` still works, deprecated) |
| `COOKIE_SECURE` | `1` (Secure on) | session cookie `Secure` flag; set `0` only for plain-HTTP LAN/dev setups (localhost works with the default) |
| `TRUST_PROXY` | unset | set `1` **only behind a reverse proxy** — rate limiting then keys on the last `X-Forwarded-For` hop instead of the socket address |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes via `Authorization: Bearer` |
| `MEDIA_QUOTA` | 2 GiB | media library size ceiling, in bytes |
| `STORE_QUOTA` | 512 MiB | project storage ceiling, in bytes |
| `SNAPSHOT_MAX_BYTES` | 512 MiB | refuses a snapshot above this — the zip is built in memory |
| `PORT_STRICT` | unset | `1` refuses to walk to the next free port when `PORT` is busy. Worth setting on a real deploy: a silent walk means everything addressing the default port reaches something else |
| `GUANO_PREVIEW_PORT` | `PORT + 1` | the preview site's port |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. `warn` drops the per-request access line and keeps the warnings |
| `LOG_JSON` | unset | `1` emits one JSON object per line, for a log shipper |
| `SHUTDOWN_GRACE_MS` | `0` | how long to keep answering health checks as draining before the socket closes. Set it behind a load balancer so traffic moves off first |
| `SHUTDOWN_DRAIN_MS` | `10000` | how long to wait for in-flight requests |
| `SHUTDOWN_CRITICAL_MS` | `30000` | how long to wait for a publish, preview, restore or store write to finish |
| `GUANO_FSYNC` | `1` | fsync every data write before the rename; `0` trades durability for throughput |
| `GUANO_STALE_AGE_MS` | 1 hour | how old a leftover staging directory must be before boot sweeps it |
| `BOOT_TIMEOUT_MS` | `60000` | logs a line naming the stage if boot has not finished; it never gives up |

## License

Guano is [AGPL-3.0](LICENSE): self-hosting it — for yourself or for clients — carries
no obligations; offering a *modified* Guano to others as a network service requires
sharing your modifications with those users.

**Your exported sites are entirely yours.** The AGPL never touches the sites Guano
produces, and the small runtime scripts embedded in them (`assets/script.js`,
`assets/motion.js`, `assets/slider.js`) are deliberately MIT-licensed so no copyleft question can ever
attach to a published site — see [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md).
