const SIZED = /^(h|min-h|size|aspect|p|py|pt|pb)-/
const SELF_PLACED = new Set(['absolute', 'fixed', 'hidden', 'contents'])

export function declaresOwnBox(classes: string): boolean {
  for (const token of classes.split(/\s+/)) {
    if (!token) continue
    const utility = (token.split(':').pop() ?? '').replace(/^!/, '')
    if (SELF_PLACED.has(utility) || SIZED.test(utility)) return true
  }
  return false
}
