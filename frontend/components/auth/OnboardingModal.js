import { useState } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Button from '../primitives/Button'
import Input from '../primitives/Input'
import Badge from '../primitives/Badge'

const SUGGESTED_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN', 'TSLA', 'JPM', 'GS', 'BX']
const SUGGESTED_SECTORS = ['Technology', 'Finance', 'Healthcare', 'Energy', 'Consumer', 'Real Estate', 'Industrials']

export default function OnboardingModal({ user, onComplete }) {
  const [selected, setSelected] = useState([])
  const [customInput, setCustomInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (identifier, type) => {
    const key = `${type}:${identifier}`
    setSelected(prev =>
      prev.find(s => s.key === key)
        ? prev.filter(s => s.key !== key)
        : [...prev, { key, identifier, type }]
    )
  }

  const isSelected = (identifier, type) => selected.some(s => s.key === `${type}:${identifier}`)

  const addCustom = () => {
    const val = customInput.trim().toUpperCase()
    if (!val) return
    const key = `ticker:${val}`
    if (!selected.find(s => s.key === key)) {
      setSelected(prev => [...prev, { key, identifier: val, type: 'ticker' }])
    }
    setCustomInput('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    localStorage.setItem(`ba_onboarded_${user.id}`, 'true')
    if (selected.length > 0) {
      const { data: { session } } = await supabase.auth.getSession()
      const rows = selected.map(({ identifier, type }) => ({
        identifier, type, user_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      const res = await fetch('/api/watchlist/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ entries: rows }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to save watchlist')
        setSaving(false)
        return
      }
    }
    setSaving(false)
    onComplete()
  }

  const customTickers = selected.filter(s => s.type === 'ticker' && !SUGGESTED_TICKERS.includes(s.identifier))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative bg-base-elevated border border-border rounded-lg shadow-xl w-full max-w-[520px] mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-7 pt-7 pb-0">
          <h2 className="text-20 font-semibold text-content-primary mb-1">
            What are you tracking?
          </h2>
          <p className="text-13 text-content-muted mb-6">
            Pick tickers and sectors to personalize your Signalera feed.
          </p>

          {/* Tickers */}
          <div className="mb-5">
            <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
              Tickers
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_TICKERS.map(t => (
                <button
                  key={t}
                  onClick={() => toggle(t, 'ticker')}
                  className={clsx(
                    'px-2.5 h-7 rounded-md text-12 font-mono font-medium sig-transition border',
                    isSelected(t, 'ticker')
                      ? 'bg-signal-muted text-signal-400 border-signal-500/30'
                      : 'bg-base-elevated text-content-muted border-border-subtle hover:border-border-strong'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mt-3">
              <Input
                placeholder="Add ticker..."
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustom()}
                inputClassName="font-mono"
                className="flex-1"
              />
              <Button variant="secondary" size="sm" onClick={addCustom}>
                Add
              </Button>
            </div>

            {customTickers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {customTickers.map(s => (
                  <button
                    key={s.key}
                    onClick={() => toggle(s.identifier, 'ticker')}
                    className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-12 font-mono font-medium bg-signal-muted text-signal-400 border border-signal-500/30 sig-transition"
                  >
                    {s.identifier}
                    <X size={10} className="opacity-60" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sectors */}
          <div className="mb-6">
            <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
              Sectors
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_SECTORS.map(s => (
                <button
                  key={s}
                  onClick={() => toggle(s, 'sector')}
                  className={clsx(
                    'px-2.5 h-7 rounded-md text-12 font-medium sig-transition border',
                    isSelected(s, 'sector')
                      ? 'bg-ai-muted text-ai border-ai/30'
                      : 'bg-base-elevated text-content-muted border-border-subtle hover:border-border-strong'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-7 pb-7">
          {selected.length > 0 && (
            <p className="text-12 text-content-muted mb-3">
              {selected.length} item{selected.length !== 1 ? 's' : ''} selected
            </p>
          )}

          {error && (
            <p className="text-12 text-live mb-3">{error}</p>
          )}

          <Button
            variant="primary"
            className="w-full"
            onClick={handleSave}
            loading={saving}
          >
            {selected.length > 0 ? 'Start tracking' : 'Skip for now'}
          </Button>
        </div>
      </div>
    </div>
  )
}
