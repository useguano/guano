# UI conventions: primitives, hosts, the rails and drawers, shortcuts

<!-- Read this before building or reshaping editor chrome. CLAUDE.md keeps the
     hard rules (uid(), the error surface, reuse the primitives) and points here. -->

## Primitives — reuse them, don't hand-roll

- **`src/components/ui/`** — `ButtonUI`, `InputUI`, `SelectUI`, `RowUI`, `ColorPickerUI`, `BadgeUI`, `IconGroupUI`, `StepperUI`, …
- **`components/popover/`** — `HostPopover` (the card) + `GroupPopover` (sections).
- **`components/modal/`** — `ModalHost`, sizes `sm | default | lg | xl | full`; `ConfirmModal`.
- **`components/accordion/`** — provide/inject open-state.
- **Two shared `@utility` classes in `main.css`** for the chrome's own repeats: `section-label` (the "ELEMENT"/"FIELDS" heading — seventeen copies of five utilities before it) and `menu-item` (a row inside a `MenuUI` panel, a const copied into two files).

## Never call `crypto.randomUUID()` — use `uid()`

From `src/lib/shared/ids.js`. `randomUUID` requires a secure context, so an editor reached over plain http at a LAN address — the ordinary way a self-hosted instance is opened from a second machine — threw on the first insert, component or entry.

The helper falls back to `getRandomValues` and keeps the v4 shape. There is deliberately **no `Math.random` tier**, because an id collision in a project tree is silent structural corruption.

## Errors have a surface

`useNotice()` + `NoticeHost`, bottom-centre at **z-115**, above `TooltipHost`'s 110 — an error a tooltip can cover is an error nobody reads, and it must stay visible over a modal.

`installErrorReporting` in `main.ts` wires `app.config.errorHandler`, `unhandledrejection` and `storeError` into it. Before it, an uncaught render error froze the editor with no message at all.

A notice `key` replaces rather than stacks. `storeFailure` carries the server's own refusal text **and whether a retry could ever help** — a Retry button on a 403 is a thing people press five times before believing it.

## A modal is a real dialog

`ModalHost` sets `role`/`aria-modal`, moves focus in, traps Tab and gives focus back — **and swallows the default action of Enter in a text input.**

Giving focus back is what made Enter reopen the dialog: a submit handler closes the modal, `onBeforeUnmount` returns focus to the `+` that opened it, and the SAME keydown's default action then activates that newly focused button. Every create modal (collection, component, group) reported success and came straight back, looking like a refresh that had not saved. Nothing inside a modal is a `<form>`, so there is no implicit submission to preserve, and preventing it once in the host covers every modal rather than waiting for the next one to be written with `@keydown.enter` and no `.prevent`.

A `ModalHeader` registers its heading id through provide/inject (`MODAL_LABEL`), so a dialog is named by its title however it was composed — and only when a header really exists. A destructive confirm is `alertdialog` and focuses its action.

`v-tooltip` is keyboard-reachable and wired through `aria-describedby`, which matters because an icon-only `ButtonUI` takes its accessible name from that tooltip.

## Floating UI goes through app-level hosts

Mounted once in `App.vue` (`components/host/`). **Never render a modal or popover with a local `v-if`, and never use the native `title` attribute.**

