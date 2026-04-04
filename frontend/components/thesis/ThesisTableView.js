import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, RefreshCw, Zap } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../primitives/Table'
import Badge from '../primitives/Badge'
import Separator from '../primitives/Separator'
import EmptyState from '../primitives/EmptyState'

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
  return `${Math.floor(diff / 86400)}d`
}

const STATUS_LABELS = {
  'new-signal': 'New Signal',
  'exploring': 'Exploring',
  'draft-thesis': 'Draft',
  'needs-evidence': 'Needs Evidence',
  'ready-for-memo': 'Ready',
  'archived': 'Archived',
}

const STATUS_COLORS = {
  'new-signal': 'text-signal-400',
  'exploring': 'text-draft',
  'draft-thesis': 'text-ai',
  'needs-evidence': 'text-live',
  'ready-for-memo': 'text-signal-600',
  'archived': 'text-meta',
}

function ExpandedRow({ thesis, onRegenerate }) {
  const [regenerating, setRegenerating] = useState(false)

  async function handleRegenerate() {
    if (regenerating) return
    setRegenerating(true)
    try { await onRegenerate?.(thesis.id) } finally { setRegenerating(false) }
  }

  return (
    <tr>
      <td colSpan={6} className="px-3 pb-3">
        <div className="rounded-md bg-base-elevated border border-border-subtle p-3 space-y-2">
          {thesis.rationale && (
            <p className="text-12 text-content-secondary leading-relaxed">
              {thesis.rationale}
            </p>
          )}
          {thesis.catalyst_note && (
            <div className="sig-data-ai rounded p-2.5">
              <span className="text-11 font-semibold text-ai uppercase tracking-wider">
                Catalyst Note
              </span>
              <p className="text-12 text-content-secondary mt-1 leading-relaxed">
                {thesis.catalyst_note}
              </p>
            </div>
          )}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className={clsx(
              'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-11 font-medium',
              'bg-base-surface border border-border-subtle',
              'text-content-secondary hover:text-content-primary hover:border-border',
              'disabled:opacity-40 disabled:pointer-events-none sig-transition',
            )}
          >
            <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} />
            {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function ThesisTableView({ theses, statusMap, onStatusChange, onRegenerate, sortKey, sortDir, onSort }) {
  const [expandedId, setExpandedId] = useState(null)

  function handleSort(key) {
    if (onSort) {
      if (sortKey === key) onSort(key, sortDir === 'asc' ? 'desc' : 'asc')
      else onSort(key, 'desc')
    }
  }

  function SortIcon({ colKey }) {
    if (sortKey !== colKey) return null
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-content-muted" />
      : <ChevronDown size={11} className="text-content-muted" />
  }

  if (!theses || theses.length === 0) {
    return (
      <EmptyState
        title="No theses yet"
        description="Generate theses from the feed or create one manually."
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead
            className="cursor-pointer select-none"
            onClick={() => handleSort('title')}
          >
            <span className="flex items-center gap-1">Thesis <SortIcon colKey="title" /></span>
          </TableHead>
          <TableHead
            className="w-[90px] cursor-pointer select-none"
            onClick={() => handleSort('conviction')}
          >
            <span className="flex items-center gap-1">Signal <SortIcon colKey="conviction" /></span>
          </TableHead>
          <TableHead className="w-[120px]">Sector</TableHead>
          <TableHead className="w-[110px]">Status</TableHead>
          <TableHead className="w-[50px]">Evid.</TableHead>
          <TableHead
            className="w-[60px] cursor-pointer select-none"
            align="right"
            onClick={() => handleSort('generated_at')}
          >
            <span className="flex items-center gap-1 justify-end">Age <SortIcon colKey="generated_at" /></span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {theses.map(thesis => {
          const isExpanded = expandedId === thesis.id
          const status = statusMap[thesis.id] || 'new-signal'
          const evidenceCount = Array.isArray(thesis.evidence_chain) ? thesis.evidence_chain.length : 0

          return (
            <>
              <TableRow
                key={thesis.id}
                hover
                selected={isExpanded}
                onClick={() => setExpandedId(isExpanded ? null : thesis.id)}
              >
                <TableCell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-13 font-medium text-content-primary truncate">
                      {thesis.title}
                    </span>
                    {thesis.catalyst && (
                      <span className="flex items-center gap-1 text-11 text-content-muted mt-0.5 truncate">
                        <Zap size={10} className="text-draft shrink-0" />
                        {thesis.catalyst}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={convictionVariant(thesis.conviction)} size="sm">
                    {thesis.conviction}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-12 text-content-muted truncate">
                    {thesis.sector || '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={clsx('text-12 font-medium', STATUS_COLORS[status])}>
                    {STATUS_LABELS[status]}
                  </span>
                </TableCell>
                <TableCell mono>
                  {evidenceCount || '—'}
                </TableCell>
                <TableCell mono align="right">
                  {timeAgo(thesis.generated_at)}
                </TableCell>
              </TableRow>
              {isExpanded && (
                <ExpandedRow
                  key={`${thesis.id}-detail`}
                  thesis={thesis}
                  onRegenerate={onRegenerate}
                />
              )}
            </>
          )
        })}
      </TableBody>
    </Table>
  )
}
