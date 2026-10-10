// Reading the published page's effects wire format, for the specs that are the
// referee for it. Format: src/lib/shared/fxWire.js.
//
// Every spec here used to parse the format itself — a regex per attribute, a
// `&quot;` unescape, a JSON.parse — which is six copies of the same reader and
// six places to change when the format does. More to the point: those readers
// asserted on the uuid VALUES, and the published keys are now route-local
// ordinals with no meaning outside the file. What the specs actually care about
// is the RELATIONSHIP — this trigger's key is one some element listens on — and
// that is what these helpers expose.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ClassTrigger {
  t: string
  k: string
  s: string
  a?: string
  c?: string[]
  g?: string
  o?: string
  at?: number
}

export interface MotionTrigger {
  k: string
  t: string
  a: string
  s?: string
  ac?: string
  d?: number
  o?: { m?: string; at?: number; s?: Record<string, number>; mo?: Record<string, unknown> }
}

export interface FxEntry {
  /** class effects this element fires */
  c?: ClassTrigger[]
  /** timelines this element triggers */
  m?: MotionTrigger[]
  /** state keys driving this element's class list */
  t?: string[]
  /** binding keys whose timeline lands on this element */
  a?: string[]
}

export interface FxManifest {
  els?: FxEntry[]
  fx?: Record<string, string>
  rm?: Record<string, string>
  fxbp?: Record<string, string[]>
  modal?: string[]
  lib?: Record<string, { steps: unknown[] }>
  animbp?: Record<string, string[]>
  bp?: { id: string; w: number }[]
  site?: { t?: { x?: string; e?: string }; s?: { l: number } }
}

/**
 * The route's manifest, or an empty one when it carries no effects.
 *
 * It ships as a SIDECAR (`assets/fx-<hash>.js`), so reading it needs the
 * directory the route was exported into. A spec that only has the html — the
 * in-process MCP harness — gets the sidecar inlined for it by `mcpSession`, and
 * that inline form is what the second branch reads.
 */
export function manifest(html: string, dir?: string): FxManifest {
  const inline = /<script type="application\/json" id="guano-fx">(.*?)<\/script>/s.exec(html)
  if (inline) return JSON.parse(inline[1]!.replaceAll('<\\/', '</')) as FxManifest
  const ref = /<script src="\/(assets\/fx-[0-9a-f]{8}\.js)" defer><\/script>/.exec(html)
  if (!ref) return {}
  if (!dir) {
    throw new Error(
      `the manifest ships as ${ref[1]} — pass the export directory as the second argument`,
    )
  }
  const body = readFileSync(join(dir, ref[1]!), 'utf8')
  return JSON.parse(body.slice(body.indexOf('=') + 1)) as FxManifest
}

/** every element carrying a `data-fx` handle, in document order, paired with
 *  its opening tag so a spec can find one by id/class */
export function wired(html: string, dir?: string): { tag: string; fx: FxEntry }[] {
  const els = manifest(html, dir).els ?? []
  const out: { tag: string; fx: FxEntry }[] = []
  for (const m of html.matchAll(/<[a-zA-Z][^>]*\sdata-fx="(\d+)"[^>]*>/g)) {
    const entry = els[Number(m[1])]
    if (entry) out.push({ tag: m[0], fx: entry })
  }
  return out
}

/** the entry of the element carrying this html id */
export function wiredById(html: string, htmlId: string, dir?: string): FxEntry | null {
  const found = wired(html, dir).find(({ tag }) => new RegExp(`\\sid="${htmlId}"`).test(tag))
  return found?.fx ?? null
}

/** every class trigger on the route, in document order */
export function classTriggers(html: string, dir?: string): ClassTrigger[] {
  return wired(html, dir).flatMap(({ fx }) => fx.c ?? [])
}

/** every motion trigger on the route, in document order */
export function motionTriggers(html: string, dir?: string): MotionTrigger[] {
  return wired(html, dir).flatMap(({ fx }) => fx.m ?? [])
}

/** the state keys every class trigger declares, in document order */
export function triggerStateKeys(html: string, dir?: string): string[] {
  return classTriggers(html, dir).map((meta) => meta.s)
}

/** every state key any element on the route listens on */
export function listenKeys(html: string, dir?: string): string[] {
  return wired(html, dir).flatMap(({ fx }) => fx.t ?? [])
}

/** every binding key any element on the route is a tween target of */
export function animTargetKeys(html: string, dir?: string): string[] {
  return wired(html, dir).flatMap(({ fx }) => fx.a ?? [])
}
