import { computed, ref, watch } from 'vue'
import { useAuth } from './useAuth'
import { useMotion } from './useMotion'

// Which editing surface the single shell shows: the Build canvas (frames +
// full inspector) or the full-site Preview. Runtime-only, shared across the
// app — deliberately NOT on the project (not persisted, not undoable).
//
// In the UI these two are **Edit** and **Play**, switched by `ModeToggle` at
// the bottom-right of the page canvas (there is no Preview rail button). The
// internal names stay build/preview — the vocabulary is spelled out in
// ModeToggle, and nothing else has to know both.
//
// Contributors are content-only: they can never enter Build, so the mode is
// pinned to 'preview' for them, and they get no toggle at all (the Build-only
// rail buttons are hidden too). Preview itself is read-only, so what they edit
// they edit in the Pages drawer — an entry's field values, a page's SEO and
// status — not on the render.
const mode = ref<'build' | 'preview'>('build')

/**
 * What the Build canvas shows: the open page, or the components board.
 *
 * Deliberately separate from `column` below, so the board can stay up while a
 * different column — or none — holds the track (pressing Components again
 * closes its column and leaves the board at full width).
 */
const canvas = ref<'page' | 'components'>('page')

/**
 * The docked column beside the rail — pages or components. They share ONE
 * 16rem track, so at most one is open: a single ref rather than a flag each,
 * so the invariant is the type and not a set of handlers. `null` is the bare
 * canvas.
 *
 * Pages belongs to the shell (both surfaces, contributors included) and is
 * also where a page's layers are edited; components is a Build-only tool.
 */
const column = ref<'pages' | 'components' | null>(null)
let pinStarted = false

export function useViewMode() {
  const { canBuild } = useAuth()

  if (!pinStarted) {
    pinStarted = true
    // role resolves at boot (possibly after first call) — force preview the
    // moment we learn the user can't build
    watch(canBuild, (can) => {
      if (!can) {
        mode.value = 'preview'
        canvas.value = 'page'
        // only the build-only column closes: a contributor still gets Pages
        if (column.value === 'components') column.value = null
      }
    }, { immediate: true })
  }

  function setMode(next: 'build' | 'preview') {
    if (next === 'build' && !canBuild.value) return
    // animations only auto-play in Preview — crossing the surface boundary
    // drops every play (entering Build stops them; entering Preview restarts
    // its triggers from a clean slate on mount)
    if (next !== mode.value) useMotion().stopAll()
    mode.value = next
  }

  /** the canvas only ever switches on Build, and only for build roles */
  function setCanvas(next: 'page' | 'components') {
    if (!canBuild.value) return
    canvas.value = next
  }

  /**
   * The rail's Components button: the board, plus its column. Pressed again
   * with the column already open it closes the column and LEAVES the board —
   * that is the point of the split, and how you get a full-width board.
   */
  function toggleComponents() {
    if (!canBuild.value) return
    if (mode.value !== 'build') setMode('build')
    setCanvas('components')
    column.value = column.value === 'components' ? null : 'components'
  }

  /** The rail's Pages button: flips the pages column, on either surface. */
  function togglePages() {
    column.value = column.value === 'pages' ? null : 'pages'
  }

  /** The rail's App/logo button: the default surface — the bare page canvas,
   *  no column open. */
  function showApp() {
    column.value = null
    canvas.value = 'page'
    setMode('build')
  }

  const isPreview = computed(() => mode.value === 'preview')
  const isBuild = computed(() => mode.value === 'build')
  const pagesOpen = computed(() => column.value === 'pages')
  const componentsOpen = computed(() => column.value === 'components')
  /** the board is a CANVAS state now, not a column one */
  const showComponents = computed(() => isBuild.value && canvas.value === 'components')
  /**
   * What the shell actually renders in the shared track. Crossing into Preview
   * hides the build-only columns without forgetting them, so returning to
   * Build brings the column back.
   */
  const visibleColumn = computed(() =>
    column.value === 'pages' || isBuild.value ? column.value : null,
  )

  return {
    mode, isPreview, isBuild, canvas,
    column, visibleColumn, pagesOpen, componentsOpen, showComponents,
    setMode, setCanvas, togglePages, toggleComponents, showApp,
  }
}
