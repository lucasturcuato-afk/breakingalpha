import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import styles from './ThesisBoard.module.css'

// ── Conviction → color mapping ────────────────────────────────────────────────
// Preserved exactly from the original CONVICTION_COLORS in index.js.
// Only visual hex values updated to match design system.
const CONVICTION_COLORS = {
  BULLISH: '#16c25e',  // design system --green
  BEARISH: '#e83a3a',  // design system --red
  WATCH:   '#f0c040',  // design system --yellow / neutral
}

// ── Sector → color lookup ─────────────────────────────────────────────────────
// Replicated from getSectorColor() + SECTORS in index.js.
// Must not be removed from index.js — this is an independent local copy.
const SECTOR_COLORS = [
  { key: 'Technology',  color: '#f59e0b' },
  { key: 'Venture',     color: '#8b5cf6' },
  { key: 'Private',     color: '#3b82f6' },
  { key: 'Public',      color: '#10b981' },
  { key: 'Geopolit',    color: '#ef4444' },
  { key: 'Real',        color: '#f97316' },
  { key: 'Fintech',     color: '#06b6d4' },
  { key: 'Crypto',      color: '#06b6d4' },
  { key: 'Healthcare',  color: '#ec4899' },
  { key: 'Energy',      color: '#84cc16' },
  { key: 'Consumer',    color: '#a78bfa' },
]

function getSectorColor(sector) {
  if (!sector) return '#64748b'
  const found = SECTOR_COLORS.find(s => sector.includes(s.key))
  return found?.color || '#64748b'
}

// ── timeAgo — replicated from index.js, logic unchanged ──────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── ThesisCard subcomponent ───────────────────────────────────────────────────
function ThesisCard({ thesis }) {
  const [expanded, setExpanded] = useState(false)

  // All field access preserves the original fallback patterns from index.js:
  //   conviction: t.conviction || t.signal
  //   text:       t.rationale  || t.thesis
  const conviction = thesis.conviction || thesis.signal
  const convColor  = CONVICTION_COLORS[conviction] || '#94a3b8'
  const text       = thesis.rationale || thesis.thesis || ''

  // Only show the expand toggle when the text is long enough to be clamped.
  // Groq rationale is typically 2-3 sentences (~200-400 chars); at 11px/1.55
  // line-height in a ~200px column, 4 lines ≈ 170 chars. Use 160 as threshold.
  const isTruncatable = text.length > 160

  return (
    <article
      className={styles.card}
      style={{ borderLeftColor: convColor }}
      aria-label={thesis.title}
    >
      {/* ── Top row: conviction badge + sector tag ── */}
      <div className={styles.cardTop}>
        <span
          className={styles.convictionBadge}
          style={{
            color:      convColor,
            background: convColor + '18',
            borderColor: convColor + '40',
          }}
        >
          {conviction}
        </span>

        {thesis.sector && (
          <span
            className={styles.sectorTag}
            title={thesis.sector}
            style={{ color: getSectorColor(thesis.sector) }}
          >
            {thesis.sector}
          </span>
        )}
      </div>

      {/* ── Title ── */}
      <h3 className={styles.title}>{thesis.title}</h3>

      {/* ── Divider ── */}
      <div className={styles.divider} />

      {/* ── Rationale / thesis body ── */}
      {text && (
        <>
          <p className={expanded ? styles.rationaleExpanded : styles.rationale}>
            {text}
          </p>
          {isTruncatable && (
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}
            >
              {expanded ? 'Show less ↑' : 'Read more ↓'}
            </button>
          )}
        </>
      )}

      {/* ── Catalyst ── */}
      {thesis.catalyst && (
        <div className={styles.catalyst}>
          ⚡ {thesis.catalyst}
        </div>
      )}

      {/* ── Footer: timestamp ── */}
      <div className={styles.cardFooter}>
        <span className={styles.timestamp}>
          {timeAgo(thesis.generated_at)}
        </span>
      </div>
    </article>
  )
}

// ── ThesisBoard ───────────────────────────────────────────────────────────────
// All business logic (Supabase fetch, Groq regenerate, state) is preserved
// character-for-character from the original ThesisBoard() in index.js.
// Only the return statement (JSX) is redesigned.
export default function ThesisBoard() {
  const [theses, setTheses]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [lastGenerated, setLastGenerated] = useState(null)
  const [error, setError]             = useState(null)

  // ── Supabase fetch — unchanged from original ──────────────────────────────
  useEffect(() => {
    async function loadTheses() {
      setLoading(true)
      const { data, error } = await supabase
        .from('theses')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(5)
      if (!error && data && data.length > 0) {
        setTheses(data)
        setLastGenerated(data[0].generated_at)
      }
      setLoading(false)
    }
    loadTheses()
  }, [])

  // ── Groq regenerate ───────────────────────────────────────────────────────
  // Fixed: surface real error messages from API response body and caught
  // exceptions instead of swallowing them with a generic string.
  async function generateTheses() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/theses', { method: 'POST' })
      const data = await res.json()

      // Surface the API's own error message when the response is not ok
      if (!res.ok) {
        setError(data.error || `API error ${res.status}`)
        setGenerating(false)
        return
      }

      if (data.theses && data.theses.length > 0) {
        setTheses(data.theses)
        setLastGenerated(new Date().toISOString())
      } else if (data.error) {
        // API returned 200 but with an error field (e.g. empty articles table)
        setError(data.error)
      } else {
        setError('No theses generated — try again')
      }
    } catch (err) {
      // Network error, JSON parse failure, etc — show the real message
      setError(`Generation failed: ${err.message}`)
    }
    setGenerating(false)
  }

  // ── lastGenTime — unchanged from original ────────────────────────────────
  const lastGenTime = lastGenerated
    ? new Date(lastGenerated).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Board header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.boardLabel}>THESIS BOARD</span>
          {lastGenTime && (
            <span className={styles.lastGen}>
              Last generated: Today {lastGenTime}
            </span>
          )}
        </div>

        <div className={styles.headerRight}>
          <button
            className={styles.regenBtn}
            onClick={generateTheses}
            disabled={generating}
            aria-label={generating ? 'Generating theses…' : 'Regenerate theses'}
          >
            {generating ? 'GENERATING...' : '⟳ REGENERATE'}
          </button>
        </div>
      </div>

      {/* ── Subtitle ── */}
      <p className={styles.subtitle}>
        AI-generated investment theses synthesized from live BreakingAlpha signal flow
      </p>

      {/* ── Error ── */}
      {error && (
        <div className={styles.error} role="alert">⚠ {error}</div>
      )}

      {/* ── Loading skeletons ── */}
      {loading ? (
        <div className={styles.skeletonGrid}>
          {[0, 1, 2].map(i => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>

      /* ── Empty state ── */
      ) : theses.length === 0 ? (
        <div className={styles.grid}>
          <div className={styles.empty}>
            <p className={styles.emptyPrimary}>No theses generated yet</p>
            <p className={styles.emptySecondary}>
              Click REGENERATE to generate today's investment theses from live market data
            </p>
            <button
              className={styles.emptyBtn}
              onClick={generateTheses}
              disabled={generating}
            >
              {generating ? 'GENERATING...' : 'GENERATE THESES'}
            </button>
          </div>
        </div>

      /* ── Card grid ── */
      ) : (
        <div className={styles.grid}>
          {theses.map((t, i) => (
            <ThesisCard key={t.id || i} thesis={t} />
          ))}
        </div>
      )}
    </div>
  )
}
