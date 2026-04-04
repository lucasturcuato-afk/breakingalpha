import { useState, useMemo } from 'react'
import clsx from 'clsx'
import { ExternalLink, Bookmark } from 'lucide-react'
import Badge from '../primitives/Badge'
import { SkeletonRow } from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'tech', label: 'Tech M&A' },
  { key: 'vc', label: 'Venture' },
  { key: 'pe', label: 'Private Eq' },
  { key: 'pub', label: 'Public Mkt' },
  { key: 'geo', label: 'Geo & Macro' },
  { key: 'fin', label: 'Fintech' },
  { key: 'health', label: 'Healthcare' },
  { key: 'energy', label: 'Energy' },
]

const SECTOR_KEY_MAP = {
  tech: 'Technology M&A',
  vc: 'Venture Capital',
  pe: 'Private Equity',
  pub: 'Public Markets',
  geo: 'Geopolitics',
  fin: 'Fintech',
  health: 'Healthcare',
  energy: 'Energy',
}

function sentimentVariant(sentiment) {
  if (!sentiment) return 'default'
  const s = String(sentiment).toLowerCase()
  if (s === 'positive' || s === 'bullish') return 'signal'
  if (s === 'negative' || s === 'bearish') return 'live'
  return 'default'
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function FeedRow({ article }) {
  const sentiment = article.sentiment
  const isPositive = sentiment && ['positive', 'bullish'].includes(String(sentiment).toLowerCase())
  const isNegative = sentiment && ['negative', 'bearish'].includes(String(sentiment).toLowerCase())

  return (
    <a
      href={article.url || '#'}
      target={article.url ? '_blank' : undefined}
      rel="noopener noreferrer"
      className={clsx(
        'group flex items-start gap-3 px-4 py-3',
        'border-l-[3px] sig-transition',
        'hover:bg-base-elevated',
        isPositive && 'border-l-signal-500 bg-signal-muted/50',
        isNegative && 'border-l-live bg-live/5',
        !isPositive && !isNegative && 'border-l-transparent',
      )}
    >
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {article.sector && (
            <span className="text-11 font-medium text-content-muted uppercase tracking-wider truncate">
              {article.sector}
            </span>
          )}
          <span className="text-11 text-content-muted font-mono">
            {timeAgo(article.ingested_at || article.published_at)}
          </span>
        </div>
        <h4 className="text-13 font-medium text-content-primary leading-snug line-clamp-2 group-hover:text-signal-400 sig-transition">
          {article.title}
        </h4>
        {article.summary && (
          <p className="text-12 text-content-muted mt-1 line-clamp-1">
            {article.summary}
          </p>
        )}
      </div>

      {/* Right meta */}
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        {sentiment && (
          <Badge variant={sentimentVariant(sentiment)} size="sm">
            {String(sentiment).toUpperCase()}
          </Badge>
        )}
        <span className="text-11 text-content-muted truncate max-w-[80px]">
          {article.source}
        </span>
        <ExternalLink
          size={12}
          className="text-content-muted opacity-0 group-hover:opacity-100 sig-transition"
        />
      </div>
    </a>
  )
}

export default function LiveFeed({ articles, loading }) {
  const [filter, setFilter] = useState('all')

  const filtered = useMemo(() => {
    if (!articles) return []
    if (filter === 'all') return articles
    const prefix = SECTOR_KEY_MAP[filter]
    if (!prefix) return articles
    return articles.filter(a => {
      const sector = a.sector || ''
      return sector.toLowerCase().includes(prefix.toLowerCase())
    })
  }, [articles, filter])

  return (
    <div className="flex flex-col h-full">
      {/* Sticky filter bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border-subtle bg-base sticky top-0 z-10 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'px-2.5 h-7 rounded-md text-12 font-medium whitespace-nowrap sig-transition',
              filter === f.key
                ? 'bg-signal-muted text-signal-400'
                : 'text-content-muted hover:text-content-secondary hover:bg-base-elevated'
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto text-11 text-content-muted font-mono shrink-0">
          {filtered.length} items
        </div>
      </div>

      {/* Feed list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
        {loading ? (
          <div className="px-4 py-2 space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No articles"
            description="No articles match the current filter. Try a different sector."
          />
        ) : (
          filtered.map(article => (
            <FeedRow key={article.id} article={article} />
          ))
        )}
      </div>
    </div>
  )
}
