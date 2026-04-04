import { memo } from 'react'
import clsx from 'clsx'
import { Trash2, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react'
import Badge from '../primitives/Badge'
import { SkeletonRow } from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'
import Button from '../primitives/Button'
import Link from 'next/link'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

const WatchlistRow = memo(function WatchlistRow({ entry, quote, onRemove }) {
  const isPositive = quote && quote.pct > 0
  const isNegative = quote && quote.pct < 0

  return (
    <div
      className={clsx(
        'group flex items-center gap-4 px-6 py-3',
        'border-l-[3px] sig-transition hover:bg-base-elevated',
        isPositive && 'border-l-signal-500',
        isNegative && 'border-l-live',
        !quote && 'border-l-transparent',
      )}
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-14 font-semibold text-content-primary font-mono">
              {entry.identifier}
            </span>
            <Badge variant={entry.type === 'ticker' ? 'signal' : 'meta'} size="sm">
              {entry.type}
            </Badge>
          </div>
          <span className="text-11 text-content-muted">
            Added {formatDate(entry.created_at)}
          </span>
        </div>
      </div>

      {quote && (
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-13 font-mono tabular-nums text-content-primary w-[80px] text-right">
            {quote.price}
          </span>
          <span
            className={clsx(
              'flex items-center gap-1 text-12 font-mono tabular-nums w-[70px] justify-end',
              isPositive && 'text-signal-400',
              isNegative && 'text-live',
              !isPositive && !isNegative && 'text-content-muted',
            )}
          >
            {isPositive && <TrendingUp size={12} />}
            {isNegative && <TrendingDown size={12} />}
            {isPositive ? '+' : ''}{quote.pct}%
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {entry.type === 'company' && (
          <Link
            href={`/company/${encodeURIComponent(entry.identifier)}`}
            className="p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-base-overlay sig-transition opacity-0 group-hover:opacity-100"
            title="View company page"
          >
            <ExternalLink size={13} />
          </Link>
        )}
        <button
          onClick={() => onRemove(entry.id)}
          className="p-1.5 rounded text-content-muted hover:text-live hover:bg-live/10 sig-transition opacity-0 group-hover:opacity-100"
          title="Remove from watchlist"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
})

export default function WatchlistTable({ entries, quotes, loading, onRemove, onAdd }) {
  if (loading) {
    return (
      <div className="p-4 space-y-1">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (!entries || entries.length === 0) {
    return (
      <EmptyState
        title="Watchlist empty"
        description="Add tickers or companies to track prices and related developments."
        action={
          <Button variant="primary" size="sm" onClick={onAdd}>
            Add your first symbol
          </Button>
        }
      />
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      <div className="flex items-center gap-4 px-6 py-2 text-11 font-medium text-content-muted uppercase tracking-wider">
        <span className="flex-1">Symbol</span>
        <span className="w-[80px] text-right">Price</span>
        <span className="w-[70px] text-right">Change</span>
        <span className="w-[60px]" />
      </div>
      {entries.map(entry => (
        <WatchlistRow
          key={entry.id}
          entry={entry}
          quote={quotes[entry.identifier]}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}
