import clsx from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import Card from '../primitives/Card'
import Separator from '../primitives/Separator'
import Skeleton from '../primitives/Skeleton'

const INDICES = [
  { symbol: 'SPX', name: 'S&P 500' },
  { symbol: 'NDX', name: 'Nasdaq 100' },
  { symbol: 'DJI', name: 'Dow Jones' },
  { symbol: 'VIX', name: 'VIX' },
  { symbol: 'TNX', name: '10Y Yield' },
  { symbol: 'DXY', name: 'Dollar Index' },
]

function formatPrice(val) {
  if (!val && val !== 0) return '—'
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatChange(val) {
  if (!val && val !== 0) return '—'
  const num = Number(val)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

function TickerRow({ index, quote }) {
  const change = quote?.change_pct || quote?.changePercent || 0
  const price = quote?.price || quote?.latestPrice
  const isUp = change > 0
  const isDown = change < 0

  return (
    <div className="flex items-center justify-between py-2 px-3">
      <div className="flex flex-col">
        <span className="text-12 font-semibold text-content-primary">
          {index.symbol}
        </span>
        <span className="text-11 text-content-muted">{index.name}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-13 font-mono tabular-nums text-content-primary">
          {formatPrice(price)}
        </span>
        <span
          className={clsx(
            'flex items-center gap-1 text-12 font-mono tabular-nums font-medium min-w-[65px] justify-end',
            isUp && 'text-signal-400',
            isDown && 'text-live',
            !isUp && !isDown && 'text-content-muted'
          )}
        >
          {isUp && <TrendingUp size={12} />}
          {isDown && <TrendingDown size={12} />}
          {!isUp && !isDown && <Minus size={12} />}
          {formatChange(change)}
        </span>
      </div>
    </div>
  )
}

export default function MarketSnapshot({ quotes, loading }) {
  const quoteMap = {}
  if (Array.isArray(quotes)) {
    quotes.forEach(q => {
      if (q?.symbol) quoteMap[q.symbol] = q
    })
  }

  return (
    <Card variant="surface" padding="none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-13 font-semibold text-content-primary">
          Market Snapshot
        </span>
        <span className="text-11 text-content-muted font-mono">
          {new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      <Separator />

      {/* Ticker rows */}
      <div className="divide-y divide-border-subtle">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 px-3">
              <div className="space-y-1">
                <Skeleton width="40px" height="14px" rounded="sm" />
                <Skeleton width="70px" height="11px" rounded="sm" />
              </div>
              <div className="flex gap-3">
                <Skeleton width="60px" height="14px" rounded="sm" />
                <Skeleton width="55px" height="14px" rounded="sm" />
              </div>
            </div>
          ))
        ) : (
          INDICES.map(index => (
            <TickerRow
              key={index.symbol}
              index={index}
              quote={quoteMap[index.symbol]}
            />
          ))
        )}
      </div>
    </Card>
  )
}
