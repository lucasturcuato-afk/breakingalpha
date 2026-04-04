import clsx from 'clsx'
import { TrendingUp, TrendingDown, Minus, Eye } from 'lucide-react'

export default function WatchlistSummary({ entries, quotes }) {
  const tickerEntries = entries.filter(e => e.type === 'ticker')
  const companyEntries = entries.filter(e => e.type === 'company')

  let gainers = 0
  let losers = 0
  let flat = 0

  tickerEntries.forEach(e => {
    const q = quotes[e.identifier]
    if (!q) return
    if (q.pct > 0) gainers++
    else if (q.pct < 0) losers++
    else flat++
  })

  const stats = [
    { label: 'Watching', value: entries.length, icon: Eye, color: 'text-content-primary' },
    { label: 'Gainers', value: gainers, icon: TrendingUp, color: 'text-signal-400' },
    { label: 'Losers', value: losers, icon: TrendingDown, color: 'text-live' },
    { label: 'Flat', value: flat, icon: Minus, color: 'text-content-muted' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-border-subtle">
      {stats.map(s => (
        <div key={s.label} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-base-elevated border border-border-subtle">
          <s.icon size={14} className={s.color} />
          <div>
            <div className={clsx('text-16 font-semibold font-mono tabular-nums', s.color)}>
              {s.value}
            </div>
            <div className="text-11 text-content-muted">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
