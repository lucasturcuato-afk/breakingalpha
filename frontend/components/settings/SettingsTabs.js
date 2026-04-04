import clsx from 'clsx'

const TABS = [
  { key: 'preferences', label: 'Brief Preferences' },
  { key: 'account', label: 'Account' },
]

export default function SettingsTabs({ active, onChange }) {
  return (
    <div className="flex items-center gap-1 px-6 border-b border-border-subtle" role="tablist">
      {TABS.map(t => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'px-3 py-3 text-12 font-medium sig-transition relative',
            active === t.key
              ? 'text-content-primary'
              : 'text-content-muted hover:text-content-secondary'
          )}
        >
          {t.label}
          {active === t.key && (
            <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-signal-500 rounded-full" />
          )}
        </button>
      ))}
    </div>
  )
}
