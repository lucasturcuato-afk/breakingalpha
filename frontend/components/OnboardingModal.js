import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '32px', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ color: '#f9fafb', fontSize: '20px', fontWeight: 600, marginBottom: '6px' }}>What are you tracking?</h2>
        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '24px' }}>Pick tickers and sectors to personalize your Breaking Alpha feed.</p>

        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: '#9ca3af', fontSize: '11px', letterSpacing: '0.08em', marginBottom: '10px', textTransform: 'uppercase' }}>Tickers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {SUGGESTED_TICKERS.map(t => (
              <button key={t} onClick={() => toggle(t, 'ticker')} style={{ padding: '4px 10px', borderRadius: '4px', border: `1px solid ${isSelected(t, 'ticker') ? '#3b82f6' : '#374151'}`, background: isSelected(t, 'ticker') ? 'rgba(59,130,246,0.15)' : 'transparent', color: isSelected(t, 'ticker') ? '#93c5fd' : '#9ca3af', fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer' }}>{t}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <input value={customInput} onChange={e => setCustomInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder="Add ticker..." style={{ flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }} />
            <button onClick={addCustom} style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '12px', cursor: 'pointer' }}>Add</button>
          </div>
        </div>

        <div style={{ marginBottom: '28px' }}>
          <div style={{ color: '#9ca3af', fontSize: '11px', letterSpacing: '0.08em', marginBottom: '10px', textTransform: 'uppercase' }}>Sectors</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {SUGGESTED_SECTORS.map(s => (
              <button key={s} onClick={() => toggle(s, 'sector')} style={{ padding: '4px 10px', borderRadius: '4px', border: `1px solid ${isSelected(s, 'sector') ? '#8b5cf6' : '#374151'}`, background: isSelected(s, 'sector') ? 'rgba(139,92,246,0.15)' : 'transparent', color: isSelected(s, 'sector') ? '#c4b5fd' : '#9ca3af', fontSize: '12px', cursor: 'pointer' }}>{s}</button>
            ))}
          </div>
        </div>

        {selected.length > 0 && (
          <div style={{ marginBottom: '16px', color: '#6b7280', fontSize: '12px' }}>{selected.length} item{selected.length !== 1 ? 's' : ''} selected</div>
        )}
        {error && <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

        <button onClick={handleSave} disabled={saving} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving...' : selected.length > 0 ? 'Start tracking' : 'Skip for now'}
        </button>
      </div>
    </div>
  )
}
