import { nextTick, ref, type Ref } from 'vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

/**
 * Inline plaintext editing on a rendered element: double-click to edit, Enter
 * to commit. Shared by the Build canvas (`ElementRenderer`, Esc discards) and,
 * for contributors, the Play render (`PreviewRenderer`, Esc saves — a
 * contributor has no other surface to redo the typing on). While editing, a
 * dedicated span is mounted that Vue renders EMPTY — its text is managed only
 * by us — so Vue's fragment anchors for the interpolation and child renderers
 * survive.
 */
export function useInlineEdit(opts: {
  /** whether this element can be text-edited right now */
  editable: Ref<boolean>
  /** the text the editor opens with */
  initialText: () => string
  /** persist the edited text */
  commit: (text: string) => void
  /** rich mode: the span edits sanitized HTML instead of plain text —
   * the host must render contenteditable="true" (not plaintext-only) */
  rich?: Ref<boolean>
  /** called after a keyboard exit (Enter/Esc), e.g. to return focus to the editor */
  onExit?: () => void
  /** what Esc does — 'cancel' discards, 'save' commits (default 'cancel') */
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
      // Typing a space inside a <button> or a <summary> "clicks" it on keyup —
      // the browser's keyboard activation — and that click ends the edit
      // mid-word. The listener dies with the span, which is unmounted on exit.
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
    editing.value = false // unmounts the span (and our manual text with it)
    if (cancel || text === editStart) return
    opts.commit(text)
  }

  function onEditKeydown(e: KeyboardEvent) {
    // keep editor-wide shortcuts (undo, panels, Esc handlers) out of the session
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finishEditing(false)
      opts.onExit?.()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Esc discards, like Escape everywhere else in the editor — unless the
      // caller asked for it to save
      finishEditing(opts.escBehavior !== 'save')
      opts.onExit?.()
    }
  }

  return { editing, editEl, startEditing, finishEditing, onEditKeydown }
}
