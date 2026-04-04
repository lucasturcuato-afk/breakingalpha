import { useRouter } from 'next/router'
import clsx from 'clsx'
import {
  LayoutDashboard,
  Rss,
  Lightbulb,
  FileText,
  Eye,
  Activity,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useShell } from './ShellContext'
import Tooltip, { TooltipProvider } from '../primitives/Tooltip'
import Separator from '../primitives/Separator'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { id: 'feed', label: 'Feed', icon: Rss, href: '/feed' },
  { id: 'thesis', label: 'Thesis', icon: Lightbulb, href: '/thesis' },
  { id: 'memo', label: 'Memo', icon: FileText, href: '/memo' },
  { id: 'watchlist', label: 'Watchlist', icon: Eye, href: '/watchlist' },
  { id: 'signals', label: 'Signals', icon: Activity, href: '/signals' },
]

const BOTTOM_ITEMS = [
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
]

function NavItem({ item, active, collapsed }) {
  const router = useRouter()
  const Icon = item.icon

  const button = (
    <button
      onClick={() => router.push(item.href)}
      className={clsx(
        'group relative flex items-center gap-3 w-full rounded-md sig-transition',
        collapsed ? 'justify-center h-9 w-9 mx-auto' : 'h-9 px-3',
        active
          ? 'bg-signal-muted text-signal-400'
          : 'text-content-secondary hover:text-content-primary hover:bg-base-elevated'
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-signal-500 rounded-r" />
      )}
      <Icon size={16} strokeWidth={active ? 2 : 1.5} />
      {!collapsed && (
        <span className="text-13 font-medium truncate">{item.label}</span>
      )}
    </button>
  )

  if (collapsed) {
    return (
      <Tooltip content={item.label} side="right">
        {button}
      </Tooltip>
    )
  }

  return button
}

export default function NavRail() {
  const { navCollapsed, toggleNav } = useShell()
  const router = useRouter()

  const isActive = (href) => {
    if (href === '/dashboard') return router.pathname === '/dashboard' || router.pathname === '/'
    return router.pathname.startsWith(href)
  }

  return (
    <TooltipProvider>
      <nav
        className={clsx(
          'flex flex-col h-screen bg-base border-r border-border-subtle',
          'sig-transition shrink-0',
          navCollapsed ? 'w-[52px]' : 'w-[220px]'
        )}
      >
        {/* Wordmark */}
        <div
          className={clsx(
            'flex items-center h-12 shrink-0',
            navCollapsed ? 'justify-center px-0' : 'px-4'
          )}
        >
          {navCollapsed ? (
            <span className="text-16 font-bold text-signal-500">S</span>
          ) : (
            <span className="text-14 font-semibold text-content-primary tracking-tight">
              Signalera
            </span>
          )}
        </div>

        <Separator />

        {/* Main nav */}
        <div className={clsx('flex-1 flex flex-col gap-0.5 py-2', navCollapsed ? 'px-1.5' : 'px-2')}>
          {NAV_ITEMS.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={isActive(item.href)}
              collapsed={navCollapsed}
            />
          ))}
        </div>

        {/* Bottom section */}
        <div className={clsx('flex flex-col gap-0.5 py-2', navCollapsed ? 'px-1.5' : 'px-2')}>
          <Separator className="mb-2" />
          {BOTTOM_ITEMS.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={isActive(item.href)}
              collapsed={navCollapsed}
            />
          ))}

          {/* Collapse toggle */}
          <button
            onClick={toggleNav}
            aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx(
              'flex items-center gap-3 rounded-md sig-transition',
              'text-content-muted hover:text-content-secondary hover:bg-base-elevated',
              navCollapsed ? 'justify-center h-9 w-9 mx-auto' : 'h-9 px-3 w-full'
            )}
          >
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!navCollapsed && <span className="text-12">Collapse</span>}
          </button>
        </div>
      </nav>
    </TooltipProvider>
  )
}
