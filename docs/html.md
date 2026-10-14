# The agent format: HTML, and the element registry it maps to

<!-- Read this before touching src/lib/html/ or src/lib/elements.ts, and run
     npm run check:html afterwards. CLAUDE.md points here. -->

## Why HTML

Agents read and write pages as a **strict HTML subset** — a format every model already knows, where one write carries structure, classes and text together. The DSL needed a structure call and then a second round of element edits. This is what the MCP tools speak.

**Nothing in `src/` imports it**, so the parser never enters the browser bundle (checked against `dist/`).

## The four files

**`tags.ts`** is the registry ↔ HTML mapping, in both directions, and the only place the two are reconciled. Tag names are **case-sensitive**: that is what lets `<Card>` mean a component instance, and why the parser is hand-rolled rather than parse5 — every HTML5 parser lowercases tag names. `ALIAS_OF` makes `container`/`grid` → `div`, `heading` → `h2` and `dropdown` → `select` serialize as their target AND compare equal, so a write never re-mints a node over a difference that renders nowhere. `impliedAttrs` is the registry's own (`checkbox` is `<input type="checkbox">`) — part of the element's identity, emitted by the writer and consumed by the reader rather than stored as a custom attribute.

**`serialize.ts`** is the read: canonical, deterministic, two-space indented, with a fixed attribute order (`data-id`, `data-ref`, `class`, then alphabetical) because the page `version` is a hash of it. A **component instance's interior shows content only** — its classes and shared attributes are the master's, so printing them would invite an edit that lands nowhere; a component READ (`masterToHtml`) shows them, which is where they are editable. It prints a node's OWN values, never what it inherits, so a round-trip cannot shadow a master's text. Interactions and animations appear as read-only `data-interactions` / `data-animations` names.

**`parse.ts`** is lenient in, canonical out. A void tag without the slash, a lowercase `<card>`, comments, numeric entities and a `<div>` of plain text all work. An unknown tag, a mismatched or unclosed tag, a duplicate attribute, an unquoted value, an `on*` handler, a `<script>` and text loose inside a container are refused with `line:col`. It caps at 2 MB and depth 64. A **leaf's inner markup is taken raw** and handed to `sanitizeRich`, because rich copy carries `<strong>`/`<a>`/`<br>`, which are not elements of this format.

**`apply.ts`** is the write, and **the one place node identity is still MATCHED rather than simply kept** — the reason `reconcile` existed.

## How `apply.ts` matches identity

In order: `data-id` (an 8-hex prefix, lengthened on collision — echoing it back is what carries identity), then `data-ref`, then a tree LCS on `type|arg|link`, then by type.

The id and ref claims resolve **document-wide and before any LCS**, so one level's guess can never take a node a deeper level addressed by id.

**A claim that cannot be honoured is reported, never dropped quietly.** The same id on two elements is REFUSED — document order decided it, so an overlay's close binding silently became a new trigger wrapper's while the response said `kept: 3, refused: []`. A type mismatch warns and falls through to the LCS. An id matching nothing at all warns — but an id naming a node inside an instance stays silent, because that is the ordinary round-trip.

A node inside an instance is deliberately NOT addressable: its structure is the master's, so it is a positional part. A claim that would make a node its own ancestor is refused, because a cycle in the tree is unrecoverable.

## Refusals are never silent

That is the whole point. A class inside an instance, an attribute that belongs to the component, an unusable `src`, a part count that doesn't match the master — each comes back named, with the tool that *can* do it.

`warnings` is the separate list for what landed but is worth saying. A class the Style panel has no control for is **kept**, because every renderer uses `node.classes` verbatim and dropping it would change the published page.

One **normalization**: a write turns `classes: ""` into no key at all, exactly as the editor's own class writer does.

## The page `version`

`pageVersion` in `tools.mjs` is `sha256` of this HTML plus name/slug/status — so it changes iff something a structure write could clobber changes.

Deliberately NOT the `seo` block (its own tool owns it), and not the read-only `data-interactions`/`data-animations` names (`{effects: false}`): an effect is node state the HTML *reports* but does not *carry*. It survives every write by construction, and a version that moved when a binding changed would be the same spurious `stale-version` the old marker sync caused.

## Elements, leaves and containers

Element types live in the `ELEMENTS` registry (`lib/elements.ts`). **A leaf carries text or is void; everything else is a container.**

`button`, `link` and `label` are **containers** — an icon, a badge and a label routinely sit inside one — so their words live in a child, and `content` on the element itself is refused. A registry entry's `seed` is the child a brand-new element of that type is created with, so an insert lands something visible rather than an empty box; `seedChildFor` is the one builder for both structure hosts, since both insert into a tree. `icon` is a void leaf rendering an inline `<svg>` from `node.svg`.

**Leaf-ness is NOT the same question as "does an instance address this as a part".** `isInstancePart` is, and it adds the containers an instance has its own say about: `textarea`/`select` (their `name`/`placeholder` are per placement) and `link` (its destination is). Leaf-ness alone made an `input` a part and the `textarea` beside it not one, and left a component's `<a>` unaddressable — which is why a Button component could not be a link.

**Capitalized** types (`Card`) are **component instances**, resolved through the component registry (`isComponentType` from `lib/components.ts`) alongside `isKnownElement`, never by name-casing alone.

## `node.ref` is the client ref

A stable, human-readable address — node state like everything else. It emits **nothing** on the published page (`htmlId` is the separate DOM id; `export.mjs` never sees a ref), and a component master can neither hold one nor emit one (`cloneForMaster` strips it). Refs are page-scope and must be **unique**.

They earn their keep twice: agents address by them (`edit_elements` `ref:`/`setRef`, `bind_interaction` `ref`/`targetRef`, `get_page {elements:"refs"}`, `data-ref` in the HTML), and `applyHtml` adopts by them.

`useElement.setElementRef` refuses a collision and a ref on the body, and returns whether it wrote; a human sets one by renaming a row in the Layers tree, which surfaces the reason. Extraction moves the block's ROOT ref onto the instance wrapper and drops the rest (`useComponents.createComponent`, and `makeComponentFrom` in the MCP tools, which also reports the dropped ones) — a ref inside a component would be duplicated on every instance.

## Validation is `lib/validateTree.ts`

Over the tree, reporting `{nodeId, message}`: a duplicate ref, a ref inside an instance, an unknown collection on a list/item/slider, a misplaced `list-empty`, `@item` inside a data-only collection, an unknown component, and a component containing itself.

The grammar half of the old `validateDocument` — indentation, unclosed blocks, leaf-vs-container form, invalid tokens — cannot happen in a tree and is gone.

`LayersPane`'s issues footer is where a human sees these and selects the offending node.
