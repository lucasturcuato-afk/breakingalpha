import { useState } from 'react'
import styles from './DealMemo.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const DEAL_TYPES = ['M&A', 'LBO', 'IPO', 'Venture', 'SPAC', 'Carve-out', 'Secondary', 'Strategic Partnership']

const SECTOR_OPTIONS = [
  'Technology M&A & Investment Banking',
  'Venture Capital & Startup Funding',
  'Private Equity & Buyouts',
  'Public Markets & Earnings',
  'Geopolitics & Macro',
  'Real Estate & REITs',
  'Fintech & Crypto',
  'Healthcare & Biotech',
  'Energy & Climate',
  'Consumer & Retail',
]

// ── DealMemo ──────────────────────────────────────────────────────────────────
// Business logic (API call, form state, copy) extracted from DealFlowTracker
// in index.js. API contract with /api/memo preserved exactly.
export default function DealMemo() {
  const [form, setForm] = useState({
    company: '', acquirer: '', deal_type: 'M&A', value: '', sector: '', description: '',
  })
  const [memo, setMemo]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [copied, setCopied]   = useState(false)

  // ── generateMemo — same API call as DealFlowTracker.generateMemo ──────────
  async function generateMemo() {
    if (!form.company.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company:     form.company,
          acquirer:    form.acquirer,
          deal_type:   form.deal_type,
          value:       form.value,
          sector:      form.sector,
          description: form.description,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `API error ${res.status}`)
      } else if (data.memo) {
        setMemo(data.memo)
      } else {
        setError(data.error || 'No memo generated — try again')
      }
    } catch (err) {
      setError(`Generation failed: ${err.message}`)
    }
    setLoading(false)
  }

  // ── handleCopy — navigator.clipboard pattern from DealFlowTracker ─────────
  function handleCopy() {
    if (!memo) return
    navigator.clipboard.writeText(memo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── handleExport — plain-text download ───────────────────────────────────
  function handleExport() {
    if (!memo) return
    const blob = new Blob([memo], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `deal-memo-${form.company.toLowerCase().replace(/\s+/g, '-') || 'memo'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>

      {/* ── Board header ── */}
      <div className={styles.header}>
        <span className={styles.headerLabel}>AI DEAL MEMO GENERATOR</span>
        <span className={styles.headerSub}>Groq · llama-3.1-8b-instant · IB-standard output</span>
      </div>

      {/* ── Split panes ── */}
      <div className={styles.panes}>

        {/* ── Left: input form ── */}
        <div className={styles.formPane}>
          <div className={styles.sectionLabel}>TRANSACTION DETAILS</div>

          <div className={styles.field}>
            <label className={styles.label}>
              TARGET COMPANY <span className={styles.req}>*</span>
            </label>
            <input
              className={styles.input}
              placeholder="e.g. Figma"
              value={form.company}
              onChange={set('company')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>ACQUIRER</label>
            <input
              className={styles.input}
              placeholder="e.g. Adobe"
              value={form.acquirer}
              onChange={set('acquirer')}
            />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label}>DEAL TYPE</label>
              <select className={styles.input} value={form.deal_type} onChange={set('deal_type')}>
                {DEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>DEAL VALUE</label>
              <input
                className={styles.input}
                placeholder="e.g. $20B"
                value={form.value}
                onChange={set('value')}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>SECTOR</label>
            <select className={styles.input} value={form.sector} onChange={set('sector')}>
              <option value="">Select sector...</option>
              {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>ADDITIONAL CONTEXT</label>
            <textarea
              className={styles.textarea}
              placeholder="Deal-specific context, news, or background..."
              value={form.description}
              onChange={set('description')}
              rows={4}
            />
          </div>

          <button
            className={styles.generateBtn}
            onClick={generateMemo}
            disabled={loading || !form.company.trim()}
            aria-label={loading ? 'Generating memo…' : 'Generate deal memo'}
          >
            {loading ? 'GENERATING...' : '✦ GENERATE MEMO'}
          </button>

          {error && (
            <div className={styles.error} role="alert">⚠ {error}</div>
          )}
        </div>

        {/* ── Right: output pane ── */}
        <div className={styles.outputPane}>

          {/* Sticky toolbar */}
          <div className={styles.outputToolbar}>
            <span className={styles.outputLabel}>
              {memo ? `MEMO — ${form.company.toUpperCase()}` : 'MEMO OUTPUT'}
            </span>
            <div className={styles.toolbarActions}>
              <button
                className={styles.toolBtn}
                onClick={handleCopy}
                disabled={!memo}
                aria-label="Copy memo to clipboard"
              >
                {copied ? '✓ COPIED' : 'COPY'}
              </button>
              <button
                className={styles.toolBtn}
                onClick={handleExport}
                disabled={!memo}
                aria-label="Export memo as text file"
              >
                EXPORT TXT
              </button>
            </div>
          </div>

          {/* Content area */}
          <div className={styles.outputContent}>
            {loading ? (
              <div className={styles.loadingState}>
                <div className={styles.spinner} />
                <span className={styles.loadingText}>GENERATING MEMO...</span>
              </div>
            ) : memo ? (
              /* Same bold/newline rendering as DealFlowTracker modal */
              <div
                className={styles.memoText}
                dangerouslySetInnerHTML={{
                  __html: memo
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br/>')
                }}
              />
            ) : (
              <div className={styles.placeholder}>
                <span className={styles.placeholderText}>
                  Fill in the transaction details and click Generate Memo — output will appear here as a professional IB-standard deal memo.
                </span>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
