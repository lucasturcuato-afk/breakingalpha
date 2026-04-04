import { useState } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import Button from '../primitives/Button'
import Input from '../primitives/Input'

export default function WatchlistAddModal({ open, onClose, onSubmit }) {
  const [identifier, setIdentifier] = useState('')
  const [type, setType] = useState('ticker')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  async function handleSubmit(e) {
    e.preventDefault()
    const val = identifier.trim()
    if (!val) return

    setLoading(true)
    setError('')

    try {
      await onSubmit({ identifier: val, type })
      setIdentifier('')
      setType('ticker')
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to add to watchlist')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-base-elevated border border-border rounded-lg shadow-xl w-full max-w-[400px] mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-14 font-semibold text-content-primary">Add to Watchlist</h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-content-muted hover:text-content-primary sig-transition"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex gap-2">
            {['ticker', 'company'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={clsx(
                  'px-3 h-7 rounded-md text-12 font-medium sig-transition border',
                  type === t
                    ? 'bg-signal-muted text-signal-400 border-signal-500/30'
                    : 'bg-base-elevated text-content-muted border-border-subtle hover:border-border-strong'
                )}
              >
                {t === 'ticker' ? 'Ticker' : 'Company'}
              </button>
            ))}
          </div>

          <Input
            label={type === 'ticker' ? 'Ticker Symbol' : 'Company Name'}
            placeholder={type === 'ticker' ? 'e.g. AAPL' : 'e.g. Apple Inc'}
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            error={error}
            autoFocus
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={loading}>
              Add
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
