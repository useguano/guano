import { onBeforeUnmount, onMounted, ref } from 'vue'

/** true while the event target is a text-editing surface (shortcuts must not fire there) */
export function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/**
 * Tracks a key by KeyboardEvent.code (e.g. 'Space', 'KeyZ').
 * Ignored while typing in inputs/textareas.
 */
export function useShortcut(
  code: string,
  handlers?: { onDown?: (e: KeyboardEvent) => void; onUp?: (e: KeyboardEvent) => void },
) {
  const pressed = ref(false)

  function onKeydown(e: KeyboardEvent) {
    if (e.code !== code || e.repeat || isEditable(e.target)) return
    e.preventDefault()
    pressed.value = true
    handlers?.onDown?.(e)
  }

  function onKeyup(e: KeyboardEvent) {
    if (e.code !== code) return
    pressed.value = false
    handlers?.onUp?.(e)
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('keyup', onKeyup)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('keyup', onKeyup)
  })

  return { pressed }
}

export interface KeyBinding {
  /** KeyboardEvent.key, lowercased; may list alternates (e.g. ['=', '+']) */
  key: string | string[]
  /** requires the platform command key (⌘ on mac, Ctrl elsewhere) */
  mod?: boolean
  /** when set, Shift must match exactly; when omitted, Shift is ignored */
  shift?: boolean
  handler: (e: KeyboardEvent) => void
  /** still fire while typing in an input/textarea (default: false) */
  allowInInput?: boolean
}

function matches(e: KeyboardEvent, b: KeyBinding): boolean {
  if (!!b.mod !== (e.metaKey || e.ctrlKey)) return false
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false
  const keys = Array.isArray(b.key) ? b.key : [b.key]
  return keys.includes(e.key.toLowerCase())
}

/**
 * Declarative modifier-aware shortcuts. The first matching binding
 * wins; it preventDefaults and fires. Bindings are skipped while
 * typing in an input unless `allowInInput` is set, so native
 * copy/paste/undo keep working inside text fields.
 */
export function useKeymap(bindings: KeyBinding[]) {
  function onKeydown(e: KeyboardEvent) {
    if (e.repeat) return
    const editing = isEditable(e.target)
    for (const b of bindings) {
      if (editing && !b.allowInInput) continue
      if (!matches(e, b)) continue
      e.preventDefault()
      b.handler(e)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
