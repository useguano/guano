import { watch } from 'vue'
import { useProject } from './useProject'
import { useAuth } from './useAuth'
import type { Project } from '@/types/editor'

let started = false

function pageSig(p: Project['pages'][number]): string {
  return JSON.stringify({ n: p.name, p: p.path, t: p.status, s: p.seo, x: p.customCode, e: p.elements })
}
function entrySig(e: Project['collections'][number]['entries'][number]): string {
  return JSON.stringify({ n: e.name, g: e.slug, v: e.values, l: e.locales, t: e.status, o: e.seo })
}

export function startEditTracking() {
  if (started) return
  started = true

  const { project, projectVersion } = useProject()
  const { name: authName, email: authEmail } = useAuth()
  const actor = () => authName.value || authEmail.value || 'Someone'

  const pageSigs = new Map<string, string>()
  const entrySigs = new Map<string, string>()
  let lastRoot: Project | null = null
  let seeded = false

  function scan() {
    const rootReplaced = project.value !== lastRoot
    lastRoot = project.value
    const stamping = seeded && !rootReplaced
    const now = Date.now()
    const who = actor()

    const livePages = new Set<string>()
    for (const page of project.value.pages) {
      livePages.add(page.id)
      const sig = pageSig(page)
      const prev = pageSigs.get(page.id)
      pageSigs.set(page.id, sig)
      if (stamping && prev !== undefined && prev !== sig) {
        page.updatedAt = now
        page.updatedBy = who
      }
    }

    const liveEntries = new Set<string>()
    for (const collection of project.value.collections) {
      for (const entry of collection.entries) {
        liveEntries.add(entry.id)
        const sig = entrySig(entry)
        const prev = entrySigs.get(entry.id)
        entrySigs.set(entry.id, sig)
        if (stamping && prev !== undefined && prev !== sig) {
          entry.updatedAt = now
          entry.updatedBy = who
        }
      }
    }

    for (const id of [...pageSigs.keys()]) if (!livePages.has(id)) pageSigs.delete(id)
    for (const id of [...entrySigs.keys()]) if (!liveEntries.has(id)) entrySigs.delete(id)

    seeded = true
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  watch(projectVersion, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(scan, 600)
  })

  scan()
}
