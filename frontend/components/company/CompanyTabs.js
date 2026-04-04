import clsx from 'clsx'

const TABS = [
  { key: 'developments', label: 'Live Developments' },
  { key: 'research', label: 'Research & Theses' },
  { key: 'memos', label: 'Deal Memos' },
  { key: 'metadata', label: 'Metadata' },
]

export default function CompanyTabs({ active, onChange }) {
  return (
    <div className="flex items-center gap-1 px-6 h-10 border-b border-border-subtle" role="tablist">
      {TABS.map(tab => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={clsx(
            'relative px-3 h-10 text-13 font-medium sig-transition',
            active === tab.key
              ? 'text-content-primary'
              : 'text-content-muted hover:text-content-secondary'
          )}
        >
          {tab.label}
          {active === tab.key && (
            <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-signal-500 rounded-full" />
          )}
        </button>
      ))}
    </div>
  )
}
