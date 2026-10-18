# Guano

Guano is a self-hosted visual website builder. You build pages on a live canvas
with a layers tree — insert and arrange elements, style them with Tailwind classes,
add interactions, build reusable components and
CMS collections, translate into locales, leave comments, and work in drafts before
applying to the live site. Publishing compiles everything to a fully static site (plain HTML +
one CSS file + a ~1.5 KB runtime) that ships as a zip, pushes straight to a
GitHub repo, or is hosted at `/` by the built-in server. The admin editor lives at
`/admin`; invite editors, contributors and reviewers with role-based access.

Guano is **launcher-first**: the way to run it on your own machine is the
**Guano Launcher**, a native macOS app that creates projects, runs their
servers, opens the editor and hosts the AI panel's Claude session — no terminal.
The same server runs headless on any Node host when a site needs an always-on
instance, and the Launcher connects to that instance too. A project is one
ordinary folder either way.

## Quickstart

**On a Mac:** open the Guano Launcher, choose **New project**, name it. The
Launcher scaffolds the folder, starts its server, opens the builder and offers
to connect Claude. Create the first (admin) account, build, publish. Projects
sit in the Launcher's home; a project you stop stays on disk and reopens where
you left it.

**From a terminal** (Linux, Windows, a server, or if you prefer it):

```sh
npm create @useguano   # asks for a folder name, installs guano, connects Claude Desktop
cd my-site
npm run dev            # → http://localhost:4174
```

Or from a clone of this repo: `npm install && npm run build && npm run serve`.

Open `http://localhost:4174/admin`, create the first (admin) account, build,
publish. The published site is served at `http://localhost:4174/`.

