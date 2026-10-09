import { onBeforeUnmount, onMounted, ref } from 'vue'

export function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

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
  key: string | string[]
  mod?: boolean
  shift?: boolean
  handler: (e: KeyboardEvent) => void
  allowInInput?: boolean
}

function matches(e: KeyboardEvent, b: KeyBinding): boolean {
  if (!!b.mod !== (e.metaKey || e.ctrlKey)) return false
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false
  const keys = Array.isArray(b.key) ? b.key : [b.key]
  return keys.includes(e.key.toLowerCase())
}

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
