import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, RefreshCw, Zap } from 'lucide-react'
import Badge from '../primitives/Badge'
import Separator from '../primitives/Separator'

function convictionVariant(conviction) {
  const c = String(conviction || '').toUpperCase()
  if (c === 'BULLISH') return 'signal'
  if (c === 'BEARISH') return 'live'
  return 'draft'
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function ThesisCard({ thesis, status, onStatusChange, onRegenerate }) {
  const [expanded, setExpanded] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  async function handleRegenerate() {
    if (regenerating) return
    setRegenerating(true)
    try {
      await onRegenerate?.(thesis.id)
    } finally {
      setRegenerating(false)
    }
  }

  const evidenceCount = Array.isArray(thesis.evidence_chain) ? thesis.evidence_chain.length : 0

  return (
    <div
      className={clsx(
        'rounded-lg border bg-base-surface sig-transition',
        'hover:border-border',
        expanded ? 'border-border' : 'border-border-subtle',
      )}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-start gap-3 w-full text-left p-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={convictionVariant(thesis.conviction)} size="sm">
              {thesis.conviction}
            </Badge>
            {thesis.sector && (
              <span className="text-11 text-content-muted truncate">
                {thesis.sector}
              </span>
            )}
            <span className="text-11 text-content-muted font-mono ml-auto shrink-0">
              {timeAgo(thesis.generated_at)}
            </span>
          </div>
          <h4 className="text-13 font-semibold text-content-primary leading-snug line-clamp-2">
            {thesis.title}
          </h4>
          {thesis.catalyst && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Zap size={11} className="text-draft shrink-0" />
              <span className="text-11 text-content-muted truncate">
                {thesis.catalyst}
              </span>
            </div>
          )}
        </div>
        <div className="shrink-0 mt-0.5 text-content-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <>
          <Separator />
          <div className="p-3 space-y-3">
            {/* Rationale */}
            {thesis.rationale && (
              <p className="text-12 text-content-secondary leading-relaxed">
                {thesis.rationale}
              </p>
            )}

            {/* Catalyst note */}
            {thesis.catalyst_note && (
              <div className="sig-data-ai rounded-md p-2.5">
                <span className="text-11 font-semibold text-ai uppercase tracking-wider">
                  Catalyst Note
                </span>
                <p className="text-12 text-content-secondary mt-1 leading-relaxed">
                  {thesis.catalyst_note}
                </p>
              </div>
            )}

            {/* Evidence count */}
            {evidenceCount > 0 && (
              <div className="flex items-center gap-2 text-11 text-content-muted">
                <span className="font-mono">{evidenceCount}</span>
                <span>evidence items linked</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleRegenerate() }}
                disabled={regenerating}
                className={clsx(
                  'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-11 font-medium',
                  'bg-base-elevated border border-border-subtle',
                  'text-content-secondary hover:text-content-primary hover:border-border',
                  'disabled:opacity-40 disabled:pointer-events-none',
                  'sig-transition',
                )}
              >
                <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} />
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </button>
              {onStatusChange && (
                <select
                  value={status}
                  onChange={e => onStatusChange(thesis.id, e.target.value)}
                  onClick={e => e.stopPropagation()}
                  className="h-7 px-2 rounded-md text-11 bg-base-elevated border border-border-subtle text-content-secondary sig-transition outline-none"
                >
                  <option value="new-signal">New Signal</option>
                  <option value="exploring">Exploring</option>
                  <option value="draft-thesis">Draft Thesis</option>
                  <option value="needs-evidence">Needs Evidence</option>
                  <option value="ready-for-memo">Ready for Memo</option>
                  <option value="archived">Archived</option>
                </select>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
