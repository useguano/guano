import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useModal } from './useModal'
import { useInsertDrag } from './useInsertDrag'

export function useDrawerEscape(
  panel: Readonly<Ref<HTMLElement | undefined>>,
  opts: { canPeel: () => boolean; peel: () => void },
) {
  const { stack } = useModal()
  const { payload } = useInsertDrag()

  let engaged = false
  function onEngage(e: Event) {
    engaged = !!panel.value?.contains(e.target as Node)
  }

  function onKeydownCapture(e: KeyboardEvent) {
    if (!engaged || e.key !== 'Escape') return
    if (panel.value?.querySelector('[data-open]')) return
    if (stack.value.length) return
    if (payload.value) return
    if (!opts.canPeel()) return
    e.stopPropagation()
    opts.peel()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydownCapture, true)
    window.addEventListener('pointerdown', onEngage, true)
    window.addEventListener('focusin', onEngage, true)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydownCapture, true)
    window.removeEventListener('pointerdown', onEngage, true)
    window.removeEventListener('focusin', onEngage, true)
  })
}
