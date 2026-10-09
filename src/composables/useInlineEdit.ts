import { nextTick, ref, type Ref } from 'vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

export function useInlineEdit(opts: {
  editable: Ref<boolean>
  initialText: () => string
  commit: (text: string) => void

  rich?: Ref<boolean>
  onExit?: () => void
  escBehavior?: 'cancel' | 'save'
}) {
  const editing = ref(false)
  const editEl = ref<HTMLElement>()
  let editStart = ''

  function startEditing(e?: Event) {
    if (!opts.editable.value || editing.value) return
    e?.stopPropagation()
    e?.preventDefault()
    editing.value = true
    const initial = opts.initialText()
    nextTick(() => {
      const target = editEl.value
      if (!target) return
      if (opts.rich?.value) target.innerHTML = sanitizeRich(initial)
      else target.textContent = initial
      editStart = initial
      target.addEventListener('keyup', (event) => {
        if (event.key === ' ') event.preventDefault()
      })
      target.focus()
      const range = document.createRange()
      range.selectNodeContents(target)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  function finishEditing(cancel: boolean) {
    if (!editing.value) return
    const text = opts.rich?.value
      ? sanitizeRich(editEl.value?.innerHTML ?? '')
      : (editEl.value?.textContent ?? '')
    editing.value = false
    if (cancel || text === editStart) return
    opts.commit(text)
  }

  function onEditKeydown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finishEditing(false)
      opts.onExit?.()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finishEditing(opts.escBehavior !== 'save')
      opts.onExit?.()
    }
  }

  return { editing, editEl, startEditing, finishEditing, onEditKeydown }
}
