# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based visual website builder. The user builds pages on a live canvas with a **Layers tree** — inserting and arranging elements, then styling them — and can add interactions and animations, leave comments, branch and merge, translate into locales, and build reusable components and CMS collections. **AI agents read and write the same pages as a strict HTML subset** through the MCP server.

A page's structure is an `ElementNode` **tree, and the tree is all there is** — no text format sits beside it (there was an indentation DSL until the v2 schema).

There is **one admin shell** with **two surfaces** over one shared document, switched by the **Edit / Play** toggle on the page canvas: Edit is the rails + canvas + Layers builder, Play is the full-site render. It is a runtime mode in `useViewMode`, **not a route**, and contributors are pinned to Play. → `docs/ui.md`

The published site is a **static export** (`server/export.mjs`) served by the node server at `/`; it never enters the Vue app. → `docs/export.md`

## Hard rules

These have no natural trigger point — nothing will remind you mid-task.

- **Never `crypto.randomUUID()`** — use `uid()` from `src/lib/shared/ids.js`. `randomUUID` needs a secure context, so an editor reached over plain http at a LAN address threw on the first insert. There is deliberately no `Math.random` tier.
- **Never a bare `console.*` in `server/`** — logging goes through `server/log.mjs` (levels, `LOG_JSON`, the request id).
- **Every structural change goes through `lib/treeOps`**, parameterized by a `StructureHost`. Never mutate a tree by hand.
- **Keep the three renderers in sync** — `ElementRenderer` (Edit), `PreviewRenderer` (Play), `server/export.mjs` (published). Anything that adds per-node or per-instance state must be read the same way in all three.
- **Never animate one property with both motion systems.** Interactions write classes; animations write inline styles. **Actions** are the third engine and write DATA — never style.
- **Reuse the UI primitives** in `src/components/ui/` — never hand-roll an input or a button, never render a modal or popover with a local `v-if`, and never use the native `title` attribute.
- **Errors must have a surface** — `useNotice()`, never a silent catch.
- **No prose comments in `src/`.** Keep directives and typed JSDoc, nothing else.
- **A `check:corpus` difference is a bug, never a re-baseline** (one documented exception: an asset you just rebuilt).

## Stack

Vue `3.5`, vue-router `5`, Vite `8`, TypeScript `6`, Tailwind `4` (CSS-first, no config file — theme tokens live in `src/assets/main.css`). Node `^22.18.0 || >=24.12.0`. Path alias `@` → `src/` (`vite.config.ts`).

**Pinia is not used** — it isn't a dependency and there is no `src/stores/`. Ignore any stale reference to it; state lives in composable singletons (see **State model**).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. **The admin editor also needs `npm run serve`** — it boots by hydrating the server store over `/api`. Everything outside `/admin` proxies to :4174, so `/` previews the real static export. |
| `npm run serve` | The node server (`server/index.mjs`): auth, editor store, publish/export API, the built SPA and the exported site. Seeds `guano-project:main` so a fresh instance is drivable headlessly. |
| `npm run build` | `vue-tsc` type-check + production build, in parallel. **Required before `test:e2e`.** |
| `npm run type-check` | `vue-tsc --build` only. |
| `npm run preview` | Serve the production build. |
| `npm run test:e2e` | Playwright: 459 tests in 62 files, on its own server (:4188) and data dir. |
| `npm run check:corpus` | Render referee: re-export every corpus project, fail on one byte or one moved node id. |
| `npm run check:html` | The agent HTML layer (`src/lib/html/`) — round-trip properties + the refusals. |
| `npm run check:migrate` | The v2 schema migration (`src/lib/migrate.ts`). |
| `npm run check:mcp` | What an MCP client actually receives; fails over the tool-list byte budget. |
| `npm run check:cli` | The shipped CLI, invoked the way a user meets it. |
| `build:motion` · `build:slider` · `build:state` · `build:icons` · `build:mcp-runtime` | Rebuild a committed artifact. Run after changing its source. |

