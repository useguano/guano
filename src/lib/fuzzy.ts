/**
 * Tiny subsequence fuzzy matcher (no dependency). Returns a score where
 * higher = better, or null when `query` is not a subsequence of `text`.
 * An empty query matches everything with score 0. Bonuses reward
 * consecutive matches and word-start hits, so 'sec' ranks 'section'
 * above a mid-word substring hit.
 */
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
    // base point for the match
    score += 1
    // consecutive-run bonus (this char immediately follows the last match)
    if (qi > 0 && found === ti) score += 5
    // word-start bonus (start of string or after a separator)
    const before = found > 0 ? t[found - 1]! : ' '
    if (before === ' ' || before === '-' || before === '/') score += 3
    // small penalty for how far we had to skip
    score -= Math.min(found - ti, 3)
    ti = found + 1
  }
  // prefer shorter targets on ties (a full-name match beats a long label)
  score -= t.length * 0.01
  return score
}
