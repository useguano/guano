// A BACKSLASH anywhere is refused, which is what the leading lookahead is
// for. Per the WHATWG URL parser a `\` is a `/` for every special scheme, so
// `/\evil.example` reads as root-relative here and navigates to
// https://evil.example in a browser. That is not a privilege gain — an author
// may write the absolute url — but it defeats everything downstream that
// treats `/…` as internal: the locale prefix, `aria-current`, the dead-link
// check, and a reviewer reading the link.
export const SAFE_HREF = /^(?!.*\\)(\/|#|https?:|mailto:|tel:)/i

export const SAFE_SRC = /^(?!.*\\)(\/|#|https?:|mailto:|tel:|data:image\/|data:video\/)/i