**These are the only gates — there is no linter and no unit-test runner.** Each one has a trigger and a rule you cannot guess from its name: a `check:corpus` difference is a bug, never a re-baseline; the `check:mcp` budget is trimmed, never raised; `check:html` is mandatory after touching `src/lib/html/`. **Read `docs/gates.md` before running or changing a gate** — it also covers the dev-server port walk, which can cost a day.

To exercise pure `src/lib/*` logic or a composable headlessly, write a throwaway `.tmp-test.ts` at the repo root:

```sh
npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts && rm -f .tmp-test.ts
```

## Routes (`src/router/index.ts`)

The SPA is the **admin editor only**, served under `/admin/` (Vite `base: '/admin/'`, so route paths are base-relative). The published site is the static export served by the node server at `/` — it never enters the Vue app. Routes: `/` (`build` — the whole editor, both surfaces), `/login`, `/setup` (first-run), `/invite/:token` (`SetPasswordView`, accept invite), `/authorize` (`AuthorizeView` — approve a `guano connect --url` device code; see `docs/instance.md`), plus a catch-all redirect to `/`. Preview stopped being a route when the two views merged into one shell, and no legacy path is kept as a redirect — the app is not public, so there are no old bookmarks to honour. A `beforeEach` guard gates everything on auth (redirecting to `/setup` or `/login`); there is no role redirect — contributors reach the same route and are pinned to the Preview surface by `useViewMode`. Hard `window.location.assign('/admin…')` calls (login/logout flows) use full server URLs and keep their `/admin` prefix.

## State model: composable singletons

Shared state is module-level `ref`s declared **outside** the exported composable function, so every caller of e.g. `useProject()` sees the same instance — a hand-rolled store. This is the backbone; follow it for new global state. Two flavors: composables that derive from the `project` document, and newer server-hydrated ones (`useAuth`, `useUsers`, `useBranches`) that hold data fetched from the API.

- `useProject` — owns the single `project` ref (the whole document) and project-level ops.
- `usePage` — active page selection and page CRUD (add/duplicate/remove/rename, `updatePageMeta`, `setActivePage`, `homePage`).
- `useElement` — selection/drag/highlight state + **all structural mutations** (add/remove/duplicate/paste/reorder/change-type/set-arg). Selection defaults to the page body when nothing is picked.
- `useEditorBoot` — admin-zone boot: `await hydrateStore()` then start autosave/sync. Module-scoped `started` flag so it runs exactly once however the shell mounts. Autosave and undo therefore run in the Preview surface too, not just Build.
- `usePersistence` — autosave + undo/redo + which branch is loaded (`docs/server.md`).
- `useInteraction` (class toggles), `useAnimation` + `useMotion` (tween timelines), `useComments`, `useComponents`, `useCollections`, `useBranches`, `useLocale`, `useContextMenu`, `usePanel`, `useSettings`, `useThemeTokens` — one subsystem each.

`Project` (`src/types/editor.ts`) is the whole serializable document: `pages`, `components`, `collections`, `interactions` + `animations` (the two shared motion libraries — **actions have no library: their ops live inline on the binding**), `breakpoints`, `comments`, `locales` + `defaultLocale`, and `settings` (`ProjectSettings`: design `tokens`, seo, favicon, domain, smtp, custom code, fonts). Runtime-only state (selection, camera, open popover, fired interactions, **active locale**, active branch id) lives in composables and is intentionally **not** part of the project or its history.

## The core invariant: the tree is the source of truth for structure

A `Page` has `elements` — the `ElementNode` tree — and **that is the whole of its structure**. There is no second representation to keep in step. Every structural change — insert, drag-reorder, duplicate, delete, wrap, retype — mutates the tree directly, through `lib/treeOps`.

