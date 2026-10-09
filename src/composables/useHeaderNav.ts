import { computed } from 'vue'
import { File, FileText, Layers } from 'lucide-vue-next'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import type { Collection, CollectionEntry } from '@/types/editor'

export function useHeaderNav() {
  const { pages, activePage, addPage, setActivePage } = usePage()
  const { addEntry, openEntry, activeEntryId } = useCollections()

  const regularPages = computed(() => pages.value.filter((p) => !p.collectionId))

  const activeIcon = computed(() => {
    if (activeEntryId.value) return FileText
    if (activePage.value.collectionId) return Layers
    return File
  })

  const isActivePage = (id: string) => !activeEntryId.value && activePage.value.id === id

  function openPage(id: string) {
    setActivePage(id)
    activeEntryId.value = null
  }

  function createPage() {
    const page = addPage(`Page ${regularPages.value.length + 1}`)
    openPage(page.id)
  }

  function newEntry(collection: Collection): CollectionEntry {
    const entry = addEntry(collection)
    openEntry(collection, entry.id)
    return entry
  }

  return { regularPages, activeIcon, isActivePage, openPage, createPage, newEntry }
}
