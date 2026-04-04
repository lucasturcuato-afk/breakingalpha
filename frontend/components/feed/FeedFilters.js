import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { Search, SlidersHorizontal, ArrowUpDown, X } from 'lucide-react'

const SECTORS = [
  { key: 'all', label: 'All' },
  { key: 'tech', label: 'Tech M&A' },
  { key: 'vc', label: 'Venture' },
  { key: 'pe', label: 'Private Eq' },
  { key: 'pub', label: 'Public Mkt' },
  { key: 'geo', label: 'Geo & Macro' },
  { key: 'fin', label: 'Fintech' },
  { key: 'health', label: 'Healthcare' },
  { key: 'energy', label: 'Energy' },
  { key: 'cons', label: 'Consumer' },
]

const SENTIMENTS = [
  { key: 'all', label: 'All' },
  { key: 'positive', label: 'Positive' },
  { key: 'negative', label: 'Negative' },
  { key: 'neutral', label: 'Neutral' },
]

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
]

const STATES = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'saved', label: 'Saved' },
  { key: 'in-thesis', label: 'In thesis' },
]

export default function FeedFilters({
  sector,
  onSectorChange,
  sentiment,
  onSentimentChange,
  sort,
  onSortChange,
  stateFilter,
  onStateChange,
  search,
  onSearchChange,
  totalCount,
  filteredCount,
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (searchOpen && inputRef.current) inputRef.current.focus()
  }, [searchOpen])

  const hasActiveFilters = sector !== 'all' || sentiment !== 'all' || stateFilter !== 'all' || search

  return (
    <div className="sticky top-0 z-20 bg-base border-b border-border-subtle">
      {/* Top row: search + sort */}
      <div className="flex items-center gap-2 px-4 h-11">
        {searchOpen ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Search size={14} className="text-content-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Search articles..."
              aria-label="Search articles"
              className="flex-1 bg-transparent text-13 text-content-primary placeholder:text-content-muted outline-none"
            />
            <button
              onClick={() => { setSearchOpen(false); onSearchChange('') }}
              aria-label="Close search"
              className="text-content-muted hover:text-content-secondary sig-transition"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 h-7 px-2.5 rounded-md text-12 text-content-muted hover:text-content-secondary hover:bg-base-elevated sig-transition"
            >
              <Search size={13} />
              <span>Search</span>
              <kbd className="text-11 font-mono text-content-muted">/</kbd>
            </button>

            <div className="flex-1" />

            {/* State filter pills */}
            <div className="flex items-center gap-1">
              {STATES.map(s => (
                <button
                  key={s.key}
                  onClick={() => onStateChange(s.key)}
                  className={clsx(
                    'px-2 h-6 rounded text-11 font-medium sig-transition',
                    stateFilter === s.key
                      ? 'bg-base-elevated text-content-primary'
                      : 'text-content-muted hover:text-content-secondary'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Sort */}
            <button
              onClick={() => onSortChange(sort === 'newest' ? 'oldest' : 'newest')}
              aria-label={`Sort: ${sort === 'newest' ? 'newest first' : 'oldest first'}`}
              className="flex items-center gap-1.5 h-7 px-2 rounded-md text-11 text-content-muted hover:text-content-secondary hover:bg-base-elevated sig-transition"
            >
              <ArrowUpDown size={12} />
              <span className="font-mono">{sort === 'newest' ? 'NEW' : 'OLD'}</span>
            </button>

            {/* Count */}
            <span className="text-11 text-content-muted font-mono ml-1">
              {filteredCount !== totalCount
                ? `${filteredCount}/${totalCount}`
                : totalCount}
            </span>
          </>
        )}
      </div>

      {/* Sector filter row */}
      <div className="flex items-center gap-1 px-4 h-9 overflow-x-auto border-t border-border-subtle" role="toolbar" aria-label="Feed filters">
        {SECTORS.map(s => (
          <button
            key={s.key}
            onClick={() => onSectorChange(s.key)}
            className={clsx(
              'px-2.5 h-6 rounded text-11 font-medium whitespace-nowrap sig-transition',
              sector === s.key
                ? 'bg-signal-muted text-signal-400'
                : 'text-content-muted hover:text-content-secondary hover:bg-base-elevated'
            )}
          >
            {s.label}
          </button>
        ))}

        <div className="w-px h-4 bg-border-subtle mx-1 shrink-0" />

        {/* Sentiment filters */}
        {SENTIMENTS.map(s => (
          <button
            key={s.key}
            onClick={() => onSentimentChange(s.key)}
            className={clsx(
              'px-2 h-6 rounded text-11 font-medium whitespace-nowrap sig-transition',
              sentiment === s.key
                ? 'bg-base-elevated text-content-primary'
                : 'text-content-muted hover:text-content-secondary'
            )}
          >
            {s.label}
          </button>
        ))}

        {/* Clear all */}
        {hasActiveFilters && (
          <>
            <div className="w-px h-4 bg-border-subtle mx-1 shrink-0" />
            <button
              onClick={() => {
                onSectorChange('all')
                onSentimentChange('all')
                onStateChange('all')
                onSearchChange('')
              }}
              className="flex items-center gap-1 px-2 h-6 rounded text-11 text-live hover:bg-live/10 sig-transition"
            >
              <X size={11} />
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  )
}
