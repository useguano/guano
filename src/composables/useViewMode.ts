import { computed, ref, watch } from 'vue'
import { useAuth } from './useAuth'
import { useMotion } from './useMotion'

const mode = ref<'build' | 'preview'>('build')

const canvas = ref<'page' | 'components'>('page')

const column = ref<'pages' | 'components' | null>(null)
let pinStarted = false

export function useViewMode() {
  const { canBuild } = useAuth()

  if (!pinStarted) {
    pinStarted = true
    watch(canBuild, (can) => {
      if (!can) {
        mode.value = 'preview'
        canvas.value = 'page'
        if (column.value === 'components') column.value = null
      }
    }, { immediate: true })
  }

  function setMode(next: 'build' | 'preview') {
    if (next === 'build' && !canBuild.value) return
    if (next !== mode.value) useMotion().stopAll()
    mode.value = next
  }

  function setCanvas(next: 'page' | 'components') {
    if (!canBuild.value) return
    canvas.value = next
  }

  function toggleComponents() {
    if (!canBuild.value) return
    if (mode.value !== 'build') setMode('build')
    setCanvas('components')
    column.value = column.value === 'components' ? null : 'components'
  }

  function togglePages() {
    column.value = column.value === 'pages' ? null : 'pages'
  }

  function showApp() {
    column.value = null
    canvas.value = 'page'
    setMode('build')
  }

  const isPreview = computed(() => mode.value === 'preview')
  const isBuild = computed(() => mode.value === 'build')
  const pagesOpen = computed(() => column.value === 'pages')
  const componentsOpen = computed(() => column.value === 'components')
  const showComponents = computed(() => isBuild.value && canvas.value === 'components')

  const visibleColumn = computed(() =>
    column.value === 'pages' || isBuild.value ? column.value : null,
  )

  return {
    mode, isPreview, isBuild, canvas,
    column, visibleColumn, pagesOpen, componentsOpen, showComponents,
    setMode, setCanvas, togglePages, toggleComponents, showApp,
  }
}
