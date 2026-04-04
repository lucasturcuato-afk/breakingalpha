import clsx from 'clsx'
import { Building2, Plus, Check } from 'lucide-react'
import Badge from '../primitives/Badge'
import Separator from '../primitives/Separator'

export default function CompanyHeader({
  name,
  sector,
  mentionCount,
  isWatchlisted,
  onToggleWatchlist,
}) {
  return (
    <div className="px-6 py-5 border-b border-border-subtle">
      <div className="flex items-center gap-4">
        {/* Icon */}
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-base-elevated border border-border-subtle">
          <Building2 size={18} className="text-content-muted" />
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-18 font-bold text-content-primary truncate">
              {name}
            </h1>
            {sector && (
              <Badge variant="default" size="md">{sector}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-12 text-content-muted">
              <span className="font-mono tabular-nums">{mentionCount}</span> mentions in feed
            </span>
          </div>
        </div>

        {/* Actions */}
        <button
          onClick={onToggleWatchlist}
          className={clsx(
            'flex items-center gap-2 h-8 px-3 rounded-md text-12 font-medium sig-transition',
            isWatchlisted
              ? 'bg-signal-muted text-signal-400 border border-signal-500/20'
              : 'bg-base-elevated text-content-secondary border border-border-subtle hover:border-border hover:text-content-primary'
          )}
        >
          {isWatchlisted ? <Check size={13} /> : <Plus size={13} />}
          {isWatchlisted ? 'Watchlisted' : 'Add to Watchlist'}
        </button>
      </div>
    </div>
  )
}
