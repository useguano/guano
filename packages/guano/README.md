# guano

Self-hosted visual website builder: build pages on a live canvas with a layers
tree, style with Tailwind classes, add interactions, reusable components, CMS
collections and locales — then publish a fully static site
(plain HTML + one CSS file + a ~1.5 KB runtime) served by the built-in server,
downloaded as a zip, or pushed to GitHub.

```sh
npm create @useguano   # scaffolds a folder and installs
cd my-site && npm run dev
# or, without a project folder:
npx -y @useguano/guano dev
```

Open `http://localhost:4174/admin`, create the first (admin) account, build.
Your published site is at `http://localhost:4174/`.

## CLI

- `guano dev` — start the server for local editing
- `guano start` — production server (`NODE_ENV=production`)
- `guano build [--out dir]` — export the current project as static files (default `./dist-site`)
- `guano mcp` — run the MCP server (stdio) so AI agents can edit the site (see [MCP](#mcp-ai-agents))
- `guano connect` — issue an API token to a local instance, for `guano mcp`

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4174` | server port |
| `GUANO_DATA_DIR` | `./data` under `node_modules`, else `server/data` | users, media, drafts, published site — **backup = copy this dir**; on ephemeral hosts point it at a volume |
| `COOKIE_SECURE` | `1` | session cookie `Secure` flag; set `0` only for plain-HTTP LAN setups |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes |
| `MEDIA_QUOTA` | 2 GiB | media library ceiling, bytes |
| `STORE_QUOTA` | 512 MiB | project storage ceiling, bytes |
| `TRUST_PROXY` | unset | set `1` **only behind a reverse proxy** — every rate limit then keys on the last `X-Forwarded-For` hop instead of the socket address |
| `PORT_STRICT` | unset | `1` refuses to walk to the next free port when `PORT` is busy |
| `GUANO_PREVIEW_PORT` | `PORT + 1` | the preview site's port |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`; `warn` drops the per-request access line |
| `LOG_JSON` | unset | `1` emits one JSON object per line, for a log shipper |
| `SHUTDOWN_GRACE_MS` | `0` | how long to keep failing health checks before the socket closes, so a load balancer can drain first |
| `GUANO_URL` | `http://localhost:4174` | `guano mcp` only — the running instance to connect to |
| `GUANO_TOKEN` | unset | `guano mcp` only — an API token (see [MCP](#mcp-ai-agents)) |

The admin needs a persistent Node process with a writable disk (VPS, Railway,
Fly.io, Render…). It cannot run on Vercel/Netlify — but your published site is
fully static and can be hosted anywhere.

## MCP (AI agents)

`guano mcp` exposes a **running** Guano instance to AI agents over the
[Model Context Protocol](https://modelcontextprotocol.io). The agent edits your
site through the same authenticated HTTP API the editor uses and shares the
editor's own document logic, so structure edits preserve element identity,
styling, and interactions exactly as if you'd typed them.

### Claude Desktop: one command

On the machine running your instance (after `/admin` setup):

```sh
guano connect
```

It mints an API token (proving instance ownership via the data dir — no
copy-paste) and writes the `mcpServers` entry into Claude Desktop's config with
absolute paths. Quit Claude Desktop before running it — the app overwrites its
config from memory on quit, which would silently undo the setup — then open it
again: connected. `guano connect --print` emits the JSON snippet instead, for
any other MCP client or a remote instance.

### Manual setup (other clients / remote instances)

**1. Create an API token** — in the editor: **My account → API tokens →
create**. Copy the `guano_…` token (shown once). It carries your role — admin
or editor only (contributors can't).

**2. Register the server** — it talks to your instance over HTTP; point it at
the URL and token. For example, with Claude Code:

```sh
claude mcp add guano -- npx -y @useguano/guano mcp
```

then set the environment in your MCP client config:

```json
{
  "mcpServers": {
    "guano": {
      "command": "npx",
      "args": ["-y", "@useguano/guano", "mcp"],
      "env": {
        "GUANO_URL": "http://localhost:4174",
        "GUANO_TOKEN": "guano_your_token_here"
      }
    }
  }
}
```

Use your deployed URL (e.g. `https://studio.example.com`) for a hosted instance.

### 3. Main vs. a draft — the agent asks you first

Writes go to a **target** you choose: **Main** (the live project) or a **draft**
(a safe branch you later apply from the editor's Drafts panel). The store is
latest-wins, so editing Main while you're also in the editor can clobber work —
**drafts are the safe mode.** The agent must call `set_target` before any write,
and its tool prompt tells it to ask you which to use. Creating a draft over MCP
produces exactly the shape the editor opens, and never changes which branch your
editor is viewing.

### Tools

`get_guide` (the agent handbook — also served as MCP `instructions`) · `get_status`,
`set_target` · `list_pages`, `get_page`, `set_page_html`, `edit_structure`,
`create_page`, `delete_page`, `set_page_seo` · `edit_elements` (batch: classes, text
content, media src/background, attributes, html id) · `list_components`,
`create_component`, `update_component`, `duplicate_component`, `detach_instance`,
`delete_component`, `set_component_variants`, `create_components` ·
`get_settings`, `update_settings` (design tokens, SEO
defaults, fonts, custom head) · `list_interactions`, `create_interactions`,
`update_interaction`, `delete_interaction`,
`bind_interaction`, `unbind_interaction` · `list_animations`, `create_animations`,
`update_animation`, `delete_animation` · `list_collections`, `get_collection`,
`create_collection`, `update_collection`, `delete_collection`, `upsert_entries`,
`delete_entry` · `get_translation_worklist`, `set_translations` · `list_media`,
`upload_media`, `list_icons` · `list_comments`, `create_comment`,
`reply_to_comment` · `list_form_submissions`, `list_integrations` · `preview`,
`publish`, `update_page`.

There is no bundled component library: every component is the project's own,
made in the editor or by an agent with `create_component`.

**Pages are read and written as HTML** — a strict subset where `<Card>` is a
component instance and `data-ref` is a stable address, so one write carries
structure, classes and text together. `edit_structure` changes part of a page
(insert/replace/move/remove/wrap) without resending it.

Page/element edits are guarded by a version hash from `get_page` — a stale write
(the page changed underneath) is rejected rather than clobbering. Markup that
does not parse is refused with a `line:col`; a document that parses but has a
problem (an unknown collection, a duplicate ref) saves and reports it.
