export const PROSE_CSS = `@layer components{
.prose{line-height:1.6;}
.prose :where(p,ul,ol,blockquote,h2,h3,h4,hr,figure):not(:first-child){margin-top:1em;}
.prose :where(h2,h3,h4){font-weight:600;line-height:1.25;}
.prose :where(h2){font-size:1.5em;}
.prose :where(h3){font-size:1.25em;}
.prose :where(h4){font-size:1.1em;}
.prose :where(h2,h3,h4):not(:first-child){margin-top:1.6em;}
.prose :where(ul,ol){padding-left:1.5em;}
.prose :where(ul){list-style:disc;}
.prose :where(ol){list-style:decimal;}
.prose :where(li)::marker{color:currentColor;opacity:.5;}
.prose :where(li)+:where(li){margin-top:.35em;}
.prose :where(a){text-decoration:underline;text-underline-offset:.2em;}
.prose :where(a):hover{text-decoration-thickness:2px;}
.prose :where(strong,b){font-weight:600;}
.prose :where(blockquote){border-left:2px solid currentColor;padding-left:1em;font-style:italic;opacity:.85;}
.prose :where(hr){border:0;border-top:1px solid currentColor;opacity:.2;margin-top:2em;margin-bottom:2em;}
.prose :where(img,video){border-radius:.5em;max-width:100%;height:auto;}
.prose :where(code){font-family:var(--font-mono,ui-monospace,monospace);font-size:.9em;}
}`

/**
 * `dark:` is CLASS-based in Guano, not `prefers-color-scheme`.
 *
 * An interaction can only ADD classes (and evict the base classes they
 * conflict with), which gives a toggle exactly two states — so a media query
 * cannot be part of the switch: with the OS in dark, removing `dark` would
 * fall back to dark and the toggle would read as broken. A class is the one
 * thing a toggle, `once: "local"` persistence, a design token override and a
 * `dark:` utility can all agree on.
 *
 * `light` is the symmetric escape, for a site whose default IS dark and for a
 * light island inside a dark section: it shares `dark`'s conflict group (see
 * shared/interactionClasses.js), so an interaction adding `light` takes a base
 * `dark` off, and it wins over an enclosing `dark` here and in the token
 * override block (modeTokensCss).
 */
export const DARK_VARIANT =
  '@custom-variant dark (&:where(.dark, .dark *):not(:where(.light, .light *)));'

export const CUSTOM_VARIANTS = [
  '@custom-variant current (&[aria-current="page"]);',
  '@custom-variant group-current (&:is(:where(.group)[aria-current="page"] *));',
  DARK_VARIANT,
].join('\n')
