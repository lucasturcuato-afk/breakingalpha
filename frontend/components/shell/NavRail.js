import { useState } from 'react'
import clsx from 'clsx'
import {
  Sun,
  Activity,
  Moon,
  Briefcase,
  Lightbulb,
  LayoutGrid,
  TrendingUp,
  Bookmark,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

const NAV_ITEMS = [
  { id: 'morning',     label: 'Morning Review', icon: Sun },
  { id: 'live',        label: 'Live Tracker',   icon: Activity },
  { id: 'evening',     label: 'Evening Wrap',   icon: Moon },
  { id: 'dealflow',    label: 'Deal Flow',      icon: Briefcase },
  { id: 'thesis',      label: 'Thesis Board',   icon: Lightbulb },
  { id: 'companies',   label: 'Company Intel',  icon: LayoutGrid },
  { id: 'trends',      label: 'Trends',         icon: TrendingUp },
]

const BOTTOM_ITEMS = [
  { id: 'watchlist',   label: 'Watchlist',      icon: Bookmark },
  { id: 'preferences', label: 'Preferences',    icon: SlidersHorizontal },
]

function NavItem({ item, active, collapsed, onClick }) {
  const Icon = item.icon
  const isLive = item.id === 'live'

  return (
    <button
      onClick={() => onClick(item.id)}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'group relative flex items-center w-full rounded-md sig-transition',
        collapsed ? 'justify-center h-9 w-9 mx-auto' : 'h-9 px-3 gap-3',
        active
          ? 'bg-signal-muted text-signal-400'
          : 'text-content-secondary hover:text-content-primary hover:bg-base-elevated'
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-signal-500 rounded-r" />
      )}
      <Icon size={16} strokeWidth={active ? 2 : 1.5} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="text-13 font-medium truncate">{item.label}</span>
          {isLive && (
            <span className="ml-auto w-[5px] h-[5px] rounded-full bg-signal-500 animate-pulse shrink-0" />
          )}
        </>
      )}
    </button>
  )
}

function WatchlistMini({ watchlist, watchlistPrices, collapsed }) {
  if (collapsed || !watchlist?.length) return null
  const tickers = watchlist.filter(e => e.type === 'ticker').slice(0, 6)
  if (!tickers.length) return null

  return (
    <div className="px-4 py-3 border-t border-border-subtle">
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-[3px] h-[10px] bg-signal-500 rounded-sm" />
        <span className="text-11 font-mono text-signal-400 tracking-wider">WATCHLIST</span>
      </div>
      {tickers.map(entry => {
        const q = watchlistPrices?.[entry.identifier]
        const up = q && q.pct >= 0
        return (
          <div key={entry.id || entry.identifier} className="flex items-center justify-between py-0.5">
            <span className="text-11 font-mono text-content-primary font-medium">{entry.identifier}</span>
            {q ? (
              <span className={clsx('text-11 font-mono tabular-nums', up ? 'text-signal-500' : 'text-live')}>
                {up ? '+' : ''}{q.pct}%
              </span>
            ) : (
              <span className="text-11 font-mono text-content-muted">&mdash;</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MarketTime({ marketTime, marketOpen, collapsed }) {
  if (collapsed) return null

  return (
    <div className="px-4 py-3 border-t border-border-subtle">
      <span className="text-11 font-mono text-content-muted tracking-wider block mb-1">MARKET TIME</span>
      <span className="text-11 font-mono text-content-secondary leading-relaxed block">
        {marketTime || '\u2014'}
      </span>
      {marketOpen !== null && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className={clsx(
            'w-1.5 h-1.5 rounded-full animate-pulse shrink-0',
            marketOpen ? 'bg-signal-500' : 'bg-live'
          )} />
          <span className={clsx(
            'text-11 font-mono tracking-wider',
            marketOpen ? 'text-signal-500' : 'text-live'
          )}>
            US EQUITIES {marketOpen ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
      )}
    </div>
  )
}

export default function NavRail({
  activeTab,
  onTabChange,
  watchlist,
  watchlistPrices,
  watchlistBadge,
  marketTime,
  marketOpen,
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <nav
      className={clsx(
        'flex flex-col h-full bg-base border-r border-border-subtle',
        'sig-transition shrink-0 relative overflow-y-auto overflow-x-hidden',
        collapsed ? 'w-[52px]' : 'w-[240px]'
      )}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={clsx(
          'absolute top-1/2 -translate-y-1/2 -right-3 z-10',
          'w-6 h-6 rounded-full',
          'bg-base border border-border-subtle',
          'flex items-center justify-center',
          'text-content-muted hover:text-content-secondary',
          'shadow-surface cursor-pointer sig-transition'
        )}
      >
        {collapsed ? <PanelLeftOpen size={10} /> : <PanelLeftClose size={10} />}
      </button>

      {/* Wordmark */}
      <div className={clsx(
        'flex items-center shrink-0 h-12 border-b border-border-subtle overflow-hidden whitespace-nowrap',
        collapsed ? 'justify-center px-0' : 'px-5'
      )}>
        {collapsed ? (
          <span className="text-16 font-bold text-signal-500">S</span>
        ) : (
          <div>
            <span className="text-16 font-semibold text-content-primary tracking-tight">
              Signalera
            </span>
            <span className="block text-11 font-mono text-content-muted tracking-widest mt-0.5">
              MARKET INTELLIGENCE
            </span>
          </div>
        )}
      </div>

      {/* Main nav */}
      <div className={clsx('flex-1 flex flex-col gap-0.5 py-2', collapsed ? 'px-1.5' : 'px-2')}>
        {NAV_ITEMS.map(item => (
          <NavItem
            key={item.id}
            item={item}
            active={activeTab === item.id}
            collapsed={collapsed}
            onClick={onTabChange}
          />
        ))}
        {!collapsed && (
          <div className="flex items-center ml-auto mt-1 px-1">
            {/* AuthButton slot — rendered by parent */}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className={clsx('flex flex-col gap-0.5 py-2', collapsed ? 'px-1.5' : 'px-2')}>
        <div className="h-px bg-border-subtle mx-1 mb-2" />
        {BOTTOM_ITEMS.map(item => (
          <div key={item.id} className="relative">
            <NavItem
              item={item}
              active={activeTab === item.id}
              collapsed={collapsed}
              onClick={onTabChange}
            />
            {!collapsed && item.id === 'watchlist' && watchlistBadge > 0 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-draft text-base text-11 font-mono font-bold px-1.5 py-px rounded-full">
                {watchlistBadge}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Watchlist mini */}
      <WatchlistMini
        watchlist={watchlist}
        watchlistPrices={watchlistPrices}
        collapsed={collapsed}
      />

      {/* Market time */}
      <MarketTime
        marketTime={marketTime}
        marketOpen={marketOpen}
        collapsed={collapsed}
      />
    </nav>
  )
}
