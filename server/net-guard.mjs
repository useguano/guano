// Outbound-request guard: never let a URL an untrusted party influenced become
// a probe into the operator's network.
//
// The webhook forward (public/deliver.mjs) and the capability test both POST to
// a URL an admin typed into an integration. That request runs on the operator's
// machine with their network access, so a hostname check alone is not enough: a
// perfectly public name can resolve to 169.254.169.254 (cloud metadata), and a
// 302 hands the request to any host at all. Every URL is resolved and
// range-checked before it is used, and redirects are never followed
// (`redirect: 'manual'` at every call site).
//
// Caveat worth knowing: resolve-then-connect leaves a TOCTOU window — the name
// could resolve differently for the actual connection. Closing it needs a
// custom agent that pins the checked address; this raises the bar a long way
// without that machinery.
//
// NOTE: packages/guano/mcp/tools.mjs carries the same guard for
// `upload_media {url}`. It is deliberately NOT shared: the MCP package is
// packed with `server/` beside it (`../server/…`) while in the repo it sits
// three levels up, and a static import cannot do that dual-path fallback. If
// you change the ranges here, change them there — `mcp-tools-security.spec.ts`
// imports both and fails when the two disagree, so drift is caught rather
// than discovered.

import { BlockList, isIPv4, isIPv6 } from 'node:net'

/**
 * The ranges that must never be reached. BlockList does the arithmetic, which
 * is the point: the hand-rolled version compared IPv6 by STRING PREFIX, and
 * every form a v6 address can take defeated that.
 *
 * `https://[::ffff:127.0.0.1]/` is the clearest one. WHATWG URL normalises it
 * to `[::ffff:7f00:1]` — the same address in hex — so the dotted-quad
 * extraction found nothing and the `fe80`/`fc`/`fd` prefixes did not match,
 * and loopback was ALLOWED. Same for NAT64 (`64:ff9b::7f00:1`), 6to4
 * (`2002::`) and site-local (`fec0::`). The IPv4-mapped range is how an
 * attacker writes any v4 address as a v6 one, so the gap covered every private
 * v4 range as well.
 *
 * Of note: the critical advisory in this project's own dependency tree
 * (proxy-addr, GHSA-jqcg-44mw-7w3h) is this exact bug class.
 */
// TWO lists, deliberately. Node's BlockList maps an IPv4 check onto
// IPv4-mapped IPv6 rules, so putting `::ffff:0:0/96` in the same list as the
// v4 subnets blocks EVERY v4 address — 8.8.8.8 included. The mapped range is
// handled by extracting the embedded address instead.
const v4Blocked = new BlockList()
v4Blocked.addSubnet('0.0.0.0', 8) // "this network"
v4Blocked.addSubnet('10.0.0.0', 8)
v4Blocked.addSubnet('127.0.0.0', 8) // loopback
v4Blocked.addSubnet('100.64.0.0', 10) // CGNAT
v4Blocked.addSubnet('169.254.0.0', 16) // link-local — the cloud metadata endpoint
v4Blocked.addSubnet('172.16.0.0', 12)
v4Blocked.addSubnet('192.168.0.0', 16)
v4Blocked.addSubnet('198.18.0.0', 15) // benchmarking
v4Blocked.addSubnet('224.0.0.0', 4) // multicast
v4Blocked.addSubnet('240.0.0.0', 4) // reserved

const v6Blocked = new BlockList()
v6Blocked.addAddress('::', 'ipv6') // unspecified
v6Blocked.addAddress('::1', 'ipv6') // loopback
v6Blocked.addSubnet('64:ff9b::', 96, 'ipv6') // NAT64
v6Blocked.addSubnet('100::', 64, 'ipv6') // discard-only
v6Blocked.addSubnet('2001:db8::', 32, 'ipv6') // documentation
v6Blocked.addSubnet('2002::', 16, 'ipv6') // 6to4 — carries a v4 address
v6Blocked.addSubnet('fc00::', 7, 'ipv6') // unique-local
v6Blocked.addSubnet('fe80::', 10, 'ipv6') // link-local
v6Blocked.addSubnet('fec0::', 10, 'ipv6') // site-local (deprecated, still routed)
v6Blocked.addSubnet('ff00::', 8, 'ipv6') // multicast

/**
 * The eight 16-bit groups of an IPv6 address, or null if it does not parse.
 * Handles `::` compression and a trailing dotted quad.
 */
function hextets(addr) {
  let text = addr
  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted) {
    const bytes = dotted[1].split('.').map(Number)
    if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null
    const hi = ((bytes[0] << 8) | bytes[1]).toString(16)
    const lo = ((bytes[2] << 8) | bytes[3]).toString(16)
    text = `${text.slice(0, -dotted[1].length)}${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 0 : fill !== 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (groups.length !== 8) return null
  const out = groups.map((g) => (g === '' ? 0 : parseInt(g, 16)))
  return out.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : out
}

/** the IPv4 address inside `::ffff:a.b.c.d` (in any spelling), else null */
function mappedV4(addr) {
  const g = hextets(addr)
  if (!g) return null
  if (g[0] || g[1] || g[2] || g[3] || g[4] || g[5] !== 0xffff) return null
  return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.')
}

/**
 * Is this address one we refuse to connect to?
 *
 * Fail-closed on anything that is not a recognisable address at all, which is
 * the behaviour the previous implementation had and worth keeping: a resolver
 * returning something unexpected must not read as "public".
 */
export function isBlockedAddress(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '')
  if (isIPv4(v)) return v4Blocked.check(v, 'ipv4')
  if (!isIPv6(v)) return true
  if (v6Blocked.check(v, 'ipv6')) return true
  // an IPv4 address written as a v6 one is still that address
  const mapped = mappedV4(v)
  return mapped ? v4Blocked.check(mapped, 'ipv4') : false
}

/**
 * Throws unless this URL is https and every address it resolves to is public.
 * `resolve` is injected so a test can drive it without DNS.
 */
export async function assertPublicUrl(parsed, resolve) {
  if (parsed.protocol !== 'https:') {
    throw new Error(`url must be https:// (got ${parsed.protocol}//)`)
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`url must point at a public host — "${host}" is local`)
  }
  const literal = isIPv4(host) || isIPv6(host)
  const addresses = literal
    ? [host]
    : await resolve(host, { all: true }).then(
        (rows) => rows.map((r) => r.address),
        (e) => {
          throw new Error(`could not resolve "${host}": ${e.message ?? e}`)
        },
      )
  if (!addresses.length) throw new Error(`"${host}" resolved to no addresses`)
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(
        `url must point at a public host — "${host}" resolves to ${address}, a private address`,
      )
    }
  }
}
