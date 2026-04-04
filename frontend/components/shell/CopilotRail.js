import clsx from 'clsx'
import { X, Sparkles } from 'lucide-react'
import { useShell } from './ShellContext'
import Separator from '../primitives/Separator'

export default function CopilotRail() {
  const { copilotOpen, setCopilotOpen } = useShell()

  if (!copilotOpen) return null

  return (
    <aside
      className={clsx(
        'flex flex-col h-screen w-[320px] shrink-0',
        'bg-base border-l border-border-subtle',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-ai" />
          <span className="text-13 font-semibold text-content-primary">
            Copilot
          </span>
        </div>
        <button
          onClick={() => setCopilotOpen(false)}
          className="flex items-center justify-center h-7 w-7 rounded-md text-content-muted hover:text-content-secondary hover:bg-base-elevated sig-transition"
          aria-label="Close copilot"
        >
          <X size={14} />
        </button>
      </div>

      <Separator />

      {/* Context area */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-ai-muted mb-3">
            <Sparkles size={18} className="text-ai" />
          </div>
          <p className="text-13 font-medium text-content-primary mb-1">
            Context-aware copilot
          </p>
          <p className="text-12 text-content-muted max-w-[220px]">
            The copilot adapts to your current view — thesis, feed, company, or memo.
          </p>
        </div>
      </div>

      <Separator />

      {/* Input area */}
      <div className="p-3 shrink-0">
        <div
          className={clsx(
            'flex items-center gap-2 h-9 px-3 rounded-lg',
            'bg-base-elevated border border-border-subtle',
            'text-13 text-content-muted',
            'focus-within:border-ai/40 focus-within:ring-1 focus-within:ring-ai/20',
            'sig-transition'
          )}
        >
          <Sparkles size={13} className="text-ai/60 shrink-0" />
          <input
            type="text"
            placeholder="Ask about this view..."
            aria-label="Ask copilot"
            className="flex-1 bg-transparent text-content-primary placeholder:text-content-muted outline-none text-13"
          />
          <kbd className="text-11 text-content-muted font-mono shrink-0">↵</kbd>
        </div>
      </div>
    </aside>
  )
}
