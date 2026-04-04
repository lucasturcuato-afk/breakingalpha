import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { Copy, Check, FileDown, Pencil, Eye } from 'lucide-react'
import Separator from '../primitives/Separator'
import Skeleton from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'

function parseMemoSections(raw) {
  if (!raw) return []
  const lines = raw.split('\n')
  const sections = []
  let current = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Section header: all-caps line or **HEADER** format
    const isHeader = /^[A-Z][A-Z &/']+$/.test(trimmed) ||
                     /^\*\*[A-Z].*\*\*$/.test(trimmed)

    if (isHeader) {
      if (current) sections.push(current)
      current = {
        title: trimmed.replace(/\*\*/g, ''),
        content: [],
      }
    } else if (current) {
      current.content.push(trimmed)
    } else {
      // Text before first header
      current = { title: '', content: [trimmed] }
    }
  }
  if (current) sections.push(current)
  return sections
}

export default function MemoEditor({ memo, loading, sourceData }) {
  const [mode, setMode] = useState('preview')
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (memo) setEditContent(memo)
  }, [memo])

  function handleCopy() {
    navigator.clipboard.writeText(editContent || memo || '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleExportMarkdown() {
    const content = editContent || memo || ''
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deal-memo-${(sourceData?.company || 'draft').toLowerCase().replace(/\s+/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sections = parseMemoSections(memo)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border-subtle">
        <span className="text-12 font-semibold text-content-primary uppercase tracking-wider">
          Deal Memo
        </span>
        {sourceData?.company && (
          <span className="text-12 text-content-muted">
            — {sourceData.company}
          </span>
        )}

        <div className="flex-1" />

        {memo && (
          <>
            {/* Mode toggle */}
            <div className="flex items-center bg-base-elevated rounded-md border border-border-subtle p-0.5 mr-2">
              <button
                onClick={() => setMode('preview')}
                className={clsx(
                  'flex items-center gap-1.5 h-6 px-2 rounded text-11 sig-transition',
                  mode === 'preview'
                    ? 'bg-base-surface text-content-primary shadow-sm'
                    : 'text-content-muted hover:text-content-secondary'
                )}
              >
                <Eye size={11} />
                Preview
              </button>
              <button
                onClick={() => setMode('edit')}
                className={clsx(
                  'flex items-center gap-1.5 h-6 px-2 rounded text-11 sig-transition',
                  mode === 'edit'
                    ? 'bg-base-surface text-content-primary shadow-sm'
                    : 'text-content-muted hover:text-content-secondary'
                )}
              >
                <Pencil size={11} />
                Edit
              </button>
            </div>

            {/* Copy */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-11 font-medium bg-base-elevated border border-border-subtle text-content-secondary hover:text-content-primary hover:border-border sig-transition"
            >
              {copied ? <Check size={12} className="text-signal-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>

            {/* Export */}
            <button
              onClick={handleExportMarkdown}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-11 font-medium bg-base-elevated border border-border-subtle text-content-secondary hover:text-content-primary hover:border-border sig-transition"
            >
              <FileDown size={12} />
              Export .md
            </button>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-4">
            <Skeleton width="60%" height="24px" rounded="sm" />
            <Skeleton width="40%" height="16px" rounded="sm" />
            <div className="space-y-2 mt-6">
              <Skeleton height="14px" rounded="sm" />
              <Skeleton height="14px" rounded="sm" />
              <Skeleton width="80%" height="14px" rounded="sm" />
            </div>
            <Skeleton width="50%" height="18px" rounded="sm" className="mt-6" />
            <div className="space-y-2">
              <Skeleton height="14px" rounded="sm" />
              <Skeleton height="14px" rounded="sm" />
              <Skeleton width="70%" height="14px" rounded="sm" />
            </div>
          </div>
        ) : !memo ? (
          <EmptyState
            title="No memo yet"
            description="Fill in the source panel and click Generate to create an AI-powered deal memo."
            className="h-full"
          />
        ) : mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            className={clsx(
              'w-full h-full p-6 text-13 leading-relaxed',
              'bg-transparent text-content-primary',
              'font-mono',
              'outline-none resize-none',
            )}
          />
        ) : (
          <div className="p-6 max-w-[680px]">
            {/* Title block */}
            {sourceData?.company && (
              <div className="mb-6">
                <h1 className="text-24 font-bold text-content-primary">
                  {sourceData.company}
                  {sourceData.acquirer ? ` / ${sourceData.acquirer}` : ''}
                </h1>
                <div className="flex items-center gap-3 mt-1.5">
                  {sourceData.deal_type && (
                    <span className="text-12 font-medium text-draft">
                      {sourceData.deal_type}
                    </span>
                  )}
                  {sourceData.value && (
                    <span className="text-12 font-mono text-content-secondary">
                      {sourceData.value}
                    </span>
                  )}
                  {sourceData.sector && (
                    <span className="text-12 text-content-muted">
                      {sourceData.sector}
                    </span>
                  )}
                </div>
                <Separator className="mt-4" />
              </div>
            )}

            {/* Memo sections */}
            {sections.map((section, i) => (
              <div key={i} className="mb-5">
                {section.title && (
                  <h2 className="text-11 font-bold text-content-muted uppercase tracking-widest mb-2">
                    {section.title}
                  </h2>
                )}
                <div className="sig-data-ai rounded-md px-4 py-3 space-y-1.5">
                  {section.content.map((line, j) => {
                    const isBullet = line.startsWith('-') || line.startsWith('•') || line.startsWith('*')
                    return (
                      <p
                        key={j}
                        className={clsx(
                          'text-13 text-content-secondary leading-relaxed',
                          isBullet && 'pl-3'
                        )}
                      >
                        {line}
                      </p>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Timestamp */}
            <div className="mt-8 pt-4 border-t border-border-subtle">
              <span className="text-11 text-content-muted font-mono">
                Generated {new Date().toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
                {' · '}AI-generated via Groq/Llama 3.1
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
