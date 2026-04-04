import clsx from 'clsx'

const TYPES = [
  { key: 'all', label: 'All Signals' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'volume', label: 'Volume Spike' },
  { key: 'breaking', label: 'Breaking' },
  { key: 'thesis', label: 'Thesis Alert' },
]

export default function SignalFilters({ active, onChange }) {
  return (
    <div className="flex items-center gap-1 px-6 py-2 border-b border-border-subtle overflow-x-auto" role="tablist" aria-label="Signal type filters">
      {TYPES.map(t => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'px-2.5 h-7 rounded-md text-12 font-medium whitespace-nowrap sig-transition',
            active === t.key
              ? 'bg-signal-muted text-signal-400'
              : 'text-content-muted hover:text-content-secondary hover:bg-base-elevated'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