Tree edits carry identity for free, which is the point: the node objects survive, so ids, per-node state, selection and interaction `targetId` cross-references do too. Identity has to be *matched* in exactly two places now — realigning an instance to its master (`alignStructure`), and applying an agent's HTML (`lib/html/apply.ts`). → `docs/components.md`, `docs/html.md`

`alignStructure` keeps the node object for every child its signature-LCS pairs and leaves an already-current subtree byte-identical — a push that reads as an edit would be adopted straight back over the edit.

`node.classes`, `node.content`, `node.locales`, `node.arg`, `node.ref`, `node.link` — all of it is just node state now, mutated in place. Two carry a component rule: inside an instance **`arg`** belongs to the master and the push copies it down, while **`link`** is per-instance with a component default, resolved along the chain. → `docs/components.md`

## The v2 schema

v1 stored an indentation DSL beside the tree — `page.code`, plus a `line`/`endLine` on every node. **v2 deletes all of it**, along with the four pure alias element types (`container`, `grid`, `heading`, `dropdown`). `project.schemaVersion` records which shape a blob is in; absent means v1.

`migrateProject` is one **idempotent** implementation, which is what makes "run it over everything, every boot" safe — and the server does, over every blob, before the socket accepts anything. Three rules are load-bearing: **the tree wins over the text** and nothing is re-derived from it; collapsing an alias must render identically; and materializing an unexpanded `:Card:` leaf is a FIX that deliberately changes a render. → `docs/schema.md`

## The agent format: HTML

Agents read and write pages as a **strict HTML subset** (`src/lib/html/`), where one write carries structure, classes and text together. Tag names are **case-sensitive** — that is what lets `<Card>` mean a component instance, and why the parser is hand-rolled.

`apply.ts` is the write, and **the one place node identity is MATCHED rather than simply kept**: `data-id`, then `data-ref`, then a tree LCS on `type|arg|link`, then by type. **Refusals are never silent** — a write that cannot land comes back named, with the tool that can do it. The page `version` is a hash of this HTML, so it moves iff something a structure write could clobber moves.

Nothing in `src/` imports it, so the parser never enters the browser bundle. **Run `npm run check:html` after touching it.** → `docs/html.md`

## Elements, refs and validation

`ELEMENTS` (`lib/elements.ts`) is the registry. **A leaf carries text or is void; everything else is a container** — `button`, `link` and `label` included, so their words live in a child and `content` on the element itself is refused. Capitalized types (`Card`) are component instances, resolved through the component registry and never by name-casing alone.

`node.ref` is the page-scope, unique **client ref**: agents address by it and `applyHtml` adopts by it, and it emits nothing on the published page. Validation is `lib/validateTree.ts`, over the tree, reporting `{nodeId, message}`. → `docs/html.md`

## Rendering: three renderers, one logic

`useRenderNode.ts` is the shared core for Build's `ElementRenderer.vue` and Preview's `PreviewRenderer.vue`; `server/export.mjs` reimplements the same logic in plain JS and is the only renderer of the published site. **Keep all three in sync** — anything that adds per-node or per-instance state must be read the same way in each.

Content precedence: bound collection field → the node's own content → the mapped master's content. **The element default is a Build-only placeholder and ships nowhere** — an empty `<span>` exports empty. A binding path may carry a display format (`due|date:long`, `status|label`) or be an aggregate over a list (`@count:task`), and a `fieldAttrs` key of `style:--x` binds a CSS custom property — the only way a number reaches a style. → `docs/content.md` Inside an instance, style and interactions come from the master while content stays the node's own.

Two rules that cost a release each: **binding scope is decided by the TARGET, not the trigger**, and a **channel** (`targetId: "@name"`) is the one target with no scope at all. → `docs/rendering.md`

## Subsystems: read the doc before editing the subsystem

**The detail lives in `docs/`, one file per theme.** Each entry there records the invariant **and the bug that produced it**, which is the only thing that stops a fix being undone; none of it is re-derivable from the code. READ the file before editing the subsystem — or just its `##` section when you need one answer.