- **Tooltips** — the `v-tooltip` directive (`directives/tooltip.ts`; a string, `{text, side}`, or a `.bottom`-style modifier; `ButtonUI`'s `tooltip`/`tooltip-side` props wrap it) reports hover to `useTooltip`, and `TooltipHost` renders the single fixed-position label.
- **Modals** — `useModal().openModal(Component, props)` returns a promise resolved with the component's `close` payload; `useModal().confirm({title, message, confirmLabel?})` is the promise-based destructive confirm. `ModalStackHost` renders the stack (modal components keep their own `ModalHost` shell and emit `close`) and owns the one Escape listener, popping the top only.
- **Popovers** — `usePopover().openPopover({id, component, props, anchor, placement, title, icon, closeOnOutside?, closeOnEscape?, onClose?})`, one at a time. `PopoverHost` renders the `HostPopover` shell at fixed coordinates, rAF-tracking the anchor rect so canvas pan/zoom just works, with flip/clamp from the shared `lib/floating.ts` (`computeFloatingPosition`, also used by `TooltipHost`).

The sidebar panel (`SettingsEditor` → `PanelPopoverBody`) opts out of host Escape and keeps its own close-and-refocus handler; the comment thread is `CommentThread`, opened by `CommentMarker`.

**Dropdowns are not floating UI** — they are form controls, so they stay inline. Open/close and outside-click come from the per-instance `useDropdown()` composable (not a singleton), used directly by `SelectUI`, `MenuUI` and `ColorPickerUI`.

## Where a component file goes

**`components/shared/`** is for anything serving both Build and Preview: `CommentsEditor`, `CommentThread`, `SettingsPanel` + `UsersSettings`, `PublishDialog`, `CreateCollectionModal`, `MediaLibraryModal`, `SettingsGroup`, plus the render infrastructure `EntryScope` / `CommentMarker` that the published site uses too.

**`components/editor/`** is grouped by subsystem, with **no loose files at its root**:

- `canvas/` — CanvasViewport, CanvasEditor, ComponentsBoard, ElementRenderer, FrameScope, VariantScope, ContextMenu, InsertDock, InsertDragChip, ModeToggle, CreateComponentModal
- `layers/` — LayersPane, LayerRow, useLayerSurface + layerFilter/layerLabel/layerState
- `style/` — StyleEditor + the class/spacing/size/border controls
- `interactions/` — InteractionsEditor, ActionOptions (the popover is only an index now, so nothing else is left here)
- `effects/` — EffectsDrawer, TriggerEditor, EffectBody, EffectEditor, EffectLibrary, EffectNameField, StyleEffectEditor, TimelineEditor
- `content/` — DataEditor, RichTextInput, MediaPickerControl, IconPickerControl
- `forms/` — FormSubmissionsModal
- `sidebar/` — AppRail, SettingsEditor, PanelPopoverBody, PagesDrawer, PageSettingsEditor, CollectionSettingsEditor, ComponentsDrawer, ComponentSettingsEditor, CreateComponentGroupModal, PublishPopover, VariantAxesEditor, DrawerShell/DrawerSection/DrawerField, EntryFieldControl
- `media/`, `drafts/`, `users/`

## The two rails

**The left rail (`AppRail`)**: **App** (the logo — the bare page canvas, in Edit, no column), the **AI drawer** (first of the buttons, and only when a desktop host offers one), **Pages**, **Components**, then the media library, project settings + account (`SettingsPanel`, which contains `UsersSettings`) and logout. **The surface switch is not in the rail** — it is the canvas's Edit / Play toggle, because it is a mode of the page you are on rather than a place to go.

**The right rail (`SettingsEditor`)**: the save-status button that opens the publish popover (`PublishPopover`), the comments popover (`CommentsEditor`), and the panel buttons. ⌘P opens `PublishDialog`, which auto-runs the publish on mount. Semantic status colour tokens are `text-success` / `text-pending` / `text-danger`.

There is no header: the two rails own the chrome.

**Under the desktop launcher the rails give four things up**, because the app's own window already provides them: the **App** item (with its non-interactive `v-else` twin and the divider after it — hide the button alone and a contributor stares at a dead logo), **My account**, **Logout**, and the right rail's **save-status/publish button**. The decision is `host` on `/api/auth/me` (→ `docs/server.md`), exposed by `useAuth` as three computeds named for the CONCERN — `showsAppHome`, `showsAccountControls` (account and logout are one concern: identity chrome), `showsPublishControl`. `host` itself is never exported and there is no `isLauncher`: this file already records two bugs from gating on the cause rather than the intent (Layers on `isBuild`, `ContextMenu` mounted per mode). `mt-auto` pins the bottom group, so it moves to Project settings when the account buttons go. **Project settings stays** — it is the project's, not the person's.

Two consequences worth knowing before changing any of it. The status button is **also the only save-status surface** (`SAVE_ICONS`/`SAVE_COLORS`, `aria-live`), so hiding it obliges the host to show save state: `src/lib/hostBridge.ts` posts `usePersistence().status` out over a `WKScriptMessageHandler` named `guano`, and the host calls back through `window.__guanoHost` (`openPublish`, `sessionRestored`, `sessionLost`). And the **Account section is NAVLESS** (`NAVLESS_SECTIONS`, reachable only from the My account button), so hiding that button removes password changes in launcher mode — accepted knowingly; they happen in a browser. Coverage: `e2e/auth-launcher-session.spec.ts`.

## The AI drawer is the rail's first button and a third column

`AgentDrawer` (⌘J) is the left rail's **first** item and a docked 16rem column,
not a canvas affordance. It was a dock in the bottom-left corner beside
`InsertDock` for exactly one commit: a chat is a place you work for minutes at
a time, and a floating panel over the canvas is the wrong shape for that — it
covered the page it was editing, and it could not exist in Play, which is where
contributors live (→ `docs/agent-panel.md`, Who may drive it).

**It is the third value of `column`**, which is what keeps the drawers mutually
exclusive for free: `'pages' | 'components' | 'agent' | null`, one ref, so
opening the chat closes Pages by the type rather than by two components
agreeing to. `visibleColumn` lets it through in **both surfaces** (like Pages,
unlike Components) — a chat is not a Build-only surface.

**The drawer owns no state.** The transcript lives in the `useAgentChat`
singleton, so closing the column and reopening it brings the conversation back;
there is deliberately no second `open` ref beside `column`. It does not use
`DrawerShell` either — that shell always renders a search field above its list,
and a chat has nothing to search.

**The agent-lock scrim is the canvas's, not the app's.** `AgentLockHost` mounts
in `BuildView` over the canvas region, so the drawer — and every input — stays
usable while the agent writes; it used to be `fixed inset-0` in `App.vue` and
froze the chat that was driving the agent.

**No Escape, no outside-click.** A persistent column never closes on Escape
(`useDrawerEscape` peels a layer *inside* a column, never the column itself),
and the chat has no layer to peel. Same rule as the Layers view: only the rail
button closes it.

The button is `v-if`'d on `useAgentChat().available`, which is false until a
desktop host says it found a `claude` binary — so in a browser the rail looks
exactly as it always did. Not `host === 'launcher'`: that is the cause rather
than the concern. → `docs/agent-panel.md`

Both canvas dock buttons carry an `aria-label` for the same reason: they are
raw icon buttons, and `v-tooltip` only sets `aria-describedby` while the tooltip
is showing, so the insert `+` had no accessible name since it was written.

## The right sidebar's panels

`SettingsEditor` + `usePanel`, one panel open at a time: **data · style · interactions · branches** (branches is labelled "Drafts" in the UI).

They open from the right rail and — with the tree focused — from **S / D / I**, which open the panel with its primary input focused (`usePanel.openPanel(id, {focus})` → each panel's `pendingFocus` consumer). Escape closes the panel and hands focus back to the tree (`requestReveal`).

**Per-page custom code is deliberately NOT a sidebar panel.** It is page metadata, so it lives in the page's own settings view (`PageSettingsEditor`, reached from the Pages drawer), pages-only (entries have no `customCode`) and `canBuild`-only — the server 403s a contributor's custom-code write, so offering the input would only produce a failure.

## A Layers row carries ONE badge

The Zap, and only to say the element is wired: its own bindings or its master's, interactions AND animations. The master's animations were missing from the test, so an element whose only motion lived on a component master drew nothing.

It opens the Interactions panel on click, has no tooltip, and is labelled "Has interactions" rather than "Interactions" so it does not collide with the rail button of that name.

The Palette and Paperclip badges beside it are gone — "this element has classes" and "this element has content" is true of nearly every row, so three icons per row said less than one.

## Canvas and column are independent

`useViewMode`. `canvas` is `'page' | 'components'` — what the centre shows. `column` is `'pages' | 'components' | 'agent' | null` — which docked 16rem track is open.

Keeping them apart is what lets the board stay up at full width when Components is pressed again, and opening a page hands the canvas back — done inside `usePage.setActivePage`, not a watcher on the page id, so re-opening the page you are already on still works.

`column` is ONE ref rather than a flag per column, so the invariant is the type — which is how the AI drawer became mutually exclusive with the other two by being added to it, with no code anywhere closing anything. `pagesOpen`/`componentsOpen` are computeds over it; `visibleColumn` is what `EditorLayout` renders (it hides the Build-only column in Preview without forgetting it); `showComponents` is a *canvas* test. The contributor pin clears `components` and resets the canvas.

## There is no Layers column

Layers live inside the two drawers. In **Pages**, a row reveals an **Edit icon** on hover — pages, and collections that have a template page — which puts the page on the canvas and swaps the drawer's list for `LayersPane`. In **Components**, a row **expands in place** to show that component's tree, keyed by the def's **id**.

**Layers are a build-role view, not an Edit-surface one.** The Edit icons and the row click that opens them are `canBuild` ALONE, the icon never switches the surface, and switching to Play leaves an open `LayersPane` exactly where it is. The tree is how a builder works on structure, and the sidebar panels it feeds are already per account type rather than per mode, so gating it on `isBuild` left an admin in Play able to inspect an element but with no way to reach one.

For the same reason the structural shortcuts (⌘C/X/V/D/G, Delete, ⇧↑/⇧↓) gate on `canBuild` rather than `isBuild`, and `ContextMenu` mounts on `canBuild` — a layer row's right-click opens it, so mounting it per mode made that right-click dead in Play. ⌘E and ⌘⇧E stay Edit-only, because the insert dock and the effects drawer are surfaces that do not exist in Play.

The Pages drawer's list swaps for three detail views: `LayersPane`, `PageSettingsEditor` (a page or an entry), and `CollectionSettingsEditor` (a collection's fields and URL prefix — which before could only be edited from the Data panel with the template body selected, so a data-only collection had no way in at all).

**The Layers view is deliberately NOT Escape-peelable.** It is a working surface, and Escape is what closes a panel, the ⌘E dock and a target pick while you work in it — each of which also used to throw you back to the page list. Only Back leaves it.

## Escape for a docked column

`useDrawerEscape`: a persistent column may claim the key only while the last pointerdown or focus landed inside it AND it has a layer to peel (a filter, a detail pane). It never closes the column, and it stands down while an insert drag is in flight.

**A text field keeps Escape only while it has something to discard** (`hasPendingText` in `useShortcut.ts`, used by the effects drawer's own capture handler). `isEditable` alone was too blunt: the class strip commits on Enter and KEEPS focus, so the field sat there empty with no claim on the key while the drawer around it had one — and ⌘⇧E → type a class → Escape left the drawer open, which read as the drawer ignoring Escape entirely. A field with text in it still wins, because there Escape means "discard this". Coverage: `e2e/ui-interactions-panel.spec.ts` (three of its cases press Escape straight after typing a class).

## Styling state and the class validator

Styling state is the whitespace-separated `node.classes` string, edited as tokens through `useClassField` / `ClassInput` and the `STYLE_SECTIONS` catalog + `applyClass` in `lib/styles.ts`, which validates a typed class, replaces the conflicting token on the same property, and auto-injects flex/grid prerequisites.

**What the validator accepts is a product surface, not a detail**: an agent that cannot express something probes by creating throwaway objects, so a refusal names the accepted SHAPE (`unknownClassHint`) rather than only saying no.

Beyond the catalog it takes arbitrary properties, including:

- **custom properties** — `[--bg:#08090b]`, each `--name` its own conflict group;
- **the v4 shorthand that reads one back** — `bg-(--bg)`, `text-(color:--fg)`, expanded to the `-[var(…)]` form before the group is decided, so they group together;
- **ancestor-state variants** — `in-[.dark]:`, `group-[.open]:`, and the ampersand-anywhere `[.open_&]:`, which is the only way one toggle restyles a subtree, since an interaction changes its target's classes alone;
- `scheme-*`, and the `dark`/`light` markers.

Tree helpers (`walkNodes`, `findNode`) live in `lib/tree.ts`; the shared `createNode` is in `lib/elements.ts`.

## Keyboard shortcuts

Everything goes through `useShortcut` (`useKeymap` for modifier-aware bindings), guarded against firing inside inputs unless a binding passes `allowInInput`. The README's "Keyboard shortcuts" section is the user-facing list.

They are programmed in **four** places, by scope:

1. **`useEditorShortcuts`** — app-wide, registered once in `BuildView`.
2. **`useLayerSurface`'s `onKeydown`** — the tree.
3. **`CanvasViewport`** — the camera (`⌘+`/`⌘-`/`⌘0`, and `useShortcut('Space')` for pan-on-drag).
4. **`useCommentMode`** — the bare `C`.

**Escape is deliberately in none of them.** Each layer owns its own listener, so the peel order falls out of who is mounted: `ModalStackHost`, `useEffectsDrawer`, `PopoverHost`, `useDrawerEscape`, and `InteractionsEditor` for a pending target pick.

In the app-wide set: Style/Data/Interactions open with **S / D / I while the Layers tree has focus** (the tree owns them, so they can never fire while typing elsewhere); **Shift+↑/↓** moves the selection one slot (app-level, so it works from the canvas too); and the structural ones — ⌘C/X/V/D, ⌘G wrap-in-div, delete — **self-gate to Build mode** via `isBuild` rather than being a separate Preview keymap. ⌘Z/⌘⇧Z, ⌘S (save), ⌘E (the in-canvas insert dock, `useCommandPalette`) and ⌘P (publish) work in both surfaces, and so does ⌘J (the AI drawer — it toggles `column`, and no-ops while the agent is unavailable).

## The two surfaces

One admin shell (`BuildView` at `/admin`, laid out by `EditorLayout`) with **two surfaces** over one shared document, switched by the **Edit / Play** toggle at the bottom-right of the page canvas (`ModeToggle`; the bottom-left corner is the ⌘E Insert dock's). It is a runtime mode in `useViewMode`, **not a route**.

**Edit / Play is the UI's whole vocabulary for this; the internals stay `build`/`preview`** (`mode`, `isBuild`, `isPreview`, `SitePreview`, `PreviewRenderer`), and `ModeToggle` is the one place both names appear.

**Build** (shown as **Edit**) — the left **rail** (`AppRail`), one optional 16rem **column** (Pages or Components — a page's and a component's **layers** are edited inside them), the infinite **canvas** — the open page's breakpoint frames (`CanvasEditor` → `ElementRenderer`) or the components board (`ComponentsBoard`) — and the right **settings rail + panel** (`SettingsEditor`).

**Preview** (shown as **Play**) — the Build-only columns drop out and the centre becomes the full-site render (`SitePreview` → `PreviewRenderer`). For an admin or editor it is **read-only**: the site the way a visitor gets it, with links navigating (state-driven, no URL change), interactions, animations, scrub, sliders and smooth scroll all running for real, no editor affordance drawn over it, and text edited on the Edit canvas (`ElementRenderer`). Anyone can add a **comment** (hold C, click). **A contributor also edits content on the render** (`usePreviewEditing`, gated on `!canBuild`): double-click text to edit it in place (`useInlineEdit` with `escBehavior: 'save'`; field-bound text writes the entry, locale-aware), double-click an image/video to replace it from the media library, and right-click for **Edit content** / **Replace background** (the menu lives in `SitePreview`). Text inside a component instance is per-instance content, so it is editable; a background inside one is the master's (`backgroundInfo` renders from it, and the contributor merge keeps masters), so it is not offered. While editing is on, a link's single click waits 250ms (one shared `pendingNav` timer) so a double-click can cancel it; for builders a click navigates at once. The chrome around it still edits: the sidebar panels are per account type, not per mode, so an admin keeps the full Data/Style/Interactions inspector in Play, and the Pages drawer keeps its page/item settings. **Contributors are pinned here** (`useViewMode` forces the mode the moment `canBuild` resolves false; the Components rail button, the Pages drawer's Edit-layers icons and the toggle itself are hidden for them, so they only ever see Play and never learn there was a switch) — which means a contributor's content editing is the in-place editing above, plus the **Pages drawer's** item/page settings (entry field values, name/slug/status/seo) and comments.

The toggle is a **page's** mode, so `BuildView` mounts it only when `canBuild && !showComponents` — the components board has nothing to play, and you leave it by opening a page. Leaving Edit closes the ⌘E palette (`ModeToggle` calls `closePalette`, not `setMode`, so the view-mode singleton never pulls in `useStructure`). It sits bottom-RIGHT so it never shares a corner with `InsertDock`, and its Play offset pays back the framed pane's `my-2` + border so switching doesn't move it under the pointer.

## Tailwind at runtime

Tailwind v4 (via `@tailwindcss/vite`), CSS-first with no config file — theme tokens live in `src/assets/main.css`. `@tailwindcss/browser` is dynamically imported in `CanvasEditor` so classes typed at runtime (and the project's design tokens) compile on the fly.
