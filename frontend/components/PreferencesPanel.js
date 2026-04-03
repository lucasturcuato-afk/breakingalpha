import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

const SECTOR_OPTIONS = [
  { id: 'Technology M&A',   color: '#f59e0b' },
  { id: 'Venture Capital',  color: '#8b5cf6' },
  { id: 'Private Equity',   color: '#3b82f6' },
  { id: 'Public Markets',   color: '#10b981' },
  { id: 'Geopolitics',      color: '#ef4444' },
  { id: 'Healthcare',       color: '#ec4899' },
  { id: 'Energy',           color: '#84cc16' },
  { id: 'Consumer',         color: '#a78bfa' },
]

const MODULE_OPTIONS = [
  { id: 'Macro & Rates',  description: 'Interest rates, Fed policy, macro signals' },
  { id: 'Deals & M&A',    description: 'Acquisitions, mergers, deal flow highlights' },
  { id: 'Public Markets', description: 'Earnings, equity moves, market tone' },
  { id: 'Sector Signals', description: 'Sector-by-sector momentum and alerts' },
]

export default function PreferencesPanel({ user }) {
  const [sectors, setSectors] = useState([])
  const [modules, setModules] = useState([])
  const [prioritizeWatchlist, setPrioritizeWatchlist] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/preferences', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (res.ok) {
        const { preferences } = await res.json()
        if (preferences) {
          setSectors(preferences.sectors || [])
          setModules(preferences.modules || [])
          setPrioritizeWatchlist(preferences.prioritize_watchlist || false)
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ sectors, modules, prioritize_watchlist: prioritizeWatchlist }),
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

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '28px', height: '28px', border: '2px solid rgba(255,255,255,0.08)', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.28)', letterSpacing: '0.12em' }}>LOADING PREFERENCES...</div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: '680px' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>Brief Preferences</div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
          Control what your Morning Review and Evening Wrap emphasize. These preferences will shape brief personalization as the feature matures.
        </div>
      </div>

      {/* Sectors */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.14em', marginBottom: '12px' }}>PREFERRED SECTORS</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', fontFamily: "'DM Mono', monospace", marginBottom: '12px' }}>
          Select the sectors you want your briefs to prioritize.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {SECTOR_OPTIONS.map(s => {
            const active = sectors.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() => toggleSector(s.id)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: `1px solid ${active ? s.color : 'rgba(255,255,255,0.1)'}`,
                  background: active ? s.color + '18' : 'transparent',
                  color: active ? s.color : 'rgba(255,255,255,0.45)',
                  fontSize: '12px',
                  fontFamily: "'DM Mono', monospace",
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {s.id}
              </button>
            )
          })}
        </div>
        {sectors.length === 0 && (
          <div style={{ marginTop: '10px', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.2)' }}>
            No sectors selected — briefs will cover all sectors equally.
          </div>
        )}
      </div>

      {/* Modules */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.14em', marginBottom: '12px' }}>BRIEF SECTIONS</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', fontFamily: "'DM Mono', monospace", marginBottom: '14px' }}>
          Choose which analyst sections matter most to you.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {MODULE_OPTIONS.map(m => {
            const active = modules.includes(m.id)
            return (
              <button
                key={m.id}
                onClick={() => toggleModule(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: `1px solid ${active ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.07)'}`,
                  background: active ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.02)',
                  color: active ? '#f8fafc' : 'rgba(255,255,255,0.45)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                  width: '100%',
                }}
              >
                {/* Toggle pill */}
                <div style={{
                  width: '32px',
                  height: '18px',
                  borderRadius: '9px',
                  background: active ? '#f59e0b' : 'rgba(255,255,255,0.1)',
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}>
                  <div style={{
                    position: 'absolute',
                    top: '3px',
                    left: active ? '17px' : '3px',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.15s',
                  }} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontFamily: "'DM Mono', monospace", fontWeight: 500, marginBottom: '2px' }}>{m.id}</div>
                  <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>{m.description}</div>
                </div>
              </button>
            )
          })}
        </div>
        {modules.length === 0 && (
          <div style={{ marginTop: '10px', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.2)' }}>
            No sections selected — all sections will be included.
          </div>
        )}
      </div>

      {/* Watchlist relevance toggle */}
      <div style={{ marginBottom: '36px' }}>
        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.14em', marginBottom: '12px' }}>PERSONALIZATION</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '14px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.02)',
            opacity: 0.45,
            cursor: 'not-allowed',
            width: '100%',
          }}
        >
          <div style={{
            width: '32px',
            height: '18px',
            borderRadius: '9px',
            background: 'rgba(255,255,255,0.1)',
            position: 'relative',
            flexShrink: 0,
          }}>
            <div style={{
              position: 'absolute',
              top: '3px',
              left: '3px',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: '#fff',
            }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontSize: '13px', fontFamily: "'DM Mono', monospace", fontWeight: 500, color: 'rgba(255,255,255,0.45)' }}>Prioritize watchlist relevance</span>
              <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.1em' }}>COMING SOON</span>
            </div>
            <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>
              Weight brief coverage toward companies and sectors in your watchlist.
            </div>
          </div>
        </div>
      </div>

      {/* Brief schedule info */}
      <div style={{ marginBottom: '32px', padding: '14px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.055)', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.14em', marginBottom: '10px' }}>BRIEF SCHEDULE</div>
        <div style={{ display: 'flex', gap: '24px' }}>
          <div>
            <div style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', marginBottom: '2px' }}>☀ Morning Review</div>
            <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>Weekdays at 6:00 AM PT</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: '#8b5cf6', marginBottom: '2px' }}>🌙 Evening Wrap</div>
            <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>Weekdays at 10:00 PM PT</div>
          </div>
        </div>
      </div>

      {/* Save */}
      {error && (
        <div style={{ color: '#f87171', fontSize: '12px', fontFamily: "'DM Mono', monospace", marginBottom: '12px' }}>{error}</div>
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '10px 28px',
          borderRadius: '6px',
          border: 'none',
          background: saved ? '#22c55e' : '#f59e0b',
          color: '#000',
          fontSize: '12px',
          fontFamily: "'DM Mono', monospace",
          fontWeight: 600,
          letterSpacing: '0.06em',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
          transition: 'background 0.2s',
        }}
      >
        {saving ? 'SAVING...' : saved ? 'SAVED' : 'SAVE PREFERENCES'}
      </button>
    </div>
  )
}
