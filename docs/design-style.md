# Superbird design style — handoff for the desktop launcher

Extracted from `src/assets/main.css` and `src/components/ui/` of the builder.
Stack it assumes: Tailwind 4 CSS-first (no config file), Geist Variable + Geist Mono, lucide icons.

## 1. The character of it

Dark-first, near-neutral greyscale, no brand hue in the chrome. Colour appears only
as *status* (success / pending / danger) and as two *semantic* accents (component
purple, CMS teal). Everything is small: 12px is the body size, 10px is the label
size. Rounding is generous relative to the size (lg/xl/2xl on tiny controls), which
is what keeps it from reading as a dense IDE. Flat — no gradients, no inner shadows;
depth comes from `bg-input` fills and a single shadow on floating surfaces.

## 2. Tokens — copy verbatim

```css
@import 'tailwindcss';
@import '@fontsource-variable/geist';
@import '@fontsource-variable/geist-mono';

:root {                                       /* DARK is the default */
  --background: oklch(14.479% 0.00002 271.152);
  --foreground: oklch(0.985 0 0);
  --input: oklch(24.776% 0.00003 271.152);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --accent: oklch(0.371 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --success: oklch(67.795% 0.14069 152.642);
  --pending: oklch(82.444% 0.12144 90.081);
  --danger:  oklch(64.087% 0.17546 20.635);
  --state-class: #c099ff;
  --layer-component: #c099ff;
  --layer-cms: oklch(78% 0.13 180);
}

.light {                                      /* opt-in, via a CLASS, not a media query */
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --input: oklch(95.213% 0.00011 271.152);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --accent: oklch(78.261% 0.00009 271.152);
  --success: oklch(0.627 0.194 149.21);
  --pending: oklch(0.681 0.162 75.83);
  --danger:  oklch(60.49% 0.08577 16.016);
  --state-class: #8d5bd6;
  --layer-component: #8d5bd6;
  --layer-cms: oklch(55% 0.12 180);
}

@theme inline {
  --font-sans: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, monospace;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-input: var(--input);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-success: var(--success);
  --color-pending: var(--pending);
  --color-danger: var(--danger);
}

body { @apply bg-background text-foreground font-sans antialiased select-none; }
input, textarea { user-select: text; }
```

`select-none` on the body with the opt-back-in on inputs is deliberate — it is what
makes the web app feel native, and it matters even more in a desktop shell.

Dark mode is **class-based** (`.light` on the root), never `prefers-color-scheme`.

## 3. Type scale

| Use | Classes |
|---|---|
| Body / control text | `text-xs` (12px) |
| Button, lg button | `text-sm` / `text-base` |
| Meta, units, captions | `text-[10px] text-muted-foreground` |
| Section heading | `text-[9px] font-medium tracking-wide text-muted-foreground uppercase` |
| Code, ids, badges, keys | `font-mono text-[10px]` |

Two shared utilities worth copying:

```css
@utility section-label {
  @apply text-[9px] font-medium tracking-wide text-muted-foreground uppercase;
}
@utility menu-item {
  @apply flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none;
  @apply hover:bg-accent/30 focus-visible:bg-accent/30;
}
```

## 4. Geometry

- Radii: `rounded-md` badges · `rounded-lg` inputs, menu rows · `rounded-xl` buttons, menu panels, tiles · `rounded-2xl` modals and popovers · `rounded-full` toggles, dots.
- Control heights: **h-7** (28px) compact input/select · **h-9** default button and row · **h-10** lg button · **h-12** lg input (auth forms) · **h-6** xs button.
- Gaps: `gap-1` / `gap-1.5` inside a control, `gap-2` between controls, `gap-16` between major blocks on a centred screen.
- Rails/columns: left rail `w-12`, docked column `16rem`, auth form `w-90`.
- Icons: lucide, `size-3` (xs) · `size-3.5` (sm/compact) · `size-4` (default) · `size-5` (lg).

## 5. Interaction language

- **Hover** is always `hover:bg-accent/30` + `hover:text-accent-foreground`. Not a border change, not a lift.
- **Focus** is always `outline-none focus-visible:ring-2 focus-visible:ring-accent`.
- **Disabled** is `disabled:pointer-events-none disabled:opacity-50`.
- **Active/selected** in a rail or list = `text-accent-foreground` against `text-muted-foreground` siblings; selected rows get `bg-accent/30`.
- Transitions are `transition-colors` only. No scale-on-hover anywhere.

## 6. The components, as written

