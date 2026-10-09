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

export const CUSTOM_VARIANTS = [
  '@custom-variant current (&[aria-current="page"]);',
  '@custom-variant group-current (&:is(:where(.group)[aria-current="page"] *));',
].join('\n')
