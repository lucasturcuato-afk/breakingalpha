import clsx from 'clsx'
import { ExternalLink } from 'lucide-react'
import Badge from '../primitives/Badge'
import { SkeletonRow } from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'

function sentimentVariant(sentiment) {
  if (!sentiment) return 'default'
  const s = String(sentiment).toLowerCase()
  if (s === 'positive' || s === 'bullish') return 'signal'
  if (s === 'negative' || s === 'bearish') return 'live'
  return 'default'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

export default function CompanyDevelopments({ articles, loading }) {
  if (loading) {
    return (
      <div className="p-4 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (!articles || articles.length === 0) {
    return (
      <EmptyState
        title="No developments"
        description="No recent articles found for this company."
      />
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      {articles.map(article => {
        const isPositive = article.sentiment && ['positive', 'bullish'].includes(String(article.sentiment).toLowerCase())
        const isNegative = article.sentiment && ['negative', 'bearish'].includes(String(article.sentiment).toLowerCase())

        return (
          <a
            key={article.id}
            href={article.url || '#'}
            target={article.url ? '_blank' : undefined}
            rel="noopener noreferrer"
            className={clsx(
              'group flex items-center gap-4 px-6 py-3',
              'border-l-[3px] sig-transition hover:bg-base-elevated',
              isPositive && 'border-l-signal-500',
              isNegative && 'border-l-live',
              !isPositive && !isNegative && 'border-l-transparent',
            )}
          >
            <span className="text-12 text-content-muted font-mono w-[60px] shrink-0">
              {formatDate(article.published_at || article.ingested_at)}
            </span>
            <div className="flex-1 min-w-0">
              <h4 className="text-13 font-medium text-content-primary truncate group-hover:text-signal-400 sig-transition">
                {article.title}
              </h4>
              {article.summary && (
                <p className="text-12 text-content-muted truncate mt-0.5">
                  {article.summary}
                </p>
              )}
            </div>
            <span className="text-11 text-content-muted w-[70px] shrink-0 truncate text-right">
              {article.source}
            </span>
            {article.sentiment && (
              <Badge variant={sentimentVariant(article.sentiment)} size="sm">
                {String(article.sentiment).slice(0, 3).toUpperCase()}
              </Badge>
            )}
            <ExternalLink
              size={12}
              className="text-content-muted opacity-0 group-hover:opacity-100 sig-transition shrink-0"
            />
          </a>
        )
      })}
    </div>
  )
}
