import clsx from 'clsx'
import { Zap } from 'lucide-react'
import Badge from '../primitives/Badge'
import EmptyState from '../primitives/EmptyState'
import { SkeletonRow } from '../primitives/Skeleton'

function convictionVariant(conviction) {
  const c = String(conviction || '').toUpperCase()
  if (c === 'BULLISH') return 'signal'
  if (c === 'BEARISH') return 'live'
  return 'draft'
}

export default function CompanyResearch({ theses, loading }) {
  if (loading) {
    return (
      <div className="p-4 space-y-1">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (!theses || theses.length === 0) {
    return (
      <EmptyState
        title="No related theses"
        description="No investment theses reference this company yet."
      />
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      {theses.map(thesis => (
        <div key={thesis.id} className="px-6 py-3">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={convictionVariant(thesis.conviction)} size="sm">
              {thesis.conviction}
            </Badge>
            {thesis.sector && (
              <span className="text-11 text-content-muted">{thesis.sector}</span>
            )}
          </div>
          <h4 className="text-13 font-semibold text-content-primary leading-snug">
            {thesis.title}
          </h4>
          {thesis.catalyst && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Zap size={11} className="text-draft shrink-0" />
              <span className="text-11 text-content-muted">{thesis.catalyst}</span>
            </div>
          )}
          {thesis.rationale && (
            <p className="text-12 text-content-secondary leading-relaxed mt-2 line-clamp-3">
              {thesis.rationale}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
