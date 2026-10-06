import { readFileSync } from 'node:fs'

/**
 * Ready-made components for the specs: a Button with variant axes, a Card
 * that holds it, an Alert, a Testimonial, an Input, a Select, a Navbar, and
 * the interactive Tabs / Dialog / Sheet with their effects wired — captured
 * once from the bundled library before it was removed, so the specs that
 * exercised nesting, variants, parts, hidden parts and the published runtime
 * kept exactly the structures they assert on.
 *
 * Test data only. Each key is a bundle: the components in dependency order
 * (what it holds first), the interactions they bind, and the tokens their
 * classes name.
 */
const BUNDLES: Record<
  string,
  { components: any[]; interactions: any[]; tokens: { id: string; name: string; value: string }[] }
> = JSON.parse(readFileSync(new URL('./components.json', import.meta.url), 'utf8'))

const COMPONENT_KEYS = Object.keys(BUNDLES)

/** add the bundles for `keys` to a project blob (deep-copied), by NAME: a
 *  component, effect or token the project already has is left alone */
export function withComponents<T extends Record<string, any>>(project: T, keys: string[]): T {
  project.components = project.components ?? []
  project.interactions = project.interactions ?? []
  project.settings = project.settings ?? {}
  project.settings.tokens = project.settings.tokens ?? []
  for (const key of keys) {
    const bundle = BUNDLES[key]
    if (!bundle) throw new Error(`no component bundle "${key}" (have: ${COMPONENT_KEYS.join(', ')})`)
    const copy = JSON.parse(JSON.stringify(bundle)) as typeof bundle
    for (const def of copy.components) {
      if (!project.components.some((c: any) => c.name === def.name)) project.components.push(def)
    }
    for (const it of copy.interactions) {
      if (!project.interactions.some((i: any) => i.id === it.id)) project.interactions.push(it)
    }
    for (const t of copy.tokens) {
      if (!project.settings.tokens.some((x: any) => x.name === t.name)) project.settings.tokens.push(t)
    }
  }
  return project
}
