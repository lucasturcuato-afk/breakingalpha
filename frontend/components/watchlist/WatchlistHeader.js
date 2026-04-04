import { Plus } from 'lucide-react'
import Button from '../primitives/Button'

export default function WatchlistHeader({ onAdd }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
      <div>
        <h1 className="text-18 font-semibold text-content-primary">Watchlist</h1>
        <p className="text-12 text-content-muted mt-0.5">
          Track companies and tickers across your deal pipeline
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={onAdd}>
        <Plus size={14} />
        Add Symbol
      </Button>
    </div>
  )
}
