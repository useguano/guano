export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()

  let score = 0
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    score += 1
    if (qi > 0 && found === ti) score += 5
    const before = found > 0 ? t[found - 1]! : ' '
    if (before === ' ' || before === '-' || before === '/') score += 3
    score -= Math.min(found - ti, 3)
    ti = found + 1
  }
  score -= t.length * 0.01
  return score
}
