# Rendering: the shared core, scope, channels, and canvas cost

<!-- Read this before touching useRenderNode.ts, either renderer, or
     server/export.mjs. CLAUDE.md points here. The three renderers must
     stay in sync: ElementRenderer (Build), PreviewRenderer (Play), export.mjs. -->

## The shared core

`useRenderNode.ts` is used by two renderers: Build's `ElementRenderer.vue` (`components/editor/canvas/`) and Preview's `PreviewRenderer.vue` (`components/site/`). It resolves element type → tag, the component master mapping, collection/entry scope (`EntryScope` provide/inject), live interaction firing (hover/click/change via listeners, appear via IntersectionObserver, scrolled via a window listener), and class composition (`node.classes` + interaction classes).

Inside a component instance, style and interactions come from the mapped master while content stays the node's own. **Content precedence**: bound collection field → the node's own content → the mapped master's content. There is deliberately nothing after it — the element default is a Build-only placeholder (below).

`server/export.mjs` reimplements this same logic in plain JS to emit static HTML, and is the only renderer of the published site. **Keep the two in sync.**

## `editorHidden` is a hide that never reaches a visitor

Two hides, and only one of them ships:

- **`node.editorHidden`** — the eye on a Layers row and Hide/Show in the context menu — a hide for the person editing, which is why it persists in the document: a full-screen curtain or an overlay is put away once and stays away while the content under it is built. `hidden` in `useRenderNode.ts` returns true for it **only when `isPreview` is false**, so it takes the node out of the Edit canvas and nothing else: Play renders it, and `server/export.mjs` does not read the flag at all. It is not serialized by `lib/html/`, so it is invisible to an agent and **does not move a page's `version`** — which is right, since no structure write can clobber it.
- **`node.hidden`** — the real one, resolved along the instance chain and honoured by all three renderers. → `docs/components.md`

It still lives in the project document, so it autosaves, undoes, and travels on a branch merge like any other node state; it is simply ignored by everything that ships bytes. The eye wrote `node.hidden` until it was split out: hiding a layer to get it out of the way deleted it from the published site, which is not what an eye in a tree means anywhere else. The row dims for **either** flag — a part a master or an agent hides is still shown as hidden — but the eye's icon and `data-layer-hidden` track `editorHidden` alone. Coverage: `e2e/ui-layers.spec.ts` ("the Layers eye hides a layer in the editor only").

## An element's DEFAULT CONTENT is an editor placeholder, and ships nowhere

`def.defaultContent` in `shared/elements.js` — "Lorem ipsum" on a heading, "Dolor sit amet" on a `span`/`paragraph`, "Option" on an `option`.

It is the third Build-only affordance, beside the empty box and the Layers eye: a fresh element needs something to see and click, and a published page needs the words someone actually wrote. `contentInfo` in `useRenderNode.ts` returns `''` when `isPreview`, and `server/export.mjs` has no `defaultContent` fallback at all.

It used to ship. An empty `<span>` is how a colour dot, a badge dot and a toggle knob are built — geometry with no words — and every one of them published **"Dolor sit amet"**, once per dot, with the canvas giving no hint that it would: the placeholder looked exactly like content someone had typed. The content precedence is therefore **bound collection field → the node's own content → the mapped master's content**, and nothing after it.

This was the one change in this area that moved published bytes: one half-built page in the corpus went from `<h2>Lorem ipsum</h2><p>Dolor sit amet</p>` to `<h2></h2><p></p>`. The 600-odd other nodes that resolve only a default all sit inside component instances and take their text from a master, which still falls back as it always did. Coverage: `e2e/render-placeholders.spec.ts`.

## An empty container gets a box on the Build canvas, and NOWHERE else

`emptyBox` in `ElementRenderer.vue`, `declaresOwnBox` in `canvas/emptyBox.ts`.

`section`/`div`/`header`/`grid` seed no child — only `label`/`button`/`link` do — so a fresh one renders as zero height with no background: invisible, unselectable on the canvas and impossible to drop into, which is the one thing a tree editor must not be.

It is given `min-h-10` plus a hairline dashed outline when it is a non-leaf element with **no children, no resolved content, and no class of its own that declares a box** — a height (`h-`/`min-h-`/`size-`/`aspect-`), vertical padding (`p-`/`py-`/`pt-`/`pb-`, which gives an empty box height), or self-placement (`absolute`/`fixed`/`hidden`/`contents`).

The test runs on `framedClasses`, the breakpoint-resolved string, so an element sized only at `md:` keeps the box in the mobile frame. It lives in `ElementRenderer`'s `classes` computed beside the selection outline and the drop indicator — editor affordances, like a list's row template being drawn for an empty collection — so **Play and the export never see it** and no published pixel moves. The selection and drop classes carry `!` so they still win.

Types with a canvas shape of their own are exempt: `body`, `collection-list`, `collection-item`, `slider`, `custom-code`. Coverage: `e2e/ui-layers.spec.ts` ("an empty container is given a box").

## Binding scope is decided by the TARGET, not the trigger

`src/lib/shared/entryScope.js`, imported by `useInteraction` and `export.mjs`.

An interaction's state key is `interactionId:targetId[@scope]` and an animation's play key is `bindingId[@scope]`, where the scope is the component instance plus — **only when the binding's owner and its target share one entry scope** — the entry.

