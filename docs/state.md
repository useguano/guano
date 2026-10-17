# Client state: actions, the route store, and the list reconciler

<!-- Read this before touching src/lib/shared/state.js, src/state/runtime.ts,
     the `ds` half of server/export.mjs, or the action half of the MCP tools.
     CLAUDE.md keeps a one-line definition and points here. -->

## The third engine

A collection is baked into the published HTML, so a prototype's "Mark as done" could toggle a class and never change the status behind it. **Actions** are the data engine, beside interactions (classes) and animations (inline styles):

```
interactions  →  write CLASSES        (node.interactions, state-keyed per effect)
animations    →  write INLINE STYLES  (node.animations, keyed per binding)
actions       →  write DATA           (node.actions, ops against the route store)
```

`src/lib/shared/state.js` is the ONE definition of what an op does, imported verbatim by the exporter, the published runtime and the MCP validators — the same discipline `shared/motion.js` has, and for the same reason: the semantics must not be able to drift between the surface that writes a binding and the surface that runs it.

**Nothing reaches the server.** The store is the visitor's browser only; `persist` decides whether it outlives the page. `get_collection` shows what was published, never what a visitor did.

## Ops live INLINE on the binding, not in a library

The one shape difference from the two engines beside it. `node.interactions` and `node.animations` carry an id into a project-level library because a class set and a timeline are reused across a site; an op list is `set status=done` and belongs to the button that writes it. So there is no `project.actions`, no `list_actions`, and no resolution step — which is also why `bindActions` needs no `actionId` and one call is enough.

## Every value is a string

`lib/collectionFields.ts`'s rule, enforced in `coerceFieldValue`: `number` is `"12"`, `boolean` is `"true"`/`"false"`, a `select` is the option VALUE. One storage shape is what lets a bound attribute, a `data-[…]:` variant and the numeric-aware sort read the same thing — an op that wrote a real number would restyle a `data-[done=true]:` pill into nothing.

**A `multi-` field keeps its ARRAY.** `applyListQuery`'s `equalsCurrent` tests membership with `.includes`, so a comma-joined string reads as one id nothing matches and the list it filters comes back silently empty. `sameValue` exists because `===` on two equal arrays is false, so every write of one read as a change and re-rendered the route.

## A target entry is resolved at EXPORT, from the binding's own scope

An explicit `entry: "<id>"`, else the entry in scope where the binding sits, else **refused at bind time** with both ways out named. The scope rule is `shared/entryScope.js`'s — the same one that decides an interaction's state key — so a "Done" checkbox inside a row writes that row's entry and one outside every list writes the route's.

Resolved in the browser instead, the runtime would have to rediscover the repeat from the DOM, and a row's checkbox would write whichever entry it found first.

**But the ROW wins over the index baked at export.** A row the runtime builds is a clone of the `<template>`, so its trigger carries whichever entry the template happened to be rendered from. Read from that index, a card that migrated columns wrote the FIRST card's entry: the move appeared to work once and then rewrote someone else's task. `data-ds-e` on the row is the live truth, re-stamped on every build, and it is read at FIRE time — a row can be moved, and re-stamped, between wiring and the click.

## Entry ids are NOT interned, and that is deliberate

Every effect key on a published route goes through `fxWire`'s intern table, because a key's only job there is to match a trigger to its listener. An entry id is different: it means something OUTSIDE the file. It is the identity the store, the persisted diff and a `create`'s reference field all share, and ONE storage key serves the whole site so a change made on `/task/x` is readable on `/board`. Interned, a diff written on one route could never be applied on another — which is the one thing cross-route state has to do.

Routes with no action ship none of this, so the zero-uuid measurement of the existing artifact is unaffected.

## What ships, and what a stateless route ships

`routeUsesState` is one pre-walk before the render, because `data-ds` has to be emitted or omitted as each element is written. A route qualifies on an action binding, a draft scope, or a two-way control binding anywhere in the trees it renders (component masters included — the trigger may well live inside a `<TaskCard>`).

A route that does not qualify ships **not one byte**: no attributes, no `ds` section, no fourth runtime. Coverage: `e2e/state-actions.spec.ts`.

The `ds` section rides the SAME sidecar as the effects rather than a second file — a route with actions almost always carries the interactions they restyle, so one deferred request serves both and the content hash still dedupes two routes with identical state.

Read shapes are interned like effect keys: `data-ds` is `[shapeIndex, …one entry index per read]`, so the 16 cards of a board share one `{field, kind, attr}` shape and differ only in which entry each read points at.

**`fields` is collected per COLLECTION, not per entry.** A task rendered in the "To do" column can be re-rendered into "Done" from that column's `<template>`, whose row may read fields the first render never touched. Per entry, the move blanked them.

## The list reconciler

`collection-list` re-runs its own `listQuery` against the store and reconciles: rows are MOVED where they exist and built from the `<template>` only where they do not, which keeps an input's focus, a row's open accordion and its already-played entrance intact when a sibling changes. Rebuilding the list outright is shorter and resets all three.

The template is the ordinary render of the first entry's row inside an inert `<template>`, so it carries the same `data-ds`/`data-ds-act`/`data-fx` wiring every other row has. A special placeholder render would be a second emission path that could drift from the real one — the bug class this codebase already pays for with its three renderers.

Four things it took a bug each to get right:

