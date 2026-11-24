import { Fragment } from 'react'
import { parseMarkdown, type MarkdownInline } from '../domain/markdown.ts'

// Renders the token tree from parseMarkdown. Every token becomes a React element or a text node, so the source is
// escaped by construction; there is no dangerouslySetInnerHTML and no raw HTML path.

function Inline({ nodes }: { nodes: MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.value}</Fragment>
          case 'strong':
            return <strong key={i}><Inline nodes={node.children} /></strong>
          case 'em':
            return <em key={i}><Inline nodes={node.children} /></em>
          case 'code':
            return <code key={i}>{node.value}</code>
          case 'link':
            return (
              <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
                <Inline nodes={node.children} />
              </a>
            )
        }
      })}
    </>
  )
}

type Props = {
  source: string
  className?: string
}

export function Markdown({ source, className }: Props) {
  const blocks = parseMarkdown(source)
  const classes = className ? `sp-prose ${className}` : 'sp-prose'

  return (
    <div className={classes}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          // The page title is h1 and the modal title is h2, so markdown headings start at h3.
          const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
          return <Tag key={i}><Inline nodes={block.children} /></Tag>
        }

        if (block.type === 'paragraph') {
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Inline nodes={line} />
                </Fragment>
              ))}
            </p>
          )
        }

        const items = block.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)
        return block.ordered
          ? <ol key={i} start={block.start}>{items}</ol>
          : <ul key={i}>{items}</ul>
      })}
    </div>
  )
}
