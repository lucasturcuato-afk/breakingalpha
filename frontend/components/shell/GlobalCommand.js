import { useCallback } from 'react'
import { useRouter } from 'next/router'
import { Command } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import {
  LayoutDashboard,
  Rss,
  Lightbulb,
  FileText,
  Eye,
  Activity,
  Settings,
  Search,
  Plus,
  Sparkles,
  Bookmark,
} from 'lucide-react'
import { useShell } from './ShellContext'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { id: 'feed', label: 'Live Feed', icon: Rss, href: '/feed' },
  { id: 'thesis', label: 'Thesis Board', icon: Lightbulb, href: '/thesis' },
  { id: 'memo', label: 'Deal Memos', icon: FileText, href: '/memo' },
  { id: 'watchlist', label: 'Watchlist', icon: Eye, href: '/watchlist' },
  { id: 'signals', label: 'Signals', icon: Activity, href: '/signals' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
]

const ACTIONS = [
  { id: 'new-thesis', label: 'New Thesis', icon: Plus, action: 'new-thesis' },
  { id: 'generate-memo', label: 'Generate Memo', icon: FileText, action: 'generate-memo' },
  { id: 'ask-copilot', label: 'Ask Copilot', icon: Sparkles, action: 'ask-copilot' },
  { id: 'save-watchlist', label: 'Save to Watchlist', icon: Bookmark, action: 'save-watchlist' },
]

export default function GlobalCommand() {
  const { commandOpen, setCommandOpen } = useShell()
  const router = useRouter()

  const handleSelect = useCallback((value) => {
    setCommandOpen(false)

    const page = PAGES.find(p => p.id === value)
    if (page) {
      router.push(page.href)
      return
    }

    // Action handlers will be wired in later phases
  }, [router, setCommandOpen])

  return (
    <Dialog.Root open={commandOpen} onOpenChange={setCommandOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className={clsx(
            'fixed top-[20%] left-1/2 -translate-x-1/2 z-50',
            'w-full max-w-[520px]',
            'rounded-xl border border-border',
            'bg-base-surface shadow-overlay',
            'overflow-hidden',
          )}
        >
          <Command
            className="flex flex-col"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCommandOpen(false)
            }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 h-12 border-b border-border-subtle">
              <Search size={15} className="text-content-muted shrink-0" />
              <Command.Input
                placeholder="Search pages, actions, companies..."
                aria-label="Command palette search"
                className="flex-1 bg-transparent text-14 text-content-primary placeholder:text-content-muted outline-none"
                autoFocus
              />
              <kbd className="text-11 text-content-muted font-mono px-1.5 py-0.5 rounded bg-base-elevated border border-border-subtle">
                esc
              </kbd>
            </div>

            {/* Results */}
            <Command.List className="max-h-[320px] overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center text-13 text-content-muted">
                No results found.
              </Command.Empty>

              {/* Pages */}
              <Command.Group
                heading="Pages"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-11 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-content-muted [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
              >
                {PAGES.map(page => (
                  <Command.Item
                    key={page.id}
                    value={page.id}
                    onSelect={handleSelect}
                    className={clsx(
                      'flex items-center gap-3 h-9 px-2 rounded-md text-13 cursor-pointer',
                      'text-content-secondary',
                      'data-[selected=true]:bg-base-elevated data-[selected=true]:text-content-primary',
                      'sig-transition'
                    )}
                  >
                    <page.icon size={15} strokeWidth={1.5} />
                    <span>{page.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              {/* Quick actions */}
              <Command.Group
                heading="Quick Actions"
                className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-11 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-content-muted [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
              >
                {ACTIONS.map(action => (
                  <Command.Item
                    key={action.id}
                    value={action.id}
                    onSelect={handleSelect}
                    className={clsx(
                      'flex items-center gap-3 h-9 px-2 rounded-md text-13 cursor-pointer',
                      'text-content-secondary',
                      'data-[selected=true]:bg-base-elevated data-[selected=true]:text-content-primary',
                      'sig-transition'
                    )}
                  >
                    <action.icon size={15} strokeWidth={1.5} />
                    <span>{action.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>

            {/* Footer */}
            <div className="flex items-center gap-4 px-4 h-9 border-t border-border-subtle text-11 text-content-muted">
              <span className="flex items-center gap-1">
                <kbd className="font-mono">↑↓</kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="font-mono">↵</kbd> select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="font-mono">esc</kbd> close
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
