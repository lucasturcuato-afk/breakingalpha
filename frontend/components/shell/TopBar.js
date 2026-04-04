import clsx from 'clsx'
import { Search, Bell, Sparkles } from 'lucide-react'
import { useShell } from './ShellContext'
import Separator from '../primitives/Separator'
import { ProfileMenu } from '../auth'

export default function TopBar({ breadcrumb = 'Dashboard' }) {
  const { setCommandOpen, copilotOpen, toggleCopilot } = useShell()

  return (
    <header className="flex items-center h-12 px-4 bg-base border-b border-border-subtle shrink-0">
      {/* Left — breadcrumb */}
      <div className="flex-1 min-w-0">
        <span className="text-13 font-medium text-content-primary truncate">
          {breadcrumb}
        </span>
      </div>

      {/* Center — command trigger */}
      <button
        onClick={() => setCommandOpen(true)}
        aria-label="Open command palette"
        className={clsx(
          'flex items-center gap-2 h-7 px-3 rounded-md',
          'bg-base-elevated border border-border-subtle',
          'text-12 text-content-muted',
          'hover:border-border hover:text-content-secondary',
          'sig-transition'
        )}
      >
        <Search size={13} />
        <span>Search</span>
        <kbd className="ml-2 text-11 text-content-muted font-mono">
          ⌘K
        </kbd>
      </button>

      {/* Right — actions */}
      <div className="flex-1 flex items-center justify-end gap-1">
        {/* Copilot toggle */}
        <button
          onClick={toggleCopilot}
          className={clsx(
            'flex items-center justify-center h-8 w-8 rounded-md sig-transition',
            copilotOpen
              ? 'bg-ai-muted text-ai'
              : 'text-content-muted hover:text-content-secondary hover:bg-base-elevated'
          )}
          aria-label="Toggle copilot"
        >
          <Sparkles size={15} />
        </button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Notifications */}
        <button
          className="flex items-center justify-center h-8 w-8 rounded-md text-content-muted hover:text-content-secondary hover:bg-base-elevated sig-transition"
          aria-label="Notifications"
        >
          <Bell size={15} />
        </button>

        {/* Profile */}
        <div className="ml-1">
          <ProfileMenu />
        </div>
      </div>
    </header>
  )
}
