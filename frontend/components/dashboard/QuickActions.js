import clsx from 'clsx'
import { Plus, FileText, Sparkles, Bookmark } from 'lucide-react'
import { useShell } from '../shell/ShellContext'

const actions = [
  { id: 'new-thesis', label: 'New Thesis', icon: Plus, shortcut: 'T' },
  { id: 'generate-memo', label: 'Generate Memo', icon: FileText, shortcut: 'M' },
  { id: 'ask-copilot', label: 'Ask Copilot', icon: Sparkles, shortcut: '/' },
  { id: 'save-watchlist', label: 'Save to Watchlist', icon: Bookmark, shortcut: 'W' },
]

export default function QuickActions() {
  const { setCopilotOpen } = useShell()

  function handleAction(id) {
    switch (id) {
      case 'ask-copilot':
        setCopilotOpen(true)
        break
      default:
        // Other actions will be wired in later phases
        break
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map(action => {
        const Icon = action.icon
        return (
          <button
            key={action.id}
            onClick={() => handleAction(action.id)}
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2.5 rounded-lg',
              'bg-base-surface border border-border-subtle',
              'text-13 text-content-secondary',
              'hover:bg-base-elevated hover:border-border hover:text-content-primary',
              'sig-transition',
            )}
          >
            <Icon size={14} className="shrink-0" />
            <span className="flex-1 text-left font-medium">{action.label}</span>
            <kbd className="text-11 text-content-muted font-mono">
              {action.shortcut}
            </kbd>
          </button>
        )
      })}
    </div>
  )
}