**The document and its renderers**

- **`docs/schema.md`** — what v2 removed, the idempotent migration, its three load-bearing rules, salvage, and where it runs. Read it before touching `src/lib/migrate.ts`.
- **`docs/html.md`** — the agent HTML subset: the registry mapping, the serializer's determinism, what the parser refuses and where, how `apply.ts` matches identity, refs and `validateTree`. Read it with `npm run check:html`.
- **`docs/structure.md`** — `treeOps`, the `StructureHost`, `useStructure`'s policy and its `can`/`canDrop` answers, the Layers tree. Read it for any structural mutation.
- **`docs/rendering.md`** — the shared render core, the Build-only empty box, how an interaction's scope is keyed, channels, and what canvas cost is made of. Read it before touching a renderer or adding per-node state.

**Authoring subsystems**

- **`docs/components.md`** — masters and instances, the one instance resolver (`shared/instances.js`), hidden parts, variants, nesting and mirrors, slots, the drawer's whole-project ops, the board. Read it for any component work, and before adding per-instance state (it must resolve along the chain, in all three renderers).
- **`docs/content.md`** — collections and field types, localization, the `@locale:` switcher, `list-empty`, attribute layers, `fieldAttrs`, reserved `data-*`, sliders, icons, `custom-code`. Read it for CMS content, a locale, an attribute, or a node's media.
- **`docs/state.md`** — client-side entry state: actions (the data engine), the route store, the list reconciler, draft scopes, persistence. Read it for any action work, and before touching `src/lib/shared/state.js`, `src/state/runtime.ts` or the `ds` half of the exporter. **A route with no action ships not one byte of it.**
- **`docs/motion.md`** — interactions (class toggles) and animations (tween timelines): two systems, one panel, all the math in `shared/motion.js` imported verbatim by editor, exporter and runtime. Read it for any trigger, tween or effect work. **Never animate one property with both.**
- **`docs/theming.md`** — design tokens, a token's `dark` value, the `@theme` link sentinel, and why `dark:` is class-based here rather than `prefers-color-scheme`. Read it before "fixing" either.

**The server and what it ships**

- **`docs/server.md`** — the server-backed store and autosave, drafts and the 3-way merge, auth roles and the contributor/reviewer merges, agent policy, integrations, capabilities, forms, redirects. Read it for anything under `server/` that is not the exporter, and for `usePersistence` / `useBranches` / `useAuth`.
- **`docs/export.md`** — the exporter (`server/export.mjs`), the compiled fx wire format, image hints and responsive variants, the three cache tiers, publish methods (server/zip/github), `apiOrigin`, private site, the preview port, package import/export. Read it before touching anything that ships bytes to a visitor.
- **`docs/instance.md`** — the instance id and the remembered port; the ONE MCP config entry and its `GUANO_PROJECTS` map; how the live project is resolved (pin, then sole-reachable, then refuse) and why the agent never picks it; remote connect; `boot()`'s ordering, the SIGTERM drain, `/api/health`, logging, the staging primitives and retention. Read it before touching `server/lifecycle.mjs`, `boot()` or anything under `packages/guano/mcp/`.

**Agents, chrome, checks**

- **`docs/mcp.md`** — the agent toolset (`packages/guano/mcp/`): the write target and its consent channel, `serializeHandler`'s per-call baseline and lock, the HTML page tools, component and instance-part addressing, design warnings, and the untrusted-content fence. Read it with `mcp/GUIDE.md`, which is the agent-facing half and must stay in sync.
- **`docs/ui.md`** — the primitives, the app-level floating hosts, where a component file goes, the two rails, the drawers and the Layers view, the class validator, and the four places shortcuts are registered. Read it before building or reshaping editor chrome.
- **`docs/gates.md`** — what each `check:*` refuses and why, the committed `build:*` artifacts, the e2e suite's shape and its ordering rule, and the dev-server port walk. Read it before running or changing a gate.