`buildScopeRoots` is the index: a node is in an entry scope when it sits inside a `collection-list`, inside a bound `slider`, or in the template body a `collection-item` embeds.

Keyed off the trigger, as it was until this was fixed, a row button that opened the ONE shared sheet outside its list wrote `X@e<row>` while the sheet, rendered once, listened on `X`. The key never matched, the click did nothing, and both `edit_elements` and `publish` reported success.

The entry part still earns its keep for per-row effects: without it, a hover on one card fires every repeat. Both renderers resolve it per BINDING, which is why the target indexes (`targetIndex`, `animTargetIndex`, `masterBindingIndex`, `buildPlainTargets`) all carry the owner id beside the binding. Regression coverage: `e2e/export-repeat-bindings.spec.ts`.

## A CHANNEL is the one target with no scope at all

`src/lib/shared/channels.js`, `isChannelTarget` in `shared/interactionKeys.js`.

A binding sets `targetId: "@start"` and every element carrying `channel: "start"` listens — wherever in the project it lives. That is the only way ONE modal can be opened from a header component on every route: a node id addresses one tree, and a master's binding keys per instance, so the overlay used to have to live inside whatever opened it (`buildPlainTargets` walks a route's page trees, which is exactly why a master's binding could never reach a page element).

Because the trigger and the listener are in different trees, **neither side can attach an instance or an entry scope** — the other could not reproduce it — so `scopeFor` returns `undefined` for a channel target in all three renderers, and an exclusive `group` on a channel binding is unscoped too, which is what lets one group span a page trigger and a master trigger.

`buildChannelIndex` is the project-wide index the exporter builds once per export and every listener reads — never "what has rendered so far".

`channel` is **shared** state like classes: inside an instance it is the master's, so a mirror cannot override it, and an instance wrapper cannot carry one because it emits no element.

**Tweens on a channel are `click` only.** A click play is the one tween key shared per (animation, target); every other trigger is keyed per binding, so two of them aimed at one channel would run two timelines on one element. A tween listener is matched by the BINDING key (`els[n].a`), so a channel binding's `k` is unscoped on both sides.

### What refuses a bad channel

`validateTree` refuses a bad name, a second listener in one tree, a listener on any component-typed node (an instance wrapper AND a master ROOT — both emit no element, so the listener's state key would have nowhere to land), and one inside a repeat ("it would open once per row"). `edit_elements {channel}` refuses the master root too — it was the one writer that did not, and so published a modal nothing could open while every tool reported success.

**What makes a wrapper emit no element is ONE shared predicate** (`isBareWrapper` in `shared/instances.js`). The exporter's copy ran BEFORE `attrsFor` and silently discarded everything that call would have written — the node's whole `data-fx` entry, its `ctx.fx` and modal registration — and tested a different set of keys from the canvas's (no channel, no animations, no "is anything aimed at this"), which made a root channel work or not depending on whether the root happened to carry a class.

`publish` warns `binding-target-unreachable` for a channel nothing published declares, and `channel-declared-twice` for a route that declares one twice — two instances of the component that LISTENS; two instances of the component that OPENS one are fine.

### Where a channel is written

Three places: `data-channel` in the HTML (a carried attribute, inside the version hash — a page read prints only a node's OWN value, so a component's channel is not echoed inside an instance and writing one there is refused); `edit_elements {channel}` (`""` clears; `bind_interaction`/`bindInteractions` take `channel` as sugar for `targetId: "@name"`); and the Data panel's **Channel** field (`useElement.setElementChannel`, master-aware through `editTarget`, returning whether it wrote like `setElementRef`) beside a **Channel** choice in the trigger's target picker.

Coverage: `e2e/export-channel.spec.ts`, `e2e/interactions.spec.ts`, `scripts/check-html.ts`.

## Canvas cost is per rendered element × frames

`useMasterBindings.ts` is the per-master index behind `scopedClassesFor` / `scopedTargetStateKeys` / `scopedAnimBindings`. Each used to walk the whole master through the reactive proxy, once per element inside an instance, which on a 9,500-element page (three frames of an app screen) was a 3.4 s freeze and 880 MB of heap. `propForBase` in `styles.ts` is memoized for the same reason — `mergeClassLayers` asked it per class of every element with variant overrides. `useRenderNode` creates its appear `IntersectionObserver` only for elements with appear bindings.

Measured on the Cocoapp prototype: open-page freeze 3.4 s → 1.2 s, heap 880 → 630 MB. What remains is Vue mount cost (~65 KB of composable state per element) and the browser restyling ~85k DOM nodes per Tailwind rebuild. **Rendering inactive breakpoint frames lazily is the next lever.**

**Per-element questions about shared state are per-id marks, never a comparison against one ref.** `isSelected` / `isHighlighted` / `dropPositionFor` in `useElement` read a `reactive(Set|Map)`, which tracks `has`/`get` per key, so a hover or drag change reaches two elements instead of dirtying a computed in all of them — `highlightedElement?.id === node.id` in every `ElementRenderer` and `LayerRow` cost ~15 ms per Layers-row hover on a 5,000-element page, before any render.

The marks are written only through `syncSet` (per-key delete/add — `clear()` notifies every key again) and the detached-scope watcher that mirrors `selectedElementIds`.
