import clsx from 'clsx'
import { Lightbulb, ChevronRight } from 'lucide-react'
import Badge from '../primitives/Badge'
import Card from '../primitives/Card'
import Separator from '../primitives/Separator'
import Skeleton from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'

function convictionVariant(conviction) {
  const c = String(conviction || '').toUpperCase()
  if (c === 'BULLISH') return 'signal'
  if (c === 'BEARISH') return 'live'
  return 'draft'
}

function ThesisRow({ thesis }) {
  return (
    <div className="group flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-base-elevated sig-transition cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant={convictionVariant(thesis.conviction)} size="sm">
            {thesis.conviction}
          </Badge>
          {thesis.sector && (
            <span className="text-11 text-content-muted truncate">
              {thesis.sector}
            </span>
          )}
        </div>
        <h4 className="text-13 font-medium text-content-primary leading-snug line-clamp-2">
          {thesis.title}
        </h4>
        {thesis.catalyst && (
          <p className="text-11 text-content-muted mt-1 line-clamp-1">
            Catalyst: {thesis.catalyst}
          </p>
        )}
      </div>
      <ChevronRight
        size={14}
        className="text-content-muted opacity-0 group-hover:opacity-100 sig-transition mt-1 shrink-0"
      />
    </div>
  )
}

export default function ResearchQueue({ theses, loading }) {
  return (
    <Card variant="surface" padding="none" className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className="text-draft" />
          <span className="text-13 font-semibold text-content-primary">
            Research Queue
          </span>
        </div>
        <span className="text-11 text-content-muted font-mono">
          {theses?.length || 0}
        </span>
      </div>

      <Separator />

      {/* Thesis list */}
      <div className="p-1.5">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton width="60px" height="18px" rounded="sm" />
                <Skeleton height="14px" rounded="sm" />
                <Skeleton width="80%" height="12px" rounded="sm" />
              </div>
            ))}
          </div>
        ) : !theses || theses.length === 0 ? (
          <EmptyState
            title="No active theses"
            description="Generate theses from your feed to track research."
            className="py-8"
          />
        ) : (
          theses.map(thesis => (
            <ThesisRow key={thesis.id} thesis={thesis} />
          ))
        )}
      </div>
    </Card>
  )
}
