import { Children, isValidElement, cloneElement } from 'react'
import type { ReactNode, ReactElement, PropsWithChildren } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { clsx } from 'clsx'

interface MarkdownViewerProps {
  content: string
  className?: string
}

type CalloutConfig = {
  tone: string
  label: string
  icon: string
  border: string
  bg: string
}

const CALLOUTS: Record<string, CalloutConfig> = {
  note: { tone: 'note', label: 'Note', icon: 'NOTE', border: 'border-blue-400/30', bg: 'bg-blue-500/10' },
  info: { tone: 'info', label: 'Info', icon: 'INFO', border: 'border-cyan-400/30', bg: 'bg-cyan-500/10' },
  tip: { tone: 'tip', label: 'Tip', icon: 'TIP', border: 'border-emerald-400/30', bg: 'bg-emerald-500/10' },
  warning: { tone: 'warning', label: 'Warning', icon: 'WARN', border: 'border-amber-400/30', bg: 'bg-amber-500/10' },
  danger: { tone: 'danger', label: 'Danger', icon: 'DANGER', border: 'border-red-400/30', bg: 'bg-red-500/10' },
  quote: { tone: 'quote', label: 'Quote', icon: 'QUOTE', border: 'border-white/20', bg: 'bg-white/5' },
  example: { tone: 'example', label: 'Example', icon: 'EXAMPLE', border: 'border-violet-400/30', bg: 'bg-violet-500/10' },
}

const DEFAULT_CALLOUT = CALLOUTS.note
const INLINE_TOKEN_RE = /(!?\[\[[^\]]+\]\]|==[^=]+==|#[A-Za-z0-9/_-]+)/g

function parseWikiToken(raw: string) {
  const isEmbed = raw.startsWith('![[', 0)
  const inner = raw.slice(isEmbed ? 3 : 2, -2).trim()
  const [left, alias] = inner.split('|')
  const [path, heading] = left.split('#')
  const label = (alias || (heading ? `${path}#${heading}` : path)).trim()
  return { path: path.trim(), heading: heading?.trim(), label, isEmbed }
}

function renderInlineTokens(text: string) {
  const parts = text.split(INLINE_TOKEN_RE)
  return parts.map((part, index) => {
    if (!part) return null
    if (part.startsWith('[[') || part.startsWith('![[')) {
      const info = parseWikiToken(part)
      return (
        <span
          key={`wiki-${index}`}
          className={clsx(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-medium',
            info.isEmbed
              ? 'border-purple-400/30 bg-purple-500/10 text-purple-200'
              : 'border-orange-400/30 bg-orange-500/10 text-orange-200',
          )}
          title={info.path}
          data-wikilink={info.path}
        >
          {info.isEmbed ? 'EMBED' : ''}
          {info.label}
        </span>
      )
    }
    if (part.startsWith('==') && part.endsWith('==')) {
      const value = part.slice(2, -2)
      return (
        <mark
          key={`mark-${index}`}
          className="rounded-sm bg-amber-400/20 px-1 text-amber-200"
        >
          {value}
        </mark>
      )
    }
    if (part.startsWith('#') && part.length > 1) {
      return (
        <span
          key={`tag-${index}`}
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-300"
        >
          {part}
        </span>
      )
    }
    return part
  })
}

function renderObsidianInline(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderInlineTokens(child)
    }
    if (isValidElement(child)) {
      const type = child.type
      if (type === 'code' || type === 'pre') {
        return child
      }
      const childProps = child.props as PropsWithChildren<unknown>
      if (childProps?.children) {
        return cloneElement(child as ReactElement<PropsWithChildren<unknown>>, {
          children: renderObsidianInline(childProps.children),
        })
      }
    }
    return child
  })
}

function extractParagraphText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const nodeObj = node as { children?: unknown[] }
  if (!nodeObj.children) return ''
  return nodeObj.children
    .map((child) => {
      if (child && typeof child === 'object' && 'value' in child) {
        return typeof child.value === 'string' ? child.value : ''
      }
      return ''
    })
    .join('')
    .trim()
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  return (
    <div
      className={clsx(
        'markdown-viewer prose prose-invert prose-sm max-w-none',
        'prose-headings:font-semibold prose-headings:text-white',
        'prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg',
        'prose-p:leading-relaxed prose-p:text-gray-200 prose-p:my-3',
        'prose-headings:mt-6 prose-headings:mb-2',
        'prose-hr:border-white/10 prose-hr:my-6',
        'prose-a:text-orange-300 prose-a:no-underline hover:prose-a:text-orange-200',
        'prose-strong:text-white',
        'prose-code:text-orange-300 prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
        'prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10',
        'prose-ul:pl-5 prose-ol:pl-5 prose-li:my-1.5 prose-li:leading-relaxed',
        'prose-table:w-full prose-table:table-fixed',
        'prose-th:text-gray-300 prose-th:font-semibold',
        'prose-td:align-top',
        'prose-blockquote:border-l-2 prose-blockquote:border-white/10 prose-blockquote:text-gray-300',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {renderObsidianInline(children)}
            </a>
          ),
          input: ({ ...props }) => (
            <input
              {...props}
              disabled
              className="mr-2 accent-orange-500"
            />
          ),
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
          blockquote: ({ children, node, ...props }) => {
            const childNodes = node?.children || []
            const firstParagraph = childNodes[0]
            const firstText = extractParagraphText(firstParagraph)
            const match = firstText.match(/^\[!([A-Za-z0-9_-]+)\](?:\s+(.*))?$/)
            if (!match) {
              return (
                <blockquote {...props}>
                  {renderObsidianInline(children)}
                </blockquote>
              )
            }

            const type = match[1].toLowerCase()
            const title = match[2]?.trim()
            const callout = CALLOUTS[type] ?? DEFAULT_CALLOUT
            const bodyChildren = Children.toArray(children).slice(1)

            return (
              <div
                className={clsx(
                  'not-prose rounded-xl border px-4 py-3 my-4',
                  callout.border,
                  callout.bg,
                )}
              >
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-300 mb-2">
                  <span className="text-base">{callout.icon}</span>
                  <span>{title || callout.label}</span>
                </div>
                <div className="text-sm text-gray-200 space-y-2">
                  {bodyChildren.length ? renderObsidianInline(bodyChildren) : null}
                </div>
              </div>
            )
          },
          p: ({ children, ...props }) => (
            <p {...props}>{renderObsidianInline(children)}</p>
          ),
          li: ({ children, ...props }) => (
            <li {...props}>{renderObsidianInline(children)}</li>
          ),
          h1: ({ children, ...props }) => (
            <h1 {...props}>{renderObsidianInline(children)}</h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 {...props}>{renderObsidianInline(children)}</h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 {...props}>{renderObsidianInline(children)}</h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 {...props}>{renderObsidianInline(children)}</h4>
          ),
          td: ({ children, ...props }) => (
            <td {...props}>{renderObsidianInline(children)}</td>
          ),
          th: ({ children, ...props }) => (
            <th {...props}>{renderObsidianInline(children)}</th>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