- **The row marker is stamped by the RUNTIME, from `ds.l[n].o`**, not written per row by the exporter. A row's top-level element is serialized before its own attributes are (its children are interpolated into the tag's template literal), so an attribute pushed from `attrsFor` landed on whichever descendant happened to be written first — the marker ended up on an inner `<span>` and every row read as "no entry".
- **The empty block is always emitted on a stateful route**, inside its own `data-ds-empty` wrapper, hidden while there are rows. A block that was never rendered cannot be shown when the runtime empties the list — and an UNWRAPPED one is worse than missing: the reconciler slices a list's children into rows, so an empty block sitting among them read as a row, and emptying that column deleted its own empty state.
- **A collection with no entries still gets a template**, from a synthetic blank entry that is deliberately kept OUT of the store (`ctx.dsSynthetic`) — its fields are registered, since nothing else on the route would register them, but as a store entry it would offer a blank row as a candidate to every list query. Without the template, the one list a `create` is most likely to target could never render the new row.
- **A read marked `h` (a reference hop) is never re-pointed.** `data-field="author.name"` renders a different entry's value, so a task moving column would otherwise redirect its author's name at the task.

A built row is a new DOM node wearing an old `data-fx`, so `site-runtime.js` grew a `window.__guanoFxRescan` hook and its element index became INCREMENTAL. Built once at load, a created row's trigger was never wired and its class list never recomputed: the row came back inert while every other row on the page worked. `apply()` runs on every rescan regardless, because a row that MOVED is an element the runtime has already seen and its class list still has to be recomputed against the states now fired. An appear trigger on a BUILT row is wired as already-fired (`wire(list, true)`) — the entrance already played for this list, and replaying it per re-render would flash every card on every write.

**Both motion runtimes answer that hook now.** `src/motion/runtime.ts` chains onto it rather than assigning, so whichever bundle loads second does not replace the other, and a built row gets its timelines re-indexed and its stagger frame adopted — without it, a row cloned from a `<template>` that carries a baked entrance frame arrived at `opacity: 0` with the cascade long finished and nothing left to play it, so a card that changed column vanished. → `docs/motion.md`

## Persistence

`settings.state.persist`: `session` (the default), `none`, `local`. One key for the whole site (`guano-ds:v1`), cleared by `?resetstate` along with every remembered `once` state.

**The default is `session`, not `none`.** A status set on a task's own route has to be in the right column on the board, and that is a second page load. The cost is that a visitor's edits outlive the page that made them, which the handbook states up front.

Only the **diff** is stored, and three things about it are load-bearing:

- **The baseline is copied before anything can extend `en`.** `slotFor` pushes a created entry onto `ds.en` so its DOM markers resolve, which would make it part of the baseline a diff is measured against — and a created entry recorded as "an existing entry with some fields changed" is dropped on the next load, because the fresh store has no such entry to apply a delta to. The task appeared, survived until reload, and vanished.
- **A created entry carries its `createdAt`.** `applyListQuery` sorts by it and the store does not hold it, so without it a task created on one route came back sorting as the oldest entry in its collection and reappeared at the TOP of the list it had been appended to.
- **Restoring runs LAST, once the lists are indexed, and reconciles them too.** It is not only a re-render: a status changed on another route moves a card to another column, and a task created on another route has no row on this one at all. Called before the lists were indexed, it repainted the bound leaves and left every row where the export put it — a board loaded fresh showed the old columns with the new labels.

The restore is a DEFERRED script, so a browser may already have painted the baked value. Applying it earlier would mean a blocking script in `<head>` on every stateful route, which costs every visitor a round trip to spare a one-frame flash on the routes that have a diff at all.

## Re-rendering goes through the same sanitizer as the first render

Golden rule 6. An entry value is written by a site user, so a re-render is no more trusted than a publish: `isRich(text) ? sanitizeRich(text) : textContent`. Plain text goes through `textContent`, which cannot parse markup at all. This is also why the state runtime is a BUILD (`src/state/runtime.ts` → `npm run build:state`) rather than a hand-written file like `site-runtime.js`, which imports nothing and could only have repeated the sanitizer.

## What refuses, and what warns

**Refusals** are at bind time, in `actionBindingError`, where the message can carry its own fix: an unknown field (with the `get_collection` call that lists the real ones), `toggle` on a non-boolean, `increment` on a non-number, a `select` value outside the options (a page matches on the VALUE, so an unknown one styles as nothing), a `create` with neither `values` nor `from`, and no entry in scope. The runtime's own ops are deliberately forgiving — by the time they run this has passed, and a published page whose runtime dies mid-click takes every other action with it.

**Warnings** at publish (`stateWarnings`), for the shapes a blob can carry without passing a writer — import, a 3-way merge, an agent: `action-target-unresolved`, `action-create-empty`, `action-draft-uncommitted` (what a visitor types is collected and never committed), `state-store-heavy` (over 150 entries on one route), `state-persistence-unused`.

Coverage: `e2e/mcp-actions.spec.ts`, `e2e/mcp-state-warnings.spec.ts`, `e2e/state-actions.spec.ts`.

## Known gaps

- **The Play surface does not run actions yet.** The published site and the static preview (`POST /api/preview`, the `preview` MCP tool) both do, because both go through `server/export.mjs`. `PreviewRenderer.vue` needs a reactive overlay that `useRenderNode`'s entry reads consult — the Vue equivalent of the store, not a second copy of it.
- **A bound `slider` ships no row template**, so its slides do not re-render. `collection-list` only.
- **A reference bound as TEXT is not re-rendered** — it renders the referenced entry's NAME through `refDisplay`, and the store carries field values rather than the names of entries the route never rendered. The exporter skips the bind rather than shipping one that cannot work.
- **A list can only re-render entries the ROUTE shipped**, so a `listQuery` `limit` caps what any action can reveal.
