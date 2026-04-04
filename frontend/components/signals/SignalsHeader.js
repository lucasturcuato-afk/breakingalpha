import { RefreshCw } from 'lucide-react'
import Button from '../primitives/Button'

export default function SignalsHeader({ count, loading, onRefresh }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
      <div>
        <h1 className="text-18 font-semibold text-content-primary">Signals</h1>
        <p className="text-12 text-content-muted mt-0.5">
          AI-detected patterns, sentiment shifts, and notable activity
        </p>
      </div>
      <div className="flex items-center gap-3">
        {count > 0 && (
          <span className="text-12 font-mono tabular-nums text-content-muted">
            {count} signals
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={onRefresh} loading={loading}>
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>
    </div>
  )
}
