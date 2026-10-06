import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useModal } from './useModal'
import { useInsertDrag } from './useInsertDrag'

/**
 * Escape handling for a docked drawer column (Pages, Components).
 *
 * A drawer column is persistent — it stays open until its rail button closes
 * it — so it may NOT claim Escape unconditionally: it would swallow the key
 * from the canvas and the right panel for as long as it is
 * open. Two conditions gate it:
 *
 * · **engaged** — the last pointerdown or focus landed inside the panel. Focus
 *   alone isn't enough, because clicking a row that swaps the pane drops focus
 *   to `<body>`.
 * · **something to peel** — `canPeel()`. Escape peels one layer (a filter, then
 *   a detail pane) and never closes the column itself; only the rail does.
 *
 * The listener is capture-phase so a layer peels before `SettingsEditor`'s
 * window handler (bubble phase) closes the panel and moves focus.
 */
export function useDrawerEscape(
  // readonly so a drawer can hand in a computed over its DrawerShell's `el`
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
    // an open row kebab owns Escape first — let it bubble to MenuUI's own handler
    if (panel.value?.querySelector('[data-open]')) return
    // a modal opened from inside the drawer (the media library) owns Escape:
    // ModalStackHost listens in BUBBLE phase, so without this the capture
    // handler here would peel the detail view and leave the modal up
    if (stack.value.length) return
    // a drag started from a drawer row owns Escape while it is in flight —
    // both handlers sit on window in capture phase, so stopPropagation here
    // would NOT reach it and the drag would be left hanging
    if (payload.value) return
    // nothing to peel: the key belongs to whoever else wants it
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
