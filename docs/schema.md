# The v2 schema and its migration

<!-- Read this before touching src/lib/migrate.ts. CLAUDE.md points here.
     The migration is a ONE-WAY rewrite of every blob on the instance. -->

## What v2 removed

v1 stored an indentation DSL beside the tree — `page.code`, plus a `line`/`endLine` on every node — because the text was authoritative for structure.

v2 deletes all of it, and with it the four pure **alias** element types the DSL's registry carried: `container`, `grid`, `heading` and `dropdown`, each only another name for a tag that already existed.

`project.schemaVersion` records which shape a blob is in. Absent means v1.

## `migrateProject` is one idempotent implementation

Idempotence is what makes "run it over everything, every boot" safe. It ensures each page has a body, materializes instances still stored as an unexpanded `:Card:` leaf, collapses the aliases, deletes `code`/`line`/`endLine`, and sets `schemaVersion`.

## Three load-bearing rules

**1. The tree wins over the text, and nothing is re-derived from it.** This was not the original plan; the corpus disproved it. Over real projects `reconcile(code, code, elements)` *changes* the tree — a node carries a `link` its line never had, or blocks are missing a closer so the parser nested their siblings. In every case the tree is what every renderer read, so it is what the user was looking at and what the published site shows: re-deriving would silently change live pages. The migration records the pages whose stored text disagreed (`report.textDisagreed`) and moves on.

**2. Collapsing an alias must render identically** — `check:migrate` and `check:corpus` both prove it. The aliases stay in `ELEMENTS_DATA` as a render fallback: a blob the migration never saw must not degrade a `heading` to a bare div.

**3. Materializing an unexpanded instance is a FIX, not a no-op.** A stored `:Card:` leaf had no nodes, so it rendered as nothing at all — the page was silently missing its card. This is the one migration step that deliberately changes a render, and `check:migrate` asserts the change rather than the absence of one.

## Salvage

A page with text but no usable tree is salvaged through `src/lib/legacy/dsl.ts` — a salvage-only parser with no reconcile, no identity to carry and no validation, which exists for that case alone and is marked for deletion one release after launch.

`report.salvaged` names every page that needed it. It should always be empty.

## Where it runs

The server migrates **every blob** once at boot (`migrateSchema` in `server/index.mjs`): Main, the drafts, the `superbird-base:*` merge snapshots — whole project copies, so an unmigrated base makes a 3-way merge see every page as changed — and the published baseline. Before the first write it copies the whole store to `data/store.pre-v2/`, because this is one-way.

`migrateStoredProject` (`lib/storage.ts`) runs the same function client-side as a defensive no-op, for a blob that arrived some other way: an import, or a merge base read straight out of the store.

## What became of the aliases

What they were really offering was a **styled div**, so they live on as insert presets. `PaletteItem.classes` (`lib/elementPalette.ts`) is what an insert lands wearing: Container and Grid are a `div` with `mx-auto w-full max-w-5xl px-6` and `grid grid-cols-3 gap-6`.

A preset carries its own `key` (`paletteKey`), since several entries now share one type and the key is both the row key and what `[data-dock-item]` is queried by.
