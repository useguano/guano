/**
 * A v4-shaped unique id.
 *
 * `crypto.randomUUID` requires a SECURE CONTEXT. An editor served over plain
 * http on a LAN address — `http://192.168.1.20:4174/admin`, the ordinary way a
 * self-hosted instance is reached from a second machine — has none, and there
 * every id-minting path throws: insert an element, create a component, add an
 * entry. With no global error handler that was a white screen on first use.
 *
 * `crypto.getRandomValues` IS available in a non-secure context, which is why
 * the fallback is that and not something weaker. There is deliberately no
 * Math.random tier below it: an id collision inside a project tree is silent
 * structural corruption, and if neither Web Crypto primitive exists the honest
 * answer is to throw.
 *
 * The 36-character shape is kept so nothing that assumes the format breaks.
 *
 * @returns {string}
 */
export function uid() {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b) // throws if Web Crypto is missing entirely — see above
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
