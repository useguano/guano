// Security-critical URL scheme allowlists, shared VERBATIM by the editor
// renderers (useRenderNode), the rich-text sanitizer (richtext.js) and the
// static exporter (server/export.mjs) — one source of truth, no drift.

/** hrefs: same-site paths/fragments plus the safe external schemes */
export const SAFE_HREF = /^(\/|#|https?:|mailto:|tel:)/i

/** media src/background: the href allowlist plus inline image/video data
 * URLs. Blocks javascript:/data:text-html etc. — harmless today (no
 * iframe/script element exists) but a hard gate before any such element
 * is ever added. */
export const SAFE_SRC = /^(\/|#|https?:|mailto:|tel:|data:image\/|data:video\/)/i
