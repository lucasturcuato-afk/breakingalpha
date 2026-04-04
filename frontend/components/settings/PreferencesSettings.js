import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Button from '../primitives/Button'
import Separator from '../primitives/Separator'
import Skeleton from '../primitives/Skeleton'

const SECTOR_OPTIONS = [
  'Technology M&A',
  'Venture Capital',
  'Private Equity',
  'Public Markets',
  'Geopolitics',
  'Healthcare',
  'Energy',
  'Consumer',
]

const MODULE_OPTIONS = [
  { id: 'Macro & Rates', description: 'Interest rates, Fed policy, macro signals' },
  { id: 'Deals & M&A', description: 'Acquisitions, mergers, deal flow highlights' },
  { id: 'Public Markets', description: 'Earnings, equity moves, market tone' },
  { id: 'Sector Signals', description: 'Sector-by-sector momentum and alerts' },
]

function Toggle({ active, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'relative w-8 h-[18px] rounded-full shrink-0 sig-transition',
        disabled && 'opacity-40 cursor-not-allowed',
        active ? 'bg-signal-500' : 'bg-base-overlay',
      )}
    >
      <span
        className={clsx(
          'absolute top-[3px] w-3 h-3 rounded-full bg-white sig-transition',
          active ? 'left-[17px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}

export default function PreferencesSettings({ user }) {
  const [sectors, setSectors] = useState([])
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setLoading(false); return }
      const res = await fetch('/api/preferences', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const { preferences } = await res.json()
        if (preferences) {
          setSectors(preferences.sectors || [])
          setModules(preferences.modules || [])
        }
      }
      setLoading(false)
    }
    load()
  }, [user])

  const toggleSector = (id) => {
    setSectors(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
    setSaved(false)
  }

  const toggleModule = (id) => {
    setModules(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ sectors, modules, prioritize_watchlist: false }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to save preferences')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-[680px]">
        <Skeleton width="200px" height="20px" rounded="md" />
        <Skeleton width="100%" height="14px" rounded="sm" />
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="100px" height="32px" rounded="md" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[680px]">
      <h2 className="text-18 font-semibold text-content-primary mb-1">Brief Preferences</h2>
      <p className="text-12 text-content-muted mb-6">
        Control what your Morning Review and Evening Wrap emphasize.
      </p>

      {/* Sectors */}
      <div className="mb-8">
        <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-2">
          Preferred Sectors
        </div>
        <p className="text-12 text-content-muted mb-3">
          Select the sectors you want your briefs to prioritize.
        </p>
        <div className="flex flex-wrap gap-2">
          {SECTOR_OPTIONS.map(s => {
            const active = sectors.includes(s)
            return (
              <button
                key={s}
                onClick={() => toggleSector(s)}
                className={clsx(
                  'px-3 h-8 rounded-md text-12 font-medium sig-transition border',
                  active
                    ? 'bg-signal-muted text-signal-400 border-signal-500/30'
                    : 'bg-base-elevated text-content-muted border-border-subtle hover:border-border-strong'
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
        {sectors.length === 0 && (
          <p className="text-11 text-content-muted mt-2">
            No sectors selected — briefs will cover all sectors equally.
          </p>
        )}
      </div>

      <Separator className="mb-8" />

      {/* Modules */}
      <div className="mb-8">
        <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-2">
          Brief Sections
        </div>
        <p className="text-12 text-content-muted mb-3">
          Choose which analyst sections matter most to you.
        </p>
        <div className="flex flex-col gap-2">
          {MODULE_OPTIONS.map(m => {
            const active = modules.includes(m.id)
            return (
              <button
                key={m.id}
                onClick={() => toggleModule(m.id)}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-md text-left sig-transition border w-full',
                  active
                    ? 'bg-signal-muted/50 border-signal-500/20 text-content-primary'
                    : 'bg-base-elevated border-border-subtle text-content-muted hover:border-border-strong'
                )}
              >
                <Toggle active={active} onClick={() => {}} />
                <div>
                  <div className="text-13 font-medium">{m.id}</div>
                  <div className="text-11 text-content-muted">{m.description}</div>
                </div>
              </button>
            )
          })}
        </div>
        {modules.length === 0 && (
          <p className="text-11 text-content-muted mt-2">
            No sections selected — all sections will be included.
          </p>
        )}
      </div>

      <Separator className="mb-8" />

      {/* Watchlist relevance — coming soon */}
      <div className="mb-8">
        <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-2">
          Personalization
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-md border border-border-subtle bg-base-elevated opacity-50 cursor-not-allowed">
          <Toggle active={false} disabled />
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-13 font-medium text-content-muted">Prioritize watchlist relevance</span>
              <span className="text-10 font-mono text-content-muted tracking-wider uppercase">Coming Soon</span>
            </div>
            <div className="text-11 text-content-muted">
              Weight brief coverage toward companies and sectors in your watchlist.
            </div>
          </div>
        </div>
      </div>

      <Separator className="mb-8" />

      {/* Brief schedule */}
      <div className="mb-8">
        <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
          Brief Schedule
        </div>
        <div className="flex gap-6 px-4 py-3 rounded-md border border-border-subtle bg-base-elevated">
          <div>
            <div className="text-12 font-medium text-signal-400 mb-0.5">Morning Review</div>
            <div className="text-11 font-mono text-content-muted">Weekdays at 6:00 AM PT</div>
          </div>
          <div>
            <div className="text-12 font-medium text-ai mb-0.5">Evening Wrap</div>
            <div className="text-11 font-mono text-content-muted">Weekdays at 10:00 PM PT</div>
          </div>
        </div>
      </div>

      {/* Save */}
      {error && <p className="text-12 text-live mb-3">{error}</p>}
      <Button
        variant={saved ? 'secondary' : 'primary'}
        onClick={handleSave}
        loading={saving}
      >
        {saved && <Check size={14} />}
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save Preferences'}
      </Button>
    </div>
  )
}