The scaffolder also asks whether to connect **Claude Desktop** over MCP — the
secondary path; the editor's own AI drawer needs no setup — and the two
permissions a connected agent needs answered — may it edit the live
project, may it publish (both default no). It does the connect right there,
so after `npm run dev` and the admin account there is nothing else to set up:
open Claude and the agent is working. See [Working with an AI
agent](#working-with-an-ai-agent).

Requires Node `^22.18.0 || >=24.12.0` (the Launcher bundles its own).

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
lives wherever the Guano server runs; the published site is a portable static
export that can live anywhere. Two questions decide the setup, in this order:
**where does the instance run**, and **where does the site live**.

### Default — studio on your Mac, site on a static host

The Launcher runs the instance on your machine. You build locally and publish
by pushing the export to a GitHub repo (publish method: **github** →
Pages/Netlify/anything watching the repo) or by downloading a zip (**zip**) to
drop on any static host. Nothing of Guano is on the public internet; the site
gets CDN speed and is up whether or not your Mac is. This is where every
project starts.

The export is fully portable (root-absolute URLs, plain HTML + one CSS file + a
~1.5 KB runtime). A site with no forms needs nothing beyond those files.

### When the instance moves to a host

Some things need the Guano process reachable at 9pm when your laptop is closed:

- a **client, contributor or reviewer** who logs in, comments, or is invited by mail;
- **form submissions**, the mail they send and any webhook forward;
- a **private site**, or publish method **server** (the host serves the site at `/`);
- an **agent on another machine** connecting over `guano connect --url`.

The moment one of those is true, the instance moves to a persistent Node host
and the Launcher connects to it (**Connect a remote instance…**) instead of
running it. Two shapes:

**Studio + static site.** Guano runs on *your* infrastructure
(`studio.youragency.com`); clients and editors log in there. Publishing stays
github or zip; the client's domain serves the static export and the studio host
never appears on it. Best for agencies: auth and data stay per-instance on your
box, the site survives the studio being down. If the site uses **forms**, set
**Settings → Publish → Studio URL** to the instance's public address — the
static pages post submissions back to the studio, which validates and stores
them, accepting only the site's own domain (Settings → General → Domain) and
never with cookies.

**All-in-one.** One host runs Guano and serves everything: `yoursite.com` is
the published site, `yoursite.com/admin` is the editor. Publish method:
**server** — every publish refreshes `/` in place. One host, one cert, zero
extra config; the site is up only while the Guano process is. Leave Studio URL
empty here — site and studio are the same host.

### On the host

The instance needs a **persistent Node process with a writable disk** — a VPS,
Railway, Fly.io, Render, etc. **It cannot run on Vercel/Netlify or any static
host** — only the published site can. On platforms with ephemeral filesystems,
mount a volume and point `GUANO_DATA_DIR` at it, or your users, media, and site
vanish on redeploy.

```sh
npm ci && npm run build
NODE_ENV=production PORT=80 node server/index.mjs
```

Or use the shipped `Dockerfile` and `compose.yaml` — see [Docker](#docker).

Rules that hold wherever the instance runs:

- **One instance = one project = one site.** An agency with five clients runs
  five instances (five data dirs behind one reverse proxy, or five containers,
  or five projects in the Launcher). That's deliberate — auth, content, and
  backups are isolated per client.
- **Behind a reverse proxy (nginx, Caddy, a PaaS router), set `TRUST_PROXY=1`**
  so login rate limiting sees real client IPs from `X-Forwarded-For` instead of
  lumping everyone under the proxy's address. Never set it without a proxy in
  front — the header is client-spoofable.
- **HTTPS is required for real use** (the session cookie is `Secure` by
  default); terminate TLS at the proxy or platform.

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
token-gated and served by the same server, at `/_guano/preview/` — so it rides
your studio's own host, scheme and certificate, and works unchanged behind a
proxy or on a VPS. The url `POST /api/preview` returns carries a signed token,
good for an hour; the first request with it is answered directly and sets a
cookie (scoped to that path) for the rest, so a plain `fetch`, an agent, or an
agent's browser can read, scroll and click the page. A bare
`/_guano/preview/` answers "preview link missing or expired": open a fresh
preview from the editor or the `preview` tool and use the whole url.

### HSTS

Terminate TLS at the proxy, and set `Strict-Transport-Security` there. Guano
does not send it: the header belongs to the origin as a whole, including
whatever else that hostname serves.

## Redirects

Renaming a page breaks the links other people made to the old path, so the
editor asks: change a slug and the page's settings offer a **301 redirect**
from where it used to live. Move a page onto a path that already redirects
somewhere and it says so, and offers to drop the rule.

The list lives in Settings → Site → **Redirects** (`/old-pricing` → `/pricing`,
or an `https://` URL). A **published page always wins** — a redirect from a path
a page answers on is ignored rather than hiding the page — a chain is collapsed
to one hop, and `/about → /contact` covers `/fr/about → /fr/contact` for free.
Each rule takes effect on the next publish.

On the node host each one is a real 301 (the query string rides along). A zip or
GitHub export ships a redirect page per source instead, because a static host
cannot answer a 301 of its own.

## Light and dark mode

A design token carries an optional **dark value** (Settings → Design → the moon
beside the colour), and that is the whole mechanism: `bg-background` is then
correct in both modes, and a retheme stays one token edit. `dark:` utilities are
there for what a colour cannot express — a border that disappears, an icon swap.

The switcher is a **link**: set an element's link to `@theme` (Data → Theme
switch) and clicking it flips the mode; `@theme:light` / `@theme:dark` pin one,
`@theme:system` hands it back to the visitor's OS setting. **Settings → Design →
Opens in** decides what a first-time visitor gets — light, dark, or their own
system preference.

The choice is remembered per browser and applied **before the page paints**, by a
small blocking script in `<head>`, so a returning dark-mode visitor never sees a
flash of the light site. A light-only site emits nothing. On the canvas, a
sun/moon button beside Edit/Play switches the mode you are designing in.

## Keyboard shortcuts

Both surfaces (Edit and Play):

| Key | Action |
|---|---|
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘S` | Save now |
| `⌘P` | Publish |
| `⌘J` | AI drawer (desktop Launcher only) |
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

**The AI drawer in the editor is how you use AI in Guano** (`⌘J`, the left
rail's first button, under the desktop Launcher). You type beside the page you
are looking at and the edits land on the canvas as the agent works. It runs
your own Claude Code install — the harness, the sign-in and the bill are
yours, and Guano never collects an API key. It already knows the project, the
branch, the page and whatever you have selected, so it never asks you which.

**Claude Desktop and Claude Code also connect**, over `guano connect`. That
path is supported and secondary: it is another app, and it has to be told
which site and which branch before it can do anything.

Both drive the same MCP server (`guano mcp`), which lets an agent read and
write the same project the editor does — pages as a strict HTML subset,
components, collections, interactions, animations, translations — through the
authed HTTP API with a `guano_` token. The agent handbook it serves is
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

### Several sites on one machine

Each site needs its **own port**, or whichever one starts first answers for
both — and the other's token is then refused with a 401 that looks exactly
like a revoked token. `npm create @useguano` picks a free port per project and
writes it to `.env`; a server with no `PORT` set otherwise reclaims whatever
port it used last. `guano connect` writes **one `mcpServers` entry for all of
them**, carrying a map of projects — so connecting a second site never
disconnects the first, and Claude does not start a process (and an alert) per
project you are not running. Each project in the map records its own instance
id, so if another instance is holding the port, `guano mcp` says which project
answered instead of failing silently. Run `npm run connect` again in a project
whose port has changed.

A project that is deleted, rebuilt or renamed leaves its entry behind, and
enough stale entries make every tool call fail with *no configured project is
running*. `guano disconnect --list` shows every entry with a live verdict,
`guano disconnect` removes the one for the folder you are in, and
`guano disconnect --stale` removes the ones whose address answers but is
provably not them. Quit Claude Desktop first — it rewrites its config on quit.

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
| `PORT` | remembered, else `4174` | server port. Without it the port this data dir last landed on is preferred over the default, so two sites on one machine keep their own addresses. `npm create @useguano` writes a free one into `.env` |
| `GUANO_DATA_DIR` | `server/data` | data location — absolute path; set this on any real deploy (`SB_DATA_DIR` still works, deprecated) |
| `COOKIE_SECURE` | `1` (Secure on) | session cookie `Secure` flag; set `0` only for plain-HTTP LAN/dev setups (localhost works with the default) |
| `TRUST_PROXY` | unset | set `1` **only behind a reverse proxy** — rate limiting then keys on the last `X-Forwarded-For` hop instead of the socket address |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes via `Authorization: Bearer` |
| `MEDIA_QUOTA` | 2 GiB | media library size ceiling, in bytes |
| `STORE_QUOTA` | 512 MiB | project storage ceiling, in bytes |
| `SNAPSHOT_MAX_BYTES` | 512 MiB | refuses a snapshot above this — the zip is built in memory |
| `PORT_STRICT` | unset | `1` refuses to walk to the next free port when `PORT` is busy. Worth setting on a real deploy: a silent walk means everything addressing the default port reaches something else |
| `GUANO_PROJECTS` | unset | `guano mcp`: the projects this one client entry serves, as `{"<slug>":{url,token,instance,target}}`. Written by `guano connect`, which folds every project into ONE entry — Claude Desktop starts a process per entry, so a per-project entry meant an alert for every project you were not running |
| `GUANO_MCP_PROJECT` | unset | `guano mcp`: pin the live project by slug. Unset, the sole project whose server is answering is used — so switching projects is starting the one you want, with no restart. Two running and nothing pinned is refused by name rather than guessed |
| `GUANO_URL` | `http://localhost:4174` | `guano mcp` / `guano connect`: which instance to talk to (the single-project form; `GUANO_PROJECTS` supersedes it) |
| `GUANO_INSTANCE` | unset | `guano mcp`: the project this client entry was connected to. Written by `guano connect`; a mismatch against the server's own id is refused by name rather than failing with a 401 |
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
