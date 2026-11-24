// A deliberately small Markdown subset for recipe instructions: headings, lists, bold, italic, inline code and
// http/https/mailto links. The parser returns a neutral token tree; the view renders it as React elements, so text
// is escaped by construction and no HTML ever reaches dangerouslySetInnerHTML. Anything not recognised stays text,
// so malformed input remains readable.

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: 'paragraph'; lines: MarkdownInline[][] }
  | { type: 'list'; ordered: boolean; start?: number; items: MarkdownInline[][] }

const HEADING = /^(#{1,6})[ \t]+(\S.*)$/
const UNORDERED = /^[ \t]{0,3}[-*+][ \t]+(.+)$/
const ORDERED = /^[ \t]{0,3}(\d{1,9})[.)][ \t]+(.+)$/
const BLANK = /^[ \t]*$/
const LINK = /^\[([^\]]+)\]\(([^)\s]*)\)/
const SAFE_HREF = /^(https?:\/\/|mailto:)/i

/** Only the schemes a recipe note needs. Everything else (javascript:, data:, relative paths) stays text. */
function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (href === '' || [...href].some((char) => char.charCodeAt(0) <= 0x20)) return null
  return SAFE_HREF.test(href) ? href : null
}

function pushText(nodes: MarkdownInline[], value: string) {
  if (value === '') return
  const last = nodes[nodes.length - 1]
  if (last?.type === 'text') last.value += value
  else nodes.push({ type: 'text', value })
}

/** Inline spans. Depth is capped so pathological nesting cannot grow without bound. */
function parseInline(source: string, depth = 0): MarkdownInline[] {
  if (depth > 4) return [{ type: 'text', value: source }]

  const nodes: MarkdownInline[] = []
  let i = 0

  while (i < source.length) {
    const char = source[i]

    if (char === '`') {
      const end = source.indexOf('`', i + 1)
      if (end > i + 1) {
        nodes.push({ type: 'code', value: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
      pushText(nodes, '`')
      i += 1
      continue
    }

    // An image is not part of the subset: keep the whole construct as text rather than turning it into a link.
    if (char === '!' && source[i + 1] === '[') {
      const image = LINK.exec(source.slice(i + 1))
      if (image) {
        pushText(nodes, `!${image[0]}`)
        i += 1 + image[0].length
        continue
      }
      pushText(nodes, '!')
      i += 1
      continue
    }

    if (char === '[') {
      const link = LINK.exec(source.slice(i))
      if (link) {
        const href = safeHref(link[2])
        if (href) {
          nodes.push({ type: 'link', href, children: parseInline(link[1], depth + 1) })
        } else {
          pushText(nodes, link[0])
        }
        i += link[0].length
        continue
      }
      pushText(nodes, '[')
      i += 1
      continue
    }

    if (char === '*' || char === '_') {
      const marker = source.startsWith(char + char, i) ? char + char : char
      const end = source.indexOf(marker, i + marker.length)
      if (end > i + marker.length) {
        const children = parseInline(source.slice(i + marker.length, end), depth + 1)
        nodes.push(marker.length === 2 ? { type: 'strong', children } : { type: 'em', children })
        i = end + marker.length
        continue
      }
      pushText(nodes, marker)
      i += marker.length
      continue
    }

    pushText(nodes, char)
    i += 1
  }

  return nodes
}

/** Block tokens: headings, flat lists, and paragraphs whose hard line breaks are kept as separate lines. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: MarkdownInline[][] = []

  const flush = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', lines: paragraph })
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (BLANK.test(line)) {
      flush()
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ type: 'heading', level, children: parseInline(heading[2].trim()) })
      i += 1
      continue
    }

    const unordered = UNORDERED.exec(line)
    const ordered = unordered ? null : ORDERED.exec(line)
    if (unordered || ordered) {
      flush()
      const isOrdered = ordered !== null
      const items: MarkdownInline[][] = []
      let start: number | undefined

      while (i < lines.length) {
        const match = isOrdered ? ORDERED.exec(lines[i]) : UNORDERED.exec(lines[i])
        if (!match) break
        if (isOrdered && start === undefined) start = Number(match[1])
        items.push(parseInline((isOrdered ? match[2] : match[1]).trim()))
        i += 1
      }

      if (isOrdered && start !== undefined && start !== 1) blocks.push({ type: 'list', ordered: true, start, items })
      else blocks.push({ type: 'list', ordered: isOrdered, items })
      continue
    }

    paragraph.push(parseInline(line.trim()))
    i += 1
  }

  flush()
  return blocks
}
