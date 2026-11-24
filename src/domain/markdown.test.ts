import { describe, expect, it } from 'vitest'
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from './markdown.ts'

const text = (value: string): MarkdownInline => ({ type: 'text', value })
const paragraph = (...lines: MarkdownInline[][]): MarkdownBlock => ({ type: 'paragraph', lines })

describe('markdown blocks', () => {
  it('parses headings from # to ######', () => {
    expect(parseMarkdown('# Title')).toEqual([
      { type: 'heading', level: 1, children: [text('Title')] },
    ])
    expect(parseMarkdown('###### Six')).toEqual([
      { type: 'heading', level: 6, children: [text('Six')] },
    ])
  })

  it('parses unordered and ordered lists, keeping the ordered start', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      { type: 'list', ordered: false, items: [[text('one')], [text('two')]] },
    ])
    expect(parseMarkdown('3. three\n4. four')).toEqual([
      { type: 'list', ordered: true, start: 3, items: [[text('three')], [text('four')]] },
    ])
  })

  it('splits paragraphs on blank lines and keeps hard breaks inside one', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      paragraph([text('one')], [text('two')]),
      paragraph([text('three')]),
    ])
  })

  it('ends a list at a blank line or a paragraph line', () => {
    expect(parseMarkdown('- one\n\ntwo')).toEqual([
      { type: 'list', ordered: false, items: [[text('one')]] },
      paragraph([text('two')]),
    ])
  })
})

describe('markdown inline', () => {
  it('parses bold, italic and inline code', () => {
    expect(parseMarkdown('**bold** and *italic* and `code`')).toEqual([
      paragraph([
        { type: 'strong', children: [text('bold')] },
        text(' and '),
        { type: 'em', children: [text('italic')] },
        text(' and '),
        { type: 'code', value: 'code' },
      ]),
    ])
  })

  it('parses http, https and mailto links', () => {
    expect(parseMarkdown('[a](https://example.com) [b](http://example.com) [c](mailto:cook@example.com)')).toEqual([
      paragraph(
        [
          { type: 'link', href: 'https://example.com', children: [text('a')] },
          text(' '),
          { type: 'link', href: 'http://example.com', children: [text('b')] },
          text(' '),
          { type: 'link', href: 'mailto:cook@example.com', children: [text('c')] },
        ],
      ),
    ])
  })

  it('keeps a javascript: link as plain text', () => {
    expect(parseMarkdown('[click](javascript:alert(1))')).toEqual([
      paragraph([text('[click](javascript:alert(1))')]),
    ])
  })

  it('does not turn a markdown image into a link', () => {
    expect(parseMarkdown('![x](https://example.com/a.png)')).toEqual([
      paragraph([text('![x](https://example.com/a.png)')]),
    ])
  })
})

describe('markdown sanitising', () => {
  it('keeps an img onerror payload as text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
      paragraph([text('<img src=x onerror=alert(1)>')]),
    ])
  })

  it('keeps a closing script tag as text', () => {
    expect(parseMarkdown('</script>')).toEqual([paragraph([text('</script>')])])
  })

  it('never emits an HTML token', () => {
    const types = JSON.stringify(parseMarkdown('<b>bold</b> **strong**')).match(/"type":"[^"]+"/g) ?? []
    expect(types.every((t) => /"(heading|paragraph|list|text|strong|em|code|link)"$/.test(t))).toBe(true)
  })
})

describe('markdown malformed input', () => {
  it('keeps unclosed emphasis as text', () => {
    expect(parseMarkdown('**bold')).toEqual([paragraph([text('**bold')])])
    expect(parseMarkdown('*italic')).toEqual([paragraph([text('*italic')])])
  })

  it('keeps a lone # and ### as text', () => {
    expect(parseMarkdown('#')).toEqual([paragraph([text('#')])])
    expect(parseMarkdown('###')).toEqual([paragraph([text('###')])])
  })

  it('keeps an unclosed link as text', () => {
    expect(parseMarkdown('[label](https://example.com')).toEqual([
      paragraph([text('[label](https://example.com')]),
    ])
  })
})
