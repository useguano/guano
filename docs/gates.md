# Gates: the checks, what each one refuses, and the dev-server port walk

<!-- Read this before running or changing a gate. CLAUDE.md keeps the command
     table and points here. These are the ONLY gates: there is no linter and
     no unit-test runner. -->

## The dev server and the port walk

`npm run dev` is Vite with hot reload. The admin editor (`/admin/`) **also needs `npm run serve`**: it boots by hydrating the server-backed store and checking auth over `/api`. The SPA is built with `base: '/admin/'`, and the dev server proxies **everything outside `/admin`** — `/api`, `/media`, and the exported site at `/` — to `http://localhost:4174` (`vite.config.ts`), so `/` in dev previews the real static export.

`npm run serve` is the node server (`server/index.mjs`): auth, the editor store, the publish/export API, the built SPA and the exported static site.

**A busy 4174 walks to the next free port, and that convenience can cost a day.** The Vite proxy, the MCP's `GUANO_URL` default and every open tab all address guano by its default port, so they keep talking to whatever is squatting it. An older instance answers `/api/published` out of the `export.mjs` cached in ITS heap: publish and preview report success while the HTML on disk is built by another day's code. `assets/script.js` is read from disk per export, so the runtime half still looks current — which is what makes it unreadable. The walk prints a warning last, naming all three addresses; `PORT_STRICT=1` (or an explicit `PORT`) refuses to walk.

**A project remembers its port** (`server/instance.mjs` → `data/instance.json`), so an unset `PORT` prefers the port this data dir last landed on over the bare 4174 default — two projects stop trading one address depending on boot order, and the warning says so when the port it lost was its own. See the instance-identity doc.

## First-run seeding

`npm run serve` **seeds `guano-project:main`** — at `POST /api/auth/setup` (with the project name from the setup form) and lazily on an agent-token store request — via `createProject` from the MCP runtime bundle, so a fresh instance is drivable headlessly instead of waiting for someone to open `/admin`.

The bundle is **committed** (like `server/motion-runtime.js`), so seeding works on a fresh clone; rebuild it with `npm run build:mcp-runtime` after changing anything it re-exports from `src/lib` (`prepack` always rebuilds it fresh before publishing). If it is missing, seeding logs a warning and no-ops: the browser still creates the project, and `SetupView`'s `guano-setup-name` stash carries the name.

## `check:corpus` — the render referee

The referee for the tree-source migration. It re-exports a fixed set of input projects (the e2e fixture and every project blob in a local `server/data/store`) through `server/export.mjs` and fails on any byte of difference against the saved baseline, **plus any node id that moved**. Node ids are addressed by comment anchors, interaction `targetId`s and the 3-way merge base, so a change that renders identically while re-minting ids has still broken the project.

The inputs live in `.corpus/inputs/` (gitignored) and **are** the referee — not the code that built them. `scripts/corpus.mjs build` constructs them once, `save` captures the baseline, `check` diffs.

**A difference is a bug, never a re-baseline — with one exception, and only one.** The referee diffs the whole exported directory, so `assets/script.js`, `assets/motion.js` and `assets/slider.js` are in it too. Rebuilding a runtime (`build:motion`, `build:slider`, or an edit to `server/site-runtime.js`) therefore moves the baseline by exactly those files. Read the diff and confirm it is ONLY the asset you rebuilt before saving; a page of HTML in the same diff is still a bug.

**Media is part of the referee too.** A `/media/<id>` resolves out of `$GUANO_DATA_DIR/media`, so `build` (or `media --from <data dir>`, once) snapshots the referenced bytes into `.corpus/media/`, and every export points `GUANO_DATA_DIR` at `.corpus`. An input referencing an id the snapshot does not hold **refuses to run** rather than exporting a hole and blaming the code — the one thing a referee must never do.

## `check:html` — the agent-facing HTML layer

Validates `src/lib/html/` via `scripts/check-html.ts`. **Run it after touching anything in there.** Two halves.

**The round-trip properties**, over every corpus project: `parse(serialize(x))` applied back to `x` is a NO-OP (same JSON, nothing created, nothing removed), serializing twice is a fixed point, and with every `data-id` stripped adoption is still total. That is what stands between an agent's write and silent data loss: the HTML carries no interactions, animations, translations, slider config or `listQuery`, so a node the write fails to ADOPT loses all of it.

**The behaviour and the refusals**, on small built-to-order projects: what the parser accepts, what it refuses and *where*, how identity is carried, and the component-instance rules. A refusal that stops being a refusal is how "the tool reported success for a write that renders nowhere" comes back.

The first half needs `.corpus/inputs`; it says so and runs the second half regardless.

## `check:migrate` — the v2 schema migration

Validates `src/lib/migrate.ts` via `scripts/check-migrate.ts`. **Run it after touching the migration.**

`check:corpus` already proves the migration renders real projects byte-identically, but no corpus project uses the pure alias types or carries an unexpanded `:Card:` leaf — the two steps that actually change a tree. Those are built here on purpose, to the same standard: export, migrate, export, compare, every node id checked for having survived.

It also pins idempotence, that a disagreeing text mirror is *recorded* and never applied, salvage, and that no v1 field survives anywhere. The migration is a ONE-WAY rewrite of every blob on the instance; no version of it is worth shipping on "it type-checks".

## `check:mcp` — the tool-list byte budget

