import { test } from '@playwright/test'
// @ts-expect-error untyped package module
import { createToolSet } from '../../packages/guano/mcp/tools.mjs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../../server/export.mjs'
import { withComponents } from './components'

// The in-process MCP harness shared by the mcp-* specs: the toolset and its
// bundled runtime are plain ESM driven against an in-memory store. No server,
// no browser, no login — so these specs cannot disturb smoke.spec's first-run
// flow, and they sort anywhere.

const runtimePromise = import(
  /* @vite-ignore */ '../../packages/guano/runtime/mcp-runtime.mjs' as string
).catch(() => null)

/** a page body: `body` is the markup that goes inside `<body>`. Written out
 *  rather than passed bare so the body element's own state is exercised too. */
export const pageHtml = (body: string) => `<body>\n${body}\n</body>`

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export interface McpSession {
  call: (name: string, args?: Record<string, unknown>) => Promise<any>
  tool: (name: string) => { description: string; inputSchema: Record<string, unknown> }
  stored: () => any
  /** write a stored blob BEHIND the toolset — what a human's editor save, or a
   *  second agent, looks like to a tool call that is already in flight */
  writeStore: (key: string, raw: string) => void
  /** run `fn` after every project read, so a test can land another writer's
   *  save inside a handler's load→save window (null clears it) */
  onProjectRead: (fn: (() => void) | null) => void
  /** put ready-made components (e2e/fixtures/components.json) into Main */
  seed: (keys: string[]) => Promise<void>
  /** the exported <body>… of the first route */
  html: () => Promise<string>
  /** the exported stylesheet — for a rule the renderer emits itself */
  css: () => Promise<string>
  /** export an ARBITRARY project into a directory the caller keeps, for the
   * checks that are about the FILES an export writes (the responsive image
   * variants) rather than the markup. The caller deletes the directory. */
  exportDir: (project: unknown, dir?: string) => Promise<string>
  /** export an ARBITRARY project with a given integrations list, and return
   * the first route's HTML. The forms/ENV checks need both: a project whose
   * custom code the tools do not write, and the integrations the substitution
   * resolves against (which live outside the project by design). */
  exportWith: (project: unknown, integrations: unknown[]) => Promise<string>
  /** every exported HTML file, keyed by its route path — for checks that span
   * the routes a collection generates */
  exportAll: () => Promise<Record<string, string>>
  home: () => Promise<{ id: string; version: string }>
  /** the `kind` of every publish warning, which is what these specs assert on */
  kinds: () => Promise<string[]>
  runtime: any
}

export async function mcpSession(
  projectName = 'T',
  /** what the server would report back from the export — `route-size` reads it */
  publishStats: { routes: number; bytes: number } = { routes: 1, bytes: 1 },
): Promise<McpSession> {
  const runtime = await runtimePromise
  test.skip(!runtime, 'runtime/mcp-runtime.mjs missing — run `npm run build:mcp-runtime`')
  const store = new Map([['guano-project:main', JSON.stringify(runtime.createProject(projectName))]])
  // The real api is HTTP, so every read and write yields to the event loop
  // before it lands. Model that: a store whose methods resolve synchronously
  // cannot interleave two tool calls at all, which is precisely the bug class
  // mcp-concurrent-writes.spec.ts is about.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  let onRead: (() => void) | null = null
  const api = {
    base: 'http://localhost:4174',
    whoami: async () => ({ id: 'u1', email: 'a@b.c', role: 'admin', name: 'A' }),
    storeGetRaw: async (k: string) => {
      await tick()
      const value = store.get(k) ?? null
      // the hook fires AFTER the value is read and BEFORE the caller can save,
      // which is the only window where another writer's work can be lost
      if (onRead && k.startsWith('guano-project:')) onRead()
      return value
    },
    storeGetJson: async (k: string) => {
      await tick()
      return store.has(k) ? JSON.parse(store.get(k)!) : null
    },
    // `ifMatch` is the server's compare-and-swap, mirrored here so the refusal
    // is exercised in-process: the real server checks it under a per-key lock
    // and answers 412.
    storePutRaw: async (k: string, v: string, { ifMatch }: { ifMatch?: string } = {}) => {
      await tick()
      if (ifMatch) {
        const current = store.has(k) ? sha256(store.get(k)!) : null
        if (current !== ifMatch) {
          throw Object.assign(new Error('precondition failed'), { status: 412 })
        }
      }
      store.set(k, v)
    },
    publish: async () => publishStats,
    mediaIndex: async () => ({ assets: [], folders: [] }),
    mediaUpload: async () => ({ id: 'm1' }),
  }
  const set = createToolSet({ api, runtime })
  set.setTarget('main')
  const stored = () => JSON.parse(store.get('guano-project:main')!)
  return {
    runtime,
    call: (name: string, args: Record<string, unknown> = {}) => set.toolMap.get(name)!.handler(args),
    tool: (name: string) => set.toolMap.get(name)!,
    stored,
    writeStore: (key: string, raw: string) => void store.set(key, raw),
    onProjectRead: (fn: (() => void) | null) => {
      onRead = fn
    },
    seed: async (keys: string[]) => {
      store.set('guano-project:main', JSON.stringify(withComponents(stored(), keys)))
    },
    html: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'guano-mcp-'))
      try {
        await exportSite(stored(), dir)
        const out = readFileSync(join(dir, 'index.html'), 'utf8')
        return out.slice(out.indexOf('<body'))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    css: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'guano-mcp-'))
      try {
        await exportSite(stored(), dir)
        return readFileSync(join(dir, 'assets/style.css'), 'utf8')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    exportDir: async (project: unknown, dir?: string) => {
      const out = dir ?? mkdtempSync(join(tmpdir(), 'guano-mcp-'))
      await exportSite(project, out)
      return out
    },
    exportWith: async (project: unknown, integrations: unknown[]) => {
      const dir = mkdtempSync(join(tmpdir(), 'guano-mcp-'))
      try {
        await exportSite(project, dir, { integrations })
        return readFileSync(join(dir, 'index.html'), 'utf8')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    exportAll: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'guano-mcp-'))
      try {
        await exportSite(stored(), dir)
        const out: Record<string, string> = {}
        const walk = (rel: string) => {
          for (const name of readdirSync(join(dir, rel))) {
            const next = rel ? `${rel}/${name}` : name
            if (statSync(join(dir, next)).isDirectory()) walk(next)
            else if (next.endsWith('.html')) out[next] = readFileSync(join(dir, next), 'utf8')
          }
        }
        walk('')
        return out
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    home: async () => (await set.toolMap.get('list_pages')!.handler({})).pages[0],
    kinds: async () =>
      ((await set.toolMap.get('publish')!.handler({})).warnings ?? []).map(
        (w: { kind: string }) => w.kind,
      ),
  }
}
