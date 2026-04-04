import { memo } from 'react'
import clsx from 'clsx'
import { ExternalLink, Bookmark, BookmarkCheck, Lightbulb } from 'lucide-react'
import Badge from '../primitives/Badge'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function sentimentBadge(sentiment) {
  if (!sentiment) return null
  const s = String(sentiment).toLowerCase()
  let variant = 'default'
  if (s === 'positive' || s === 'bullish') variant = 'signal'
  if (s === 'negative' || s === 'bearish') variant = 'live'
  return (
    <Badge variant={variant} size="sm">
      {String(sentiment).slice(0, 3).toUpperCase()}
    </Badge>
  )
}

const FeedRow = memo(function FeedRow({
  article,
  isRead,
  isSaved,
  isInThesis,
  onToggleSave,
  onMarkRead,
}) {
  const sentiment = article.sentiment
  const isPositive = sentiment && ['positive', 'bullish'].includes(String(sentiment).toLowerCase())
  const isNegative = sentiment && ['negative', 'bearish'].includes(String(sentiment).toLowerCase())

  return (
    <div
      className={clsx(
        'group flex items-center gap-3 px-4 h-[52px]',
        'border-l-[3px] sig-transition cursor-pointer',
        'hover:bg-base-elevated',
        isPositive && 'border-l-signal-500',
        isNegative && 'border-l-live',
        !isPositive && !isNegative && 'border-l-transparent',
        !isRead && 'bg-signal-muted/30',
      )}
      onClick={() => {
        onMarkRead?.(article.id)
        if (article.url) window.open(article.url, '_blank', 'noopener,noreferrer')
      }}
    >
      {/* Unread dot */}
      <div className="w-1.5 shrink-0">
        {!isRead && (
          <div className="w-1.5 h-1.5 rounded-full bg-signal-500" />
        )}
      </div>

      {/* Sector + time */}
      <div className="w-[100px] shrink-0 flex flex-col">
        <span className="text-11 font-medium text-content-muted uppercase tracking-wider truncate">
          {article.sector || 'General'}
        </span>
        <span className="text-11 text-content-muted font-mono">
          {timeAgo(article.ingested_at || article.published_at)}
        </span>
      </div>

      {/* Title + summary */}
      <div className="flex-1 min-w-0">
        <h4
          className={clsx(
            'text-13 font-medium leading-snug truncate',
            'group-hover:text-signal-400 sig-transition',
            isRead ? 'text-content-secondary' : 'text-content-primary'
          )}
        >
          {article.title}
        </h4>
        {article.summary && (
          <p className="text-11 text-content-muted truncate mt-px">
            {article.summary}
          </p>
        )}
      </div>

      {/* Source */}
      <span className="text-11 text-content-muted w-[80px] shrink-0 truncate text-right">
        {article.source}
      </span>

      {/* Sentiment */}
      <div className="w-[48px] shrink-0 flex justify-center">
        {sentimentBadge(article.sentiment)}
      </div>

      {/* State indicators */}
      <div className="flex items-center gap-1 w-[52px] shrink-0 justify-end">
        {isInThesis && (
          <Lightbulb size={13} className="text-draft" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleSave?.(article.id)
          }}
          className={clsx(
            'flex items-center justify-center h-6 w-6 rounded sig-transition',
            isSaved
              ? 'text-signal-400'
              : 'text-content-muted opacity-0 group-hover:opacity-100 hover:text-content-secondary'
          )}
          aria-label={isSaved ? 'Unsave' : 'Save'}
        >
          {isSaved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
        </button>
        <ExternalLink
          size={12}
          className="text-content-muted opacity-0 group-hover:opacity-100 sig-transition"
        />
      </div>
    </div>
  )
})

export default FeedRow
