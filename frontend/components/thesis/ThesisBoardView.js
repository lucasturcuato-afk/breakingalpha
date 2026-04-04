import clsx from 'clsx'
import ThesisCard from './ThesisCard'
import EmptyState from '../primitives/EmptyState'
import ScrollArea from '../primitives/ScrollArea'

const COLUMNS = [
  { key: 'new-signal', label: 'New Signal', color: 'bg-signal-500' },
  { key: 'exploring', label: 'Exploring', color: 'bg-draft' },
  { key: 'draft-thesis', label: 'Draft Thesis', color: 'bg-ai' },
  { key: 'needs-evidence', label: 'Needs Evidence', color: 'bg-live' },
  { key: 'ready-for-memo', label: 'Ready for Memo', color: 'bg-signal-600' },
  { key: 'archived', label: 'Archived', color: 'bg-meta' },
]

export default function ThesisBoardView({ theses, statusMap, onStatusChange, onRegenerate }) {
  function getThesesForColumn(columnKey) {
    return theses.filter(t => (statusMap[t.id] || 'new-signal') === columnKey)
  }

  return (
    <div className="flex gap-3 h-full overflow-x-auto p-4">
      {COLUMNS.map(col => {
        const items = getThesesForColumn(col.key)
        return (
          <div
            key={col.key}
            className="flex flex-col w-[280px] shrink-0 rounded-lg bg-base-surface border border-border-subtle"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border-subtle">
              <div className={clsx('w-2 h-2 rounded-full', col.color)} />
              <span className="text-12 font-semibold text-content-primary">
                {col.label}
              </span>
              <span className="text-11 text-content-muted font-mono ml-auto">
                {items.length}
              </span>
            </div>

            {/* Cards */}
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {items.length === 0 ? (
                  <div className="py-8 text-center text-11 text-content-muted">
                    No theses
                  </div>
                ) : (
                  items.map(thesis => (
                    <ThesisCard
                      key={thesis.id}
                      thesis={thesis}
                      status={statusMap[thesis.id] || 'new-signal'}
                      onStatusChange={onStatusChange}
                      onRegenerate={onRegenerate}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )
      })}
    </div>
  )
}