Measures what an MCP client actually receives from `packages/guano/mcp/` (the `tools/list` payload and the initialize `instructions`) and **fails when the tool list exceeds its byte budget**. **Run it after touching any tool description or `inputSchema`.**

The files on disk cost an agent nothing, but the tool list is injected into the model's context on *every turn*: a sentence added to a schema is a tax on every call forever. A description says WHAT and WHEN in a sentence or two and points at `get_guide {section: "…"}`; the explanation belongs in `GUIDE.md`, fetched a section at a time.

**Trim the prose rather than raising the budget.** It was raised once, to 80,000 B for the V10–V13 work, after weighing lazy tool loading — no client capability says a client honours `tools/list_changed`, so that was set aside.

## `check:cli` — the shipped CLI, the way a user meets it

`scripts/check-cli.mjs`: every module under `packages/`, `server/` and `scripts/` parses, each package's `bin` entry exists and carries a shebang, and `packages/guano/bin/guano.js` is actually INVOKED for `--version` (compared against `package.json`), `--help` (which must still name every subcommand, and must not leak a backtick) and an unknown command (exit 1). `prepack` runs it before any build work, so a tarball whose entry point cannot run is never built.

**0.1.4 shipped with this bug.** An unescaped backtick in the `HELP` template literal made `bin/guano.js` a SyntaxError, so every subcommand — `guano dev` included — died before running a line. `vue-tsc` does not look at `packages/`, the e2e suite drives the MCP server in-process, and nothing else ever loaded the file: all six gates passed on a package that could not start.

## `build:*` — the committed artifacts

Each of these rebuilds a file that is **committed**, so it is only needed after changing the source it is built from.

- `build:motion` — `server/motion-runtime.js` (the published site's tween runtime) from `src/motion/runtime.ts`.
- `build:slider` — `server/slider-runtime.js` (the carousel runtime) from `src/slider/runtime.ts`. Rebuild after changing `src/lib/shared/slider.js` or its driver.
- `build:icons` — the icon table from the installed `lucide-vue-next` (`scripts/build-icons.ts`): `src/lib/shared/lucideIcons.js`, the whole set the icon picker offers. Run it after bumping `lucide-vue-next`. Every icon is run through the inline-SVG sanitizer, and the build fails on one it would alter.
- `build:mcp-runtime` — `packages/guano/runtime/mcp-runtime.mjs` (see First-run seeding).

Rebuilding a runtime moves the `check:corpus` baseline by exactly that asset.

## `test:e2e` — the Playwright suite

`e2e/`, 459 tests in 62 files. **Requires a prior `npm run build`** — the e2e server serves `dist/`. It boots its own server on port 4188 against an isolated `GUANO_DATA_DIR` (`.e2e-data`), so it never touches dev data or a running `npm run serve`.

What is in it, by group:

- **Security & authz** — the server authz spec and the MCP-toolset spec.
- **MCP** — eight `mcp-*` specs plus the in-process page-HTML, publish-warnings and tool-contracts specs. All run in-process on the shared `e2e/fixtures/mcpSession.ts` harness and assert against the **exported HTML**, because a tool reporting success for a write that renders nowhere is the bug class they guard.
- **Export & runtime**, driven in a real browser — interactions, site motion, mouse follows, sliders, tokens, svg, icons, images, channels, backgrounds, field-bound and per-locale attributes, light/dark theming, structured data, lists, forms. Several carry a specific regression: a `count` track bound on a component master (four instances counting to four different numbers), cross-repeat bindings, the modal flag.
- **Server** — the 3-way merge (`store-drafts`, pure, since the merge runs client-side), preview, snapshots, unpublish, site-password, redirects, integrations, forms, store-concurrency.
- **Own-server specs** — `lifecycle`, `auth-kdf`, `instance-identity` (see below).
- **UI** — smoke plus thirteen `ui-*` panel and surface specs.

**The content fixture is `e2e/fixtures/project.json`**, written straight to the store by `loadFixture()` — test data only, hand-maintained. The product has no demo project and no `?demo` URL.

**A spec that logs in must sort AFTER `smoke.spec.ts`.** Smoke owns the first-run flow and needs a server with no admin account yet; that is why `store-concurrency`, `store-forms`, `store-integrations`, `store-agent-security`, `ui-components-drawer`, `ui-forms-panel`, `ui-entry-editor`, `ui-interactions-panel`, `ui-layers`, `ui-nesting`, `ui-preview-editing`, `ui-persistence`, `ui-slider-panel`, `ui-a11y` and `ui-variants` are named as they are. `lifecycle`, `auth-kdf`, `auth-setup-code` and `instance-identity` are exempt: each spawns its OWN server on its own data dir, so none touches the shared instance's first-run state — a SIGTERM would otherwise end the suite, and a legacy password record has to be on disk BEFORE boot for the user cache to read it.

**Two real server guards the suite works around rather than relaxing.** A publish is rate-limited to 12/min, which the suite exceeds across its publishing specs: the shared `publish()` helper waits the window out, and `store-forms` publishes ONCE for its whole file. The server runs with **`TRUST_PROXY=1`** so a spec can present its own client address through `X-Forwarded-For` — the form endpoint's per-IP limit (5/min) is worth testing, and without it every request in the suite shares one socket address.

## Exercising pure logic headlessly

For `src/lib/*` logic (the HTML layer, merge, components, tree ops) or a composable, write a throwaway `.tmp-test.ts` at the repo root and run it with the `@` alias resolved:

```sh
npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts && rm -f .tmp-test.ts
```
