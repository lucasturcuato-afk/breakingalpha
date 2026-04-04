import { memo } from 'react'
import clsx from 'clsx'
import {
  TrendingUp,
  TrendingDown,
  Zap,
  AlertTriangle,
  BarChart3,
  Lightbulb,
  ExternalLink,
} from 'lucide-react'
import Badge from '../primitives/Badge'
import Link from 'next/link'

const TYPE_CONFIG = {
  sentiment_positive: {
    icon: TrendingUp,
    badge: 'signal',
    badgeLabel: 'BULLISH',
    border: 'border-l-signal-500',
  },
  sentiment_negative: {
    icon: TrendingDown,
    badge: 'live',
    badgeLabel: 'BEARISH',
    border: 'border-l-live',
  },
  volume: {
    icon: BarChart3,
    badge: 'draft',
    badgeLabel: 'VOLUME',
    border: 'border-l-draft',
  },
  breaking: {
    icon: Zap,
    badge: 'live',
    badgeLabel: 'BREAKING',
    border: 'border-l-live',
  },
  thesis: {
    icon: Lightbulb,
    badge: 'ai',
    badgeLabel: 'THESIS',
    border: 'border-l-ai',
  },
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const SignalCard = memo(function SignalCard({ signal }) {
  const config = TYPE_CONFIG[signal.type] || TYPE_CONFIG.breaking
  const Icon = config.icon

  return (
    <div
      className={clsx(
        'group flex gap-3 px-6 py-4',
        'border-l-[3px] sig-transition hover:bg-base-elevated',
        config.border,
      )}
    >
      <div className="mt-0.5 shrink-0">
        <Icon size={15} className="text-content-muted" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant={config.badge} size="sm">
            {config.badgeLabel}
          </Badge>
          {signal.sector && (
            <span className="text-11 text-content-muted">{signal.sector}</span>
          )}
          <span className="text-11 text-content-muted font-mono ml-auto shrink-0">
            {timeAgo(signal.timestamp)}
          </span>
        </div>

        <h4 className="text-13 font-semibold text-content-primary leading-snug">
          {signal.title}
        </h4>

        {signal.description && (
          <p className="text-12 text-content-secondary leading-relaxed mt-1 line-clamp-2">
            {signal.description}
          </p>
        )}

        {signal.companies && signal.companies.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {signal.companies.map(c => (
              <Link
                key={c}
                href={`/company/${encodeURIComponent(c)}`}
                className="text-11 font-medium text-signal-400 hover:text-signal-300 sig-transition"
              >
                {c}
              </Link>
            ))}
          </div>
        )}

        {signal.url && (
          <a
            href={signal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-11 text-content-muted hover:text-content-primary sig-transition"
          >
            Source <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  )
})

export default SignalCard
