import { computed } from 'vue'
import { File, FileText, Layers } from 'lucide-vue-next'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import type { Collection, CollectionEntry } from '@/types/editor'

/**
 * Page/collection navigation for the app header's page dropdown.
 * Stateless orchestration over usePage + useCollections — opening a page
 * always clears the entry context so the canvas leaves "entry mode".
 */
export function useHeaderNav() {
  const { pages, activePage, addPage, setActivePage } = usePage()
  const { addEntry, openEntry, activeEntryId } = useCollections()

  /** ordinary pages — collection templates are listed under their collection */
  const regularPages = computed(() => pages.value.filter((p) => !p.collectionId))

  /** icon for the current selection shown on the dropdown trigger */
  const activeIcon = computed(() => {
    if (activeEntryId.value) return FileText // editing a collection entry
    if (activePage.value.collectionId) return Layers // a collection template
    return File
  })

  const isActivePage = (id: string) => !activeEntryId.value && activePage.value.id === id

  function openPage(id: string) {
    setActivePage(id)
    activeEntryId.value = null
  }

  function createPage() {
    const page = addPage(`Page ${regularPages.value.length + 1}`)
    openPage(page.id) // redirect to the new page
  }

  /** create an entry and load it — returns it so callers can open it in a panel.
   *  openEntry no-ops for a data-only collection (no template page to show). */
  function newEntry(collection: Collection): CollectionEntry {
    const entry = addEntry(collection)
    openEntry(collection, entry.id)
    return entry
  }

  return { regularPages, activeIcon, isActivePage, openPage, createPage, newEntry }
}
