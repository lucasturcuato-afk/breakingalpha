import clsx from 'clsx'
import { TrendingUp, TrendingDown, Zap, Lightbulb } from 'lucide-react'

export default function SignalsSummary({ signals }) {
  let bullish = 0
  let bearish = 0
  let breaking = 0
  let thesis = 0

  signals.forEach(s => {
    if (s.type === 'sentiment_positive') bullish++
    else if (s.type === 'sentiment_negative') bearish++
    else if (s.type === 'breaking' || s.type === 'volume') breaking++
    else if (s.type === 'thesis') thesis++
  })

  const stats = [
    { label: 'Bullish', value: bullish, icon: TrendingUp, color: 'text-signal-400' },
    { label: 'Bearish', value: bearish, icon: TrendingDown, color: 'text-live' },
    { label: 'Breaking', value: breaking, icon: Zap, color: 'text-draft' },
    { label: 'Thesis', value: thesis, icon: Lightbulb, color: 'text-ai' },
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
