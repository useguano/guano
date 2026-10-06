import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { useAuth } from './useAuth'
import { useMotion } from './useMotion'
import { useViewMode } from './useViewMode'
import { createPage } from '@/lib/factories'
import { slugify } from '@/lib/shared/slug.js'
import { deepClone, walkNodes } from '@/lib/tree'
import type { Page } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

const activePageId = ref<string | null>(null)

export function usePage() {
  const { project } = useProject()
  const { name: authName, email: authEmail } = useAuth()
  const actor = () => authName.value || authEmail.value || 'Someone'

  const pages = computed(() => project.value.pages)

  // A project always has at least one page, so there is always an active one
  const activePage = computed(
    () => pages.value.find((p) => p.id === activePageId.value) ?? pages.value[0]!,
  )

  const homePage = computed(() => pages.value.find((p) => p.path === '/') ?? pages.value[0]!)

  function addPage(name: string, path = `/${slugify(name)}`): Page {
    const page = createPage(name, path, project.value.defaultLocale)
    page.createdBy = page.updatedBy = actor()
    project.value.pages.push(page)
    return page
  }

  /** deep-clones a page — everything an element carries lives on the node, so
   * a JSON clone with fresh ids keeps all of it */
  function duplicatePage(id: string): Page | null {
    const page = pages.value.find((p) => p.id === id)
    if (!page) return null
    const clone = deepClone(page) as Page
    clone.id = uid()
    walkNodes(clone.elements, (n) => (n.id = uid()))
    delete clone.collectionId // a duplicated collection template is handled separately
    clone.name = `${page.name} copy`
    let path = `${page.path}-copy`
    let n = 2
    while (pages.value.some((p) => p.path === path)) path = `${page.path}-copy-${n++}`
    clone.path = path
    clone.createdAt = clone.updatedAt = Date.now()
    clone.createdBy = clone.updatedBy = actor()
    project.value.pages.push(clone)
    return clone
  }

  function removePage(id: string) {
    // The home page can never be deleted, so a project always keeps at least one page
    if (id === homePage.value.id) return
    project.value.pages = project.value.pages.filter((p) => p.id !== id)
    if (activePageId.value === id) activePageId.value = homePage.value.id
  }

  function renamePage(id: string, name: string) {
    const page = pages.value.find((p) => p.id === id)
    if (page) page.name = name
  }

  /** edit a page's identity fields. They live on the Page, and nowhere else:
   * the DSL `@setup` block that used to own them is a derived mirror now.
   * Stamps updatedAt/updatedBy. */
  function updatePageMeta(id: string, patch: { name?: string; slug?: string; status?: string }) {
    const page = pages.value.find((p) => p.id === id)
    if (!page) return
    if (patch.name !== undefined) page.name = patch.name
    if (patch.slug !== undefined) page.path = patch.slug
    if (patch.status !== undefined) page.status = patch.status
    page.updatedAt = Date.now()
    page.updatedBy = actor()
  }

  function setActivePage(id: string) {
    // drop the outgoing page's plays (the marquee that kept ticking, the held
    // end states) — the new page's own triggers re-fire on mount
    if (id !== activePageId.value) useMotion().stopAll()
    activePageId.value = id
    // opening a page means looking at it: if the components board held the
    // canvas, hand it back. Here rather than in a watcher because re-opening
    // the page you are already on must work too.
    useViewMode().setCanvas('page')
  }

  return {
    pages,
    activePage,
    homePage,
    addPage,
    duplicatePage,
    removePage,
    renamePage,
    updatePageMeta,
    setActivePage,
  }
}
