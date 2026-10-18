import { computed, effectScope, ref, watch } from 'vue'
import { createProject } from '@/lib/factories'
import { breakpointVariant, breakpointIdForWidth } from '@/lib/responsive'
import { walkNodes } from '@/lib/tree'
import type { Breakpoint, ElementNode } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

const project = ref(createProject('Untitled project'))

const projectVersion = ref(0)
effectScope(true).run(() => {
  watch(project, () => projectVersion.value++, { deep: true })
})

const activeBreakpointId = ref<string | null>(null)

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => (viewportWidth.value = window.innerWidth))
}

export const MIN_BREAKPOINTS = 1
export const MAX_BREAKPOINTS = 6

const STANDARD_WIDTHS = [2560, 1920, 1680, 1440, 1280, 1024, 768, 640, 480, 390, 320]

function nameFor(width: number): string {
  if (width >= 1920) return 'Large desktop'
  if (width >= 1024) return 'Desktop'
  if (width >= 640) return 'Tablet'
  return 'Mobile'
}

export function useProject() {
  const breakpoints = computed(() => project.value.breakpoints)

  /**
   * Nothing has been built yet: the seeded Home page and no content anywhere.
   *
   * What the AI panel opens on — two cards, *Just chat* or *Build a brief*,
   * instead of the placeholder sentence (`docs/agent-panel.md`, The brief).
   *
   * **Derived, never cached.** It has to go false the moment the agent writes
   * one element, or a reload mid-build would offer the cards over a live
   * transcript. The seed is `createProject` in `src/lib/factories.ts`: one
   * page at `/` whose body has no children.
   */
  const isEmptyProject = computed(() => {
    const p = project.value
    if (p.pages.length !== 1) return false
    if (p.components.length || p.collections.length) return false
    const body = p.pages[0]?.elements[0]
    return !!body && !(body.children?.length ?? 0)
  })

  const hasEnabledForm = computed(() => {
    let found = false
    const look = (nodes: ElementNode[]) =>
      walkNodes(nodes, (n) => {
        if (n.form?.enabled) found = true
      })
    for (const page of project.value.pages) look(page.elements)
    for (const def of project.value.components) look([def.root])
    return found
  })

  const baseBreakpoint = computed<Breakpoint | undefined>(() =>
    breakpoints.value.reduce<Breakpoint | undefined>((w, b) => (!w || b.width > w.width ? b : w), undefined),
  )
  const activeBreakpoint = computed<Breakpoint | undefined>(
    () => breakpoints.value.find((b) => b.id === activeBreakpointId.value) ?? baseBreakpoint.value,
  )
  const activeVariant = computed(() =>
    !activeBreakpoint.value || activeBreakpoint.value.id === baseBreakpoint.value?.id
      ? ''
      : breakpointVariant(activeBreakpoint.value.width),
  )
  function setActiveBreakpoint(id: string | null) {
    activeBreakpointId.value = id
  }

  const liveBreakpointId = computed(() =>
    breakpointIdForWidth(breakpoints.value, viewportWidth.value),
  )

  function renameProject(name: string) {
    project.value.name = name
  }

  function widthAt(index: number): number | undefined {
    const list = project.value.breakpoints
    const upper = list[index - 1]?.width ?? Infinity
    const lower = list[index]?.width ?? 0
    return STANDARD_WIDTHS.find((w) => w < upper && w > lower)
  }

  function canAddBreakpoint(index: number): boolean {
    return project.value.breakpoints.length < MAX_BREAKPOINTS && widthAt(index) !== undefined
  }

  function addBreakpoint(index: number): Breakpoint | null {
    const list = project.value.breakpoints
    if (list.length >= MAX_BREAKPOINTS) return null
    const width = widthAt(index)
    const parent = list[index - 1] ?? list[index]
    if (!width || !parent) return null

    const breakpoint: Breakpoint = {
      id: uid(),
      name: nameFor(width),
      width,
      height: parent.height,
    }
    list.splice(index, 0, breakpoint)
    return breakpoint
  }

  function removeBreakpoint(id: string) {
    if (project.value.breakpoints.length <= MIN_BREAKPOINTS) return
    project.value.breakpoints = project.value.breakpoints.filter((b) => b.id !== id)
    project.value.comments = project.value.comments.filter((c) => c.breakpointId !== id)
  }

  return {
    project,
    projectVersion,
    isEmptyProject,
    hasEnabledForm,
    breakpoints,
    baseBreakpoint,
    activeBreakpoint,
    activeBreakpointId,
    activeVariant,
    liveBreakpointId,
    setActiveBreakpoint,
    renameProject,
    canAddBreakpoint,
    addBreakpoint,
    removeBreakpoint,
  }
}
