export type Span = { kind: 'text' | 'bold' | 'code'; text: string }

export type Block =
  | { kind: 'p'; spans: Span[] }
  | { kind: 'h'; spans: Span[] }
  | { kind: 'ul'; items: Span[][] }
  | { kind: 'ol'; items: Span[][] }
  | { kind: 'pre'; text: string }

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g

export function spans(line: string): Span[] {
  const out: Span[] = []
  let last = 0
  for (const match of line.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) out.push({ kind: 'text', text: line.slice(last, index) })
    const token = match[0]
    if (token.startsWith('**')) out.push({ kind: 'bold', text: token.slice(2, -2) })
    else out.push({ kind: 'code', text: token.slice(1, -1) })
    last = index + token.length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

export function blocks(source: string): Block[] {
  const out: Block[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: { kind: 'ul' | 'ol'; items: Span[][] } | null = null
  let pre: string[] | null = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push({ kind: 'p', spans: spans(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    out.push(list)
    list = null
  }

  for (const raw of lines) {
    if (pre) {
      if (raw.startsWith('```')) {
        out.push({ kind: 'pre', text: pre.join('\n') })
        pre = null
      } else pre.push(raw)
      continue
    }
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      pre = []
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      out.push({ kind: 'h', spans: spans(heading[1] ?? '') })
      continue
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const kind = bullet ? 'ul' : 'ol'
      if (!list || list.kind !== kind) {
        flushList()
        list = { kind, items: [] }
      }
      list.items.push(spans((bullet ?? numbered)?.[1] ?? ''))
      continue
    }
    if (list && /^\s{2,}/.test(raw)) {
      const item = list.items[list.items.length - 1]
      if (item) item.push({ kind: 'text', text: ` ${line.trim()}` })
      continue
    }
    flushList()
    paragraph.push(line.trim())
  }
  if (pre) out.push({ kind: 'pre', text: pre.join('\n') })
  flushParagraph()
  flushList()
  return out
}