**Button** — base: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0`

| variant | classes |
|---|---|
| default | `bg-primary text-primary-foreground hover:bg-primary` |
| danger | `bg-danger text-white hover:bg-danger/90` |
| outline | `border border-accent bg-transparent hover:bg-accent/30 hover:text-accent-foreground` |
| ghost | `bg-transparent hover:bg-accent/30 hover:text-accent-foreground` |
| icon | `bg-transparent hover:text-accent-foreground` (no fill on hover) |
| mono | `bg-transparent font-mono hover:bg-accent/30` |

sizes: `h-9 px-4 text-sm` / sm `h-9 px-3 text-xs` / lg `h-10 px-6 text-base` / xs `h-6 gap-1 px-2 text-[10px]`.
Icon-only variants drop the padding (`p-0`) and are squared by a width class (`w-7` in the rail).

**Input** — compact `h-7 px-2 text-xs rounded-lg bg-input outline-none` (filled, borderless);
large `h-12 px-3 text-xs rounded-xl border border-input outline-none` (outlined, used on login/setup).
Both: `w-full placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent`, `spellcheck="false"`.
A unit suffix is `absolute right-2 text-[10px] text-muted-foreground`.

**Select** — the input shell plus `pr-6`, a `ChevronDown size-3.5 text-muted-foreground` absolutely at `right-1.5` that
`rotate-180`s when open. Panel: `mt-1 max-h-44 rounded-md border border-input bg-background p-1 shadow-md`, rows
`rounded px-2 py-1 text-xs hover:bg-accent/30` with a leading `Check size-3` that is `opacity-0` when unselected
(so nothing shifts).

**Toggle** — `h-4 w-7 rounded-full`, track `bg-foreground` on / `bg-accent` off, knob `size-3 rounded-full bg-background`
translating `0.5 → 3.5`. Tiny, monochrome: on-ness is the foreground colour, not a green.

**Badge** — `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]`,
`bg-secondary text-secondary-foreground`, or `bg-state-class/15 text-state-class` for the purple state variant.

**Row** (the label/control pair that every panel is built from) — `flex gap-2 min-h-9 px-2.5`, label
`w-18 shrink-0 truncate text-xs`, control area `flex-1 gap-1.5`. Fixed label column is what makes the panels line up.

**Empty state** — `rounded-xl border border-dashed border-input`, a `size-1.5 rounded-full border` dot, then
`text-xs text-muted-foreground`. Never an illustration.

**Modal** — overlay `fixed inset-0 z-100 bg-accent/25 backdrop-blur-sm`; panel
`rounded-2xl bg-background shadow-lg`, `max-h-[85vh] overflow-y-auto`.
Enter: opacity 0.18s ease + `transform 0.22s cubic-bezier(0.16,1,0.3,1)` from `scale(0.96) translateY(6px)`,
with a `prefers-reduced-motion` opt-out.

**Popover / menu panel** — `rounded-2xl border border-input bg-background shadow-xl` (popover) or
`rounded-xl border border-input bg-background p-1 shadow-lg` (menu). Header: `border-b border-input py-1 pl-3 pr-1`,
title `text-xs font-medium` with a `size-3.5 text-muted-foreground` icon, close is an icon button — **no tooltip on a close button**.

**Divider** — `h-px w-full bg-input`. Never a border-colour line.

**Scrollbar** — thin, 6px, thumb `color-mix(in oklch, var(--muted-foreground) 35%, transparent)`, `rounded-full`,
transparent track, 60% on hover. Class `.custom-scrollbar`.

## 7. Motion

Four named animations, all `cubic-bezier(0.22, 1, 0.36, 1)` or ease-in-out. The launcher splash is
literally the app's loading screen — reuse it:

```css
--animate-land:  land 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;   /* logo arrives: scale .6, y 24px, rotate -8deg */
--animate-float: float 3.2s ease-in-out 0.7s infinite;            /* then bobs: y -10px, rotate 2deg */
--animate-glow:  glow 3.2s ease-in-out 0.7s infinite;             /* halo behind it: opacity .35→.7, scale .9→1.15 */
--animate-rise:  rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) .35s both; /* caption: y 6px, fade */
```

Full-screen loader markup:

```html
<div class="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
  <div class="relative flex items-center justify-center">
    <div class="absolute size-40 rounded-full bg-foreground/15 blur-3xl motion-safe:animate-glow"></div>
    <div class="motion-safe:animate-land">
      <!-- MainLogo -->
      <svg class="size-24 text-foreground motion-safe:animate-float">…</svg>
    </div>
  </div>
  <p class="text-xs text-muted-foreground motion-safe:animate-rise">Starting…</p>
</div>
```

All of it is `motion-safe:`-gated.

## 8. The layout pattern a launcher should follow

The login screen is the closest existing analogue and the right template:

```html
<div class="flex min-h-screen flex-col items-center justify-center gap-16 bg-background">
  <MainLogo class="size-12" />
  <form class="flex w-90 flex-col gap-2">
    <InputUI size="lg" placeholder="…" />
    <ButtonUI class="mt-4">Primary action</ButtonUI>
    <div class="flex items-center justify-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
      <CircleAlert class="size-3.5 shrink-0" /> error text
    </div>
  </form>
</div>
```

Centred, logo above at `size-12`, a fixed `w-90` stack, `gap-2` between fields and `mt-4` before the primary
button. Errors are an inline `bg-danger/10` strip, never a toast at the top.

For a list of instances/projects, use the rail+rows vocabulary instead: `h-9` rows, `rounded-lg`, hover
`bg-accent/30`, a `size-4` lucide icon, `text-xs` name with a `font-mono text-[10px] text-muted-foreground`
address beside it, and a `size-1.5 rounded-full bg-success / bg-pending / bg-danger` status dot
(`ring-2 ring-background` when it overlaps an icon).

## 9. Rules the app holds to — keep them in the launcher

- No native `title` attributes. Tooltips are a custom host, and obvious controls (X, close) get **none**.
- No header bar: chrome is a left rail of icon buttons plus the content.
- Status colour is always one of `text-success` / `text-pending` / `text-danger`.
- Monospace is reserved for machine strings — ids, ports, URLs, class tokens, keys.
- Logo: `src/assets/MainLogo.vue`, a `viewBox="0 0 1345 1152"` svg with `fill="currentColor"` — colour it `text-foreground`.
