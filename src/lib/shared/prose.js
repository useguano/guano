// Long-form typography, shared VERBATIM by the canvas/preview
// (useThemeTokens injects it) and the static exporter (buildCss prepends it).
//
// Rich text is a tree of <p>/<h2>/<ul>/<blockquote>/<a> the AUTHOR cannot reach
// with classes — the sanitizer strips attributes, and until descendant variants
// existed there was no way to style a child from its container at all. So a CMS
// article rendered as unspaced, unstyled markup, and the usual workaround was to
// flatten it into <br><br> and literal "→ " bullets.
//
// This is one utility class, `prose`, written as a plain @layer so both surfaces
// compile the same source. It is deliberately small and token-driven — not a
// port of the typography plugin — so it inherits the project's colours and type
// scale instead of imposing its own.
//
// `currentColor` and `em` throughout: the container's own text-* and text size
// classes stay in charge, so `prose text-brand-blue text-lg` does what it reads
// like.

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
 * Project-defined Tailwind variants, compiled into both surfaces.
 *
 * `current:` targets the link that points at the page being rendered. The
 * renderer marks it with aria-current="page"; without a variant to hang styling
 * on, that state was unreachable — which is why "the active nav item looks
 * different" was impossible inside a shared header component (the master cannot
 * know which page an instance is on).
 *
 * `group-current:` is the same state on an ancestor marked `group`, for a card
 * whose inner elements restyle when the card is the current page.
 */
export const CUSTOM_VARIANTS = [
  '@custom-variant current (&[aria-current="page"]);',
  '@custom-variant group-current (&:is(:where(.group)[aria-current="page"] *));',
].join('\n')
