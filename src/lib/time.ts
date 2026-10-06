/** compact relative time, e.g. "just now", "5 minutes ago", "3 days ago" */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'

  const units: [limit: number, secs: number, name: string][] = [
    [60, 1, 'second'],
    [60, 60, 'minute'],
    [24, 3600, 'hour'],
    [7, 86400, 'day'],
    [4.35, 604800, 'week'],
    [12, 2629800, 'month'],
    [Infinity, 31557600, 'year'],
  ]

  for (const [limit, secs, name] of units) {
    const value = Math.floor(seconds / secs)
    if (value < limit) {
      return `${value} ${name}${value === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

/** ultra-compact relative time for dense UI, e.g. "5m ago", "3h ago",
 * "yesterday", "5 days ago" */
export function timeAgoShort(timestamp: number, now: number = Date.now()): string {
  const mins = Math.floor((now - timestamp) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
