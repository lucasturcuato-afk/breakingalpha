import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import AuthButton from '../components/AuthButton'
import OnboardingModal from '../components/OnboardingModal'
import LandingPage from '../components/LandingPage'
import SignedOutHomepage from '../components/SignedOutHomepage'
import PreferencesPanel from '../components/PreferencesPanel'
import { supabase } from '../lib/supabaseClient'
import { useTheme } from '../context/ThemeContext'

const SECTORS = [
  { key: 'ALL',    label: 'ALL',         value: null,                                  color: '#f59e0b' },
  { key: 'tech',   label: 'TECH M&A',    value: 'Technology M&A & Investment Banking', color: '#f59e0b' },
  { key: 'vc',     label: 'VENTURE',     value: 'Venture Capital & Startup Funding',   color: '#8b5cf6' },
  { key: 'pe',     label: 'PRIVATE EQ',  value: 'Private Equity & Buyouts',           color: '#3b82f6' },
  { key: 'pub',    label: 'PUBLIC MKT',  value: 'Public Markets & Earnings',           color: '#10b981' },
  { key: 'geo',    label: 'GEO & MACRO', value: 'Geopolitics & Macro',                 color: '#ef4444' },
  { key: 're',     label: 'REAL ESTATE', value: 'Real Estate & REITs',                 color: '#f97316' },
  { key: 'fin',    label: 'FINTECH',     value: 'Fintech & Crypto',                    color: '#06b6d4' },
  { key: 'health', label: 'HEALTHCARE',  value: 'Healthcare & Biotech',                color: '#ec4899' },
  { key: 'energy', label: 'ENERGY',      value: 'Energy & Climate',                    color: '#84cc16' },
  { key: 'cons',   label: 'CONSUMER',    value: 'Consumer & Retail',                   color: '#a78bfa' },
]

const SIDEBAR_SECTORS = [
  { name: 'Technology M&A',    color: '#f59e0b' },
  { name: 'Venture Capital',   color: '#8b5cf6' },
  { name: 'Private Equity',    color: '#3b82f6' },
  { name: 'Public Markets',    color: '#10b981' },
  { name: 'Geopolitics',       color: '#ef4444' },
  { name: 'Real Estate',       color: '#f97316' },
  { name: 'Fintech & Crypto',  color: '#06b6d4' },
  { name: 'Healthcare',        color: '#ec4899' },
  { name: 'Energy',            color: '#84cc16' },
  { name: 'Consumer & Retail', color: '#a78bfa' },
]

const DEAL_STAGE_MAP = {
  rumored:   { label: 'RUMORED',   color: '#94a3b8' },
  announced: { label: 'ANNOUNCED', color: '#fbbf24' },
  loi:       { label: 'UNDER LOI', color: '#f97316' },
  diligence: { label: 'DILIGENCE', color: '#8b5cf6' },
  signed:    { label: 'SIGNED',    color: '#3b82f6' },
  closed:    { label: 'CLOSED',    color: '#4ade80' },
  dead:      { label: 'DEAD',      color: '#f87171' },
}

const TONE_COLORS = {
  'RISK-ON':  '#4ade80',
  'RISK-OFF': '#f87171',
  'MIXED':    '#fbbf24',
  'NEUTRAL':  '#94a3b8',
}

function cleanDealType(raw) {
  if (!raw) return 'M&A'
  const str = String(raw)
  // If it contains slashes or commas, take only the first item
  const first = str.split(/[\/,]/)[0].trim()
  return first || 'M&A'
}

function getSectorColor(sector) {
  if (!sector) return '#64748b'
  const found = SECTORS.find(s => s.value && sector.includes(s.value.split(' ')[0]))
  return found?.color || '#64748b'
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function parseJSON(val) {
  if (!val) return null
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}

// ── Empty State ──────────────────────────────────────────────────────────────
const EMPTY_ICONS = {
  newspaper: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/></svg>,
  briefcase: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>,
  book: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>,
  bookmark: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>,
  trending: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  grid: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>,
  sun: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
}

function EmptyState({ icon, title, subtitle, action, onAction }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 24px', animation: 'emptyFadeIn 500ms ease both' }}>
      <div style={{ color: 'var(--faint)', marginBottom: '16px', opacity: 0.3 }}>{icon}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '17px', fontWeight: 600, color: 'var(--tertiary)', marginBottom: '6px', textAlign: 'center' }}>{title}</div>
      {subtitle && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'var(--faint)', textAlign: 'center', maxWidth: '320px', lineHeight: 1.6 }}>{subtitle}</div>}
      {action && onAction && (
        <button onClick={onAction} style={{ marginTop: '18px', padding: '8px 20px', borderRadius: '6px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', letterSpacing: '0.08em', transition: 'all 150ms ease' }}>{action}</button>
      )}
    </div>
  )
}

function SkeletonCard({ height = '120px', count = 1 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} style={{ height, borderRadius: '10px', background: 'linear-gradient(90deg, var(--shimmer-from) 0%, var(--shimmer-to) 50%, var(--shimmer-from) 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite', border: '1px solid var(--divider)', marginBottom: i < count - 1 ? '10px' : 0 }} />
  ))
}

function SkeletonRows({ rows = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'linear-gradient(90deg, var(--shimmer-from) 0%, var(--shimmer-to) 50%, var(--shimmer-from) 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: '14px', width: `${70 + Math.random() * 30}%`, borderRadius: '4px', background: 'linear-gradient(90deg, var(--shimmer-from) 0%, var(--shimmer-to) 50%, var(--shimmer-from) 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite', marginBottom: '8px' }} />
            <div style={{ height: '10px', width: `${40 + Math.random() * 30}%`, borderRadius: '4px', background: 'linear-gradient(90deg, var(--shimmer-from-dim) 0%, var(--shimmer-to-dim) 50%, var(--shimmer-from-dim) 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Ticker Bar ───────────────────────────────────────────────────────────────
function TickerBar({ quotes }) {
  if (!quotes || quotes.length === 0) return (
    <div style={{ background: 'var(--ticker-bg)', borderBottom: '1px solid var(--divider)', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'var(--faint)', letterSpacing: '0.1em' }}>FETCHING MARKET DATA...</span>
    </div>
  )
  const items = [...quotes, ...quotes, ...quotes]
  return (
    <div style={{ background: 'var(--ticker-bg)', borderBottom: '1px solid var(--divider)', overflow: 'hidden', height: '32px', display: 'flex', alignItems: 'center', position: 'relative', width: '100%' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40px', background: 'linear-gradient(to right, var(--ticker-fade-start), transparent)', zIndex: 2 }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40px', background: 'linear-gradient(to left, var(--ticker-fade-start), transparent)', zIndex: 2 }} />
      <div style={{ display: 'flex', animation: 'scrollTicker 60s linear infinite', whiteSpace: 'nowrap', willChange: 'transform' }}>
        {items.map((q, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '0 20px', fontSize: '11px', fontFamily: "'DM Mono', monospace", borderRight: '1px solid var(--divider)', flexShrink: 0 }}>
            <span style={{ color: 'var(--tertiary)', fontSize: '10px' }}>{q.symbol}</span>
            <span style={{ color: 'var(--heading)', fontWeight: 500 }}>{q.price}</span>
            <span style={{ color: q.pct >= 0 ? '#4ade80' : '#f87171', fontSize: '10px' }}>{q.pct >= 0 ? '▲' : '▼'} {Math.abs(q.pct).toFixed(2)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Sector Pill ──────────────────────────────────────────────────────────────
function SectorPill({ sector }) {
  const color = getSectorColor(sector)
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em', color, background: color + '18', border: `1px solid ${color}38` }}>
      {sector}
    </span>
  )
}

// ── Article Card ─────────────────────────────────────────────────────────────
function ArticleCard({ article, isNew }) {
  const [expanded, setExpanded] = useState(false)
  let companies = article.companies
  if (typeof companies === 'string') { try { companies = JSON.parse(companies) } catch { companies = [] } }
  if (!Array.isArray(companies)) companies = []
  const timestamp = article.published_at || article.ingested_at

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{ background: isNew ? 'rgba(245,158,11,0.05)' : 'var(--card-bg)', border: `1px solid ${isNew ? 'rgba(245,158,11,0.25)' : 'var(--filter-inactive-border)'}`, borderRadius: '10px', padding: '16px 20px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-hover-bg)'; e.currentTarget.style.borderColor = 'var(--card-hover-border)' }}
      onMouseLeave={e => { e.currentTarget.style.background = isNew ? 'rgba(245,158,11,0.05)' : 'var(--card-bg)'; e.currentTarget.style.borderColor = isNew ? 'rgba(245,158,11,0.25)' : 'var(--filter-inactive-border)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {isNew && <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 6px', borderRadius: '3px', letterSpacing: '0.1em' }}>NEW</span>}
          {article.sector && <SectorPill sector={article.sector} />}
          {article.source && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)' }}>{article.source}</span>}
        </div>
        {timestamp && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', flexShrink: 0 }}>{timeAgo(timestamp)}</span>}
      </div>
      <h3 style={{ fontSize: '15.5px', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: 'var(--heading)', lineHeight: 1.4, margin: 0 }}>{article.title}</h3>
      {expanded && (
        <div style={{ marginTop: '12px' }}>
          {article.relevance_reason && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '10px' }}>
              <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>Why it matters</span>
              <span style={{ fontSize: '13px', color: 'var(--body)', lineHeight: 1.5 }}>{article.relevance_reason}</span>
            </div>
          )}
          {(companies.length > 0 || article.sector) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px', alignItems: 'center' }}>
              {companies.map((c, i) => (
                <span key={i} style={{ padding: '2px 9px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(147,197,253,0.85)', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>{c}</span>
              ))}
              {article.sector && (
                <span style={{ padding: '2px 9px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(134,239,172,0.85)', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>{article.sector}</span>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
            {article.source && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)' }}>{article.source}</span>}
            {article.published_at && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>{timeAgo(article.published_at)}</span>}
            {article.url && <a href={article.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#60a5fa', textDecoration: 'none' }}>READ SOURCE →</a>}
          </div>
        </div>
      )}
      <div style={{ marginTop: '7px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>{expanded ? '↑ collapse' : '↓ expand'}</div>
    </div>
  )
}

// ── Morning / Evening Brief (detailed analyst style) ─────────────────────────
function BriefView({ type }) {
  const [briefing, setBriefing] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [sectorCounts, setSectorCounts] = useState({})
  const [todayLabel, setTodayLabel] = useState('')
  useEffect(() => { setTodayLabel(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })) }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: bData } = await supabase.from('briefings').select('*').eq('briefing_type', type).neq('headline', 'Market Intelligence Unavailable').order('created_at', { ascending: false }).limit(1)
      if (bData?.[0]) setBriefing(bData[0])
      const { data: aData } = await supabase.from('articles').select('*').order('ingested_at', { ascending: false }).limit(100)
      if (aData) {
        setArticles(aData)
        const counts = {}
        aData.forEach(a => { if (a.sector) counts[a.sector] = (counts[a.sector] || 0) + 1 })
        setSectorCounts(counts)
      }
      setLoading(false)
    }
    load()
  }, [type])

  const activeSector = SECTORS.find(s => s.key === sectorFilter)
  const filtered = sectorFilter === 'ALL' ? articles : articles.filter(a => a.sector === activeSector?.value)

  if (loading) return (
    <div style={{ padding: '20px 0' }}>
      <SkeletonCard height="180px" />
      <div style={{ height: '10px' }} />
      <SkeletonCard height="100px" count={3} />
    </div>
  )

  const sections    = parseJSON(briefing?.sections) || {}
  const topDeals    = parseJSON(briefing?.top_deals) || []
  const sectorBreak = parseJSON(briefing?.sector_breakdown) || {}
  const tone        = briefing?.market_tone || 'NEUTRAL'
  const toneColor   = TONE_COLORS[tone] || '#94a3b8'

  const SECTION_LABELS = {
    deals_and_ma:    '💼 DEALS & M&A',
    public_markets:  '📊 PUBLIC MARKETS',
    macro_and_rates: '🏦 MACRO & RATES',
    geopolitics:     '🌍 GEOPOLITICS',
    sector_spotlight:'🔦 SECTOR SPOTLIGHT',
    what_to_watch:   '👁 WHAT TO WATCH',
    tomorrow_setup:  '🌅 TOMORROW\'S SETUP',
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* ── Hero header ── */}
      <div style={{ borderBottom: '1px solid rgba(245,158,11,0.15)', paddingBottom: '24px', marginBottom: '28px' }}>
        <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.18em', marginBottom: '8px' }}>
          {type === 'morning' ? 'MORNING REVIEW' : 'EVENING WRAP'}
        </div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 300, color: 'var(--heading)', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          {todayLabel || 'Today'}
        </div>
        <div style={{ width: '40px', height: '2px', background: '#f59e0b', marginTop: '14px', borderRadius: '1px' }} />
      </div>

      {briefing ? (
        <>
          {/* ── Lead story ── */}
          <div style={{ position: 'relative', background: 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(139,92,246,0.03) 50%, rgba(16,185,129,0.02) 100%)', borderLeft: '3px solid #f59e0b', borderRadius: '0 14px 14px 0', padding: '32px 36px', marginBottom: '28px', animation: 'cardSlideIn 400ms ease both' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.18em' }}>TODAY'S LEAD</div>
              <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: toneColor, background: toneColor + '12', border: `1px solid ${toneColor}30`, letterSpacing: '0.08em' }}>{tone}</span>
            </div>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 700, color: 'var(--heading)', lineHeight: 1.25, margin: '0 0 16px 0', letterSpacing: '-0.01em' }}>{briefing.headline}</h1>
            <p style={{ fontSize: '14.5px', color: 'var(--body)', lineHeight: 1.85, margin: 0, maxWidth: '680px' }}>{briefing.summary}</p>
          </div>

          {/* ── Top Deals ── */}
          {topDeals.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.14em' }}>TOP DEALS TO WATCH</div>
                <div style={{ flex: 1, height: '1px', background: 'rgba(245,158,11,0.12)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
                {topDeals.map((deal, i) => (
                  <div key={i} style={{ background: 'var(--card-bg-subtle)', border: '1px solid var(--divider)', borderTop: '2px solid #f59e0b22', borderRadius: '10px', padding: '18px 20px', animation: `cardSlideIn 400ms ease ${i * 60}ms both`, transition: 'transform 150ms ease, border-color 150ms ease' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.18)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--divider)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '16px', fontWeight: 600, color: 'var(--heading)' }}>{deal.company}</span>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#fbbf24', flexShrink: 0, marginLeft: '8px', fontWeight: 500 }}>{deal.value || 'Undisclosed'}</span>
                    </div>
                    <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', marginBottom: '6px', letterSpacing: '0.06em' }}>{cleanDealType(deal.deal_type)}</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--secondary)', lineHeight: 1.55 }}>{deal.one_liner}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Analyst Briefing sections ── */}
          {Object.keys(sections).length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.14em' }}>ANALYST BRIEFING</div>
                <div style={{ flex: 1, height: '1px', background: 'rgba(245,158,11,0.12)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {Object.entries(sections).map(([key, text], i) => (
                  <div key={key} style={{ background: 'var(--card-bg-subtle)', border: '1px solid var(--divider)', borderRadius: '10px', padding: '20px 22px', gridColumn: key === 'what_to_watch' || key === 'tomorrow_setup' ? 'span 2' : 'span 1', animation: `cardSlideIn 400ms ease ${i * 50}ms both` }}>
                    <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(245,158,11,0.1)' }}>{SECTION_LABELS[key] || key.replace(/_/g, ' ').toUpperCase()}</div>
                    <p style={{ fontSize: '13.5px', color: 'var(--body)', lineHeight: 1.72, margin: 0 }}>{text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Sector Signals ── */}
          {Object.keys(sectorBreak).length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.14em' }}>SECTOR SIGNALS</div>
                <div style={{ flex: 1, height: '1px', background: 'rgba(245,158,11,0.12)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
                {Object.entries(sectorBreak).map(([sector, text], i) => {
                  const color = getSectorColor(sector)
                  return (
                    <div key={sector} style={{ background: 'var(--card-bg-subtle)', border: '1px solid var(--divider)', borderLeft: `3px solid ${color}40`, borderRadius: '0 10px 10px 0', padding: '14px 18px', animation: `cardSlideIn 400ms ease ${i * 50}ms both` }}>
                      <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color, marginBottom: '6px', letterSpacing: '0.1em' }}>{sector.split(' ')[0].toUpperCase()}</div>
                      <div style={{ fontSize: '12.5px', color: 'var(--secondary)', lineHeight: 1.55 }}>{text}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={type === 'morning' ? EMPTY_ICONS.sun : EMPTY_ICONS.moon}
          title={`No ${type} brief yet`}
          subtitle={type === 'morning' ? 'Publishes weekdays at 6:00 AM PT' : 'Publishes weekdays at 10:00 PM PT'}
        />
      )}

      {/* Articles feed */}
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.12em', marginBottom: '10px' }}>TOP STORIES</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
        {SECTORS.map(s => {
          const count = s.key === 'ALL' ? articles.length : (sectorCounts[s.value] || 0)
          const isActive = sectorFilter === s.key
          return (
            <button key={s.key} onClick={() => setSectorFilter(s.key)} style={{ padding: '4px 11px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.12s', letterSpacing: '0.05em', outline: 'none', border: `1px solid ${isActive ? s.color : 'var(--filter-inactive-border)'}`, background: isActive ? s.color + '18' : 'transparent', color: isActive ? s.color : count > 0 ? 'var(--filter-inactive-text)' : 'var(--filter-inactive-text-dim)' }}>
              {s.label}{count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', marginBottom: '14px' }}>{filtered.length} {filtered.length === 1 ? 'STORY' : 'STORIES'}{sectorFilter !== 'ALL' && ` · ${activeSector?.label}`}</div>
      {filtered.length > 0
        ? filtered.map(a => <ArticleCard key={a.id} article={a} />)
        : <EmptyState icon={EMPTY_ICONS.newspaper} title="No stories in this sector yet" subtitle="Articles will appear here as they are ingested" />}
    </div>
  )
}

// ── Live News Tracker ────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { key: 'newest',    label: 'NEWEST FIRST' },
  { key: 'oldest',    label: 'OLDEST FIRST' },
  { key: 'relevance', label: 'TOP RELEVANCE' },
  { key: 'sentiment', label: 'BY SENTIMENT' },
]

const SENTIMENT_ORDER = { bullish: 0, positive: 0, neutral: 1, mixed: 1, bearish: 2, negative: 2 }

function getTimeBucket(dateStr) {
  if (!dateStr) return 'EARLIER'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = diff / 60000
  if (mins < 60)   return 'LAST HOUR'
  if (mins < 1440) return 'TODAY'
  if (mins < 2880) return 'YESTERDAY'
  return 'EARLIER'
}

const BUCKET_ORDER = ['LAST HOUR', 'TODAY', 'YESTERDAY', 'EARLIER']
const BUCKET_COLORS = { 'LAST HOUR': '#f59e0b', 'TODAY': '#4ade80', 'YESTERDAY': '#60a5fa', 'EARLIER': '#94a3b8' }

function LiveTracker() {
  const [articles, setArticles]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [sectorCounts, setSectorCounts] = useState({})
  const [newIds, setNewIds]           = useState(new Set())
  const [sortBy, setSortBy]           = useState('newest')
  const knownIds = useRef(new Set())
  const REFRESH_MS = 60000

  const fetchArticles = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('articles')
      .select('*')
      .order('ingested_at', { ascending: false })
      .limit(150)
    if (data) {
      const incoming = new Set(data.map(a => a.id))
      const brandNew = new Set([...incoming].filter(id => knownIds.current.size > 0 && !knownIds.current.has(id)))
      if (brandNew.size > 0) setNewIds(prev => new Set([...prev, ...brandNew]))
      knownIds.current = incoming
      setArticles(data)
      const counts = {}
      data.forEach(a => { if (a.sector) counts[a.sector] = (counts[a.sector] || 0) + 1 })
      setSectorCounts(counts)
      setLastRefresh(new Date())
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchArticles(false)
    const interval = setInterval(() => fetchArticles(true), REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchArticles])

  // Filter by sector
  const activeSector = SECTORS.find(s => s.key === sectorFilter)
  const filtered = sectorFilter === 'ALL' ? articles : articles.filter(a => a.sector === activeSector?.value)

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'newest')    return new Date(b.published_at||b.ingested_at||0) - new Date(a.published_at||a.ingested_at||0)
    if (sortBy === 'oldest')    return new Date(a.published_at||a.ingested_at||0) - new Date(b.published_at||b.ingested_at||0)
    if (sortBy === 'relevance') return (b.relevance_score||0) - (a.relevance_score||0)
    if (sortBy === 'sentiment') {
      const sa = SENTIMENT_ORDER[a.sentiment?.toLowerCase()] ?? 1
      const sb = SENTIMENT_ORDER[b.sentiment?.toLowerCase()] ?? 1
      if (sa !== sb) return sa - sb
      return new Date(b.ingested_at||0) - new Date(a.ingested_at||0)
    }
    return 0
  })

  // Group into time buckets (only for non-sentiment sorts)
  const useBuckets = sortBy !== 'sentiment' && sortBy !== 'relevance'
  const grouped = {}
  if (useBuckets) {
    sorted.forEach(a => {
      const bucket = getTimeBucket(a.published_at || a.ingested_at)
      if (!grouped[bucket]) grouped[bucket] = []
      grouped[bucket].push(a)
    })
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '4px' }}>⚡ LIVE NEWS TRACKER</div>
          <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', margin: 0 }}>
            Auto-refreshes every 60s · {articles.length} stories tracked
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {lastRefresh && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>Updated {timeAgo(lastRefresh)}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#4ade80', letterSpacing: '0.1em' }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* Sort controls */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.14em', marginBottom: '7px' }}>SORT BY</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {SORT_OPTIONS.map(opt => {
            const isActive = sortBy === opt.key
            return (
              <button key={opt.key} onClick={() => setSortBy(opt.key)} style={{ padding: '5px 13px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.12s', letterSpacing: '0.06em', outline: 'none', border: `1px solid ${isActive ? '#f59e0b' : 'var(--input-border)'}`, background: isActive ? 'rgba(245,158,11,0.12)' : 'var(--card-bg)', color: isActive ? '#f59e0b' : 'var(--filter-inactive-text-muted)' }}>
                {isActive && '● '}{opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Sector filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
        {SECTORS.map(s => {
          const count = s.key === 'ALL' ? articles.length : (sectorCounts[s.value] || 0)
          const isActive = sectorFilter === s.key
          return (
            <button key={s.key} onClick={() => setSectorFilter(s.key)} style={{ padding: '4px 11px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.12s', letterSpacing: '0.05em', outline: 'none', border: `1px solid ${isActive ? s.color : 'var(--filter-inactive-border)'}`, background: isActive ? s.color + '18' : 'transparent', color: isActive ? s.color : count > 0 ? 'var(--filter-inactive-text)' : 'var(--filter-inactive-text-dim)' }}>
              {s.label}{count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', marginBottom: '14px' }}>
        {sorted.length} {sorted.length === 1 ? 'STORY' : 'STORIES'}
        {sectorFilter !== 'ALL' && ` · ${activeSector?.label}`}
        {newIds.size > 0 && <span style={{ marginLeft: '10px', color: '#f59e0b' }}>· {newIds.size} new since last visit</span>}
      </div>

      {loading ? (
        <div style={{ padding: '10px 0' }}><SkeletonCard height="90px" count={4} /></div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={EMPTY_ICONS.newspaper} title="No stories in this sector yet" subtitle="Articles will appear here as they are ingested" />
      ) : useBuckets ? (
        // Time-bucketed view
        BUCKET_ORDER.filter(b => grouped[b]?.length > 0).map(bucket => (
          <div key={bucket} style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid var(--divider)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: BUCKET_COLORS[bucket], flexShrink: 0, ...(bucket === 'LAST HOUR' ? { animation: 'pulse 2s infinite' } : {}) }} />
              <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: BUCKET_COLORS[bucket], letterSpacing: '0.14em' }}>{bucket}</span>
              <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>{grouped[bucket].length} {grouped[bucket].length === 1 ? 'story' : 'stories'}</span>
            </div>
            {grouped[bucket].map(a => <ArticleCard key={a.id} article={a} isNew={newIds.has(a.id)} />)}
          </div>
        ))
      ) : sortBy === 'sentiment' ? (
        // Sentiment-grouped view
        (() => {
          const sentGroups = { 'BULLISH': [], 'NEUTRAL': [], 'BEARISH': [] }
          sorted.forEach(a => {
            const s = a.sentiment?.toLowerCase() || ''
            if (s === 'bullish' || s === 'positive') sentGroups['BULLISH'].push(a)
            else if (s === 'bearish' || s === 'negative') sentGroups['BEARISH'].push(a)
            else sentGroups['NEUTRAL'].push(a)
          })
          const sentColors = { BULLISH: '#4ade80', NEUTRAL: '#94a3b8', BEARISH: '#f87171' }
          return Object.entries(sentGroups).filter(([, arr]) => arr.length > 0).map(([label, arr]) => (
            <div key={label} style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid var(--divider)' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: sentColors[label], flexShrink: 0 }} />
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: sentColors[label], letterSpacing: '0.14em' }}>{label}</span>
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>{arr.length} {arr.length === 1 ? 'story' : 'stories'}</span>
              </div>
              {arr.map(a => <ArticleCard key={a.id} article={a} isNew={newIds.has(a.id)} />)}
            </div>
          ))
        })()
      ) : (
        // Flat sorted view (relevance)
        sorted.map(a => <ArticleCard key={a.id} article={a} isNew={newIds.has(a.id)} />)
      )}
    </div>
  )
}

// ── Thesis Board ─────────────────────────────────────────────────────────────
function ThesisBoard() {
  const [theses, setTheses] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [lastGenerated, setLastGenerated] = useState(null)
  const [error, setError] = useState(null)

  const CONVICTION_COLORS = { BULLISH: '#10b981', BEARISH: '#ef4444', WATCH: '#f59e0b' }

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

  async function generateTheses() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/theses', { method: 'POST' })
      const data = await res.json()
      if (data.theses && data.theses.length > 0) {
        setTheses(data.theses)
        setLastGenerated(new Date().toISOString())
      } else {
        setError('No theses generated — try again')
      }
    } catch (err) {
      setError('Failed to generate theses')
    }
    setGenerating(false)
  }

  const lastGenTime = lastGenerated
    ? new Date(lastGenerated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null

  const confScore = (conviction) => {
    const scores = { BULLISH: 82, BEARISH: 74, WATCH: 55 }
    return scores[conviction] || 50
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid rgba(245,158,11,0.15)', paddingBottom: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.18em', marginBottom: '6px' }}>THESIS BOARD</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '26px', fontWeight: 300, color: 'var(--heading)', letterSpacing: '-0.01em' }}>Investment Theses</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {lastGenTime && (
              <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>
                {lastGenTime}
              </span>
            )}
            <button
              onClick={generateTheses}
              disabled={generating}
              style={{ padding: '8px 18px', borderRadius: '6px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: generating ? 'not-allowed' : 'pointer', border: '1px solid rgba(245,158,11,0.4)', background: generating ? 'rgba(245,158,11,0.04)' : 'rgba(245,158,11,0.1)', color: '#f59e0b', letterSpacing: '0.08em', opacity: generating ? 0.5 : 1, transition: 'all 0.2s' }}
            >
              {generating ? 'GENERATING...' : 'REGENERATE'}
            </button>
          </div>
        </div>
        <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', marginTop: '8px' }}>AI-synthesized from live BreakingAlpha signal flow</p>
        <div style={{ width: '40px', height: '2px', background: '#f59e0b', marginTop: '12px', borderRadius: '1px' }} />
      </div>

      {error && (
        <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#ef4444', marginBottom: '14px', padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '6px' }}>⚠ {error}</div>
      )}

      {loading ? (
        <div><SkeletonCard height="140px" count={3} /></div>
      ) : theses.length === 0 ? (
        <EmptyState
          icon={EMPTY_ICONS.book}
          title="No theses generated yet"
          subtitle="Generate today's investment theses from live market data"
          action={generating ? 'GENERATING...' : 'GENERATE THESES'}
          onAction={generating ? undefined : generateTheses}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {theses.map((t, i) => {
            const conviction = t.conviction || t.signal
            const convColor = CONVICTION_COLORS[conviction] || '#94a3b8'
            const score = confScore(conviction)
            const circumference = 2 * Math.PI * 16
            const offset = circumference - (score / 100) * circumference
            return (
              <div key={i} style={{
                background: 'var(--card-bg-subtle)',
                border: '1px solid var(--divider)',
                borderTop: `2px solid ${convColor}40`,
                borderRadius: '12px',
                padding: '24px 28px',
                animation: `cardSlideIn 400ms ease ${i * 80}ms both`,
                transition: 'transform 150ms ease, border-color 150ms ease',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = `${convColor}30` }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--divider)' }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  {/* Donut confidence score */}
                  <div style={{ flexShrink: 0, position: 'relative', width: '48px', height: '48px' }}>
                    <svg width="48" height="48" viewBox="0 0 40 40" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--divider)" strokeWidth="3" />
                      <circle cx="20" cy="20" r="16" fill="none" stroke={convColor} strokeWidth="3"
                        strokeDasharray={circumference} strokeDashoffset={offset}
                        strokeLinecap="round" style={{ animation: 'donutFill 800ms ease both', animationDelay: `${i * 80 + 200}ms` }} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: convColor, fontWeight: 500 }}>{score}</div>
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '12px' }}>
                      <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '18px', fontWeight: 600, color: 'var(--heading)', margin: 0, lineHeight: 1.3 }}>{t.title}</h3>
                      <span style={{ padding: '3px 12px', borderRadius: '20px', fontSize: '9px', fontFamily: "'DM Mono', monospace", color: convColor, background: convColor + '12', border: `1px solid ${convColor}25`, flexShrink: 0, letterSpacing: '0.08em' }}>{conviction}</span>
                    </div>
                    <p style={{ fontSize: '13.5px', color: 'var(--secondary)', lineHeight: 1.65, margin: '0 0 14px 0' }}>{t.rationale || t.thesis}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {t.sector && <SectorPill sector={t.sector} />}
                      </div>
                      {t.catalyst && (
                        <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.04em', background: 'rgba(245,158,11,0.06)', padding: '3px 10px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.12)' }}>
                          CATALYST: {t.catalyst}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Deal Flow Tracker ─────────────────────────────────────────────────────────
function DealFlowTracker() {
  const [deals, setDeals]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [filterStage, setFilterStage] = useState('ALL')
  const [search, setSearch]           = useState('')
  const [expanded, setExpanded]       = useState(null)
  const [showForm, setShowForm]       = useState(false)
  const [formData, setFormData]       = useState({ company: '', acquirer: '', deal_type: '', status: 'announced', value: '', notes: '' })
  const [memoLoading, setMemoLoading] = useState(null)
  const [memoContent, setMemoContent] = useState('')
  const [memoTitle, setMemoTitle]     = useState('')
  const [showMemoModal, setShowMemoModal] = useState(false)
  const [memoDisplayed, setMemoDisplayed] = useState('')
  const [memoCopied, setMemoCopied]     = useState(false)
  const [dealAddedSet, setDealAddedSet] = useState(new Set())

  const handleAddDealCompany = async (company) => {
    if (dealAddedSet.has(company)) return
    const { data: { session: wlSession } } = await supabase.auth.getSession()
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wlSession?.access_token}` },
      body: JSON.stringify({ identifier: company, type: 'company' })
    })
    setDealAddedSet(prev => new Set([...prev, company]))
  }

  const generateMemo = async (deal, e) => {
    e.stopPropagation()
    setMemoLoading(deal.id)
    try {
      const res = await fetch('/api/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: deal.company,
          acquirer: deal.acquirer,
          deal_type: deal.deal_type,
          value: deal.value || deal.valuation,
          sector: deal.sector,
          description: deal.summary || deal.notes,
        }),
      })
      const data = await res.json()
      if (data.memo) {
        setMemoContent(data.memo)
        setMemoTitle(deal.company)
        setShowMemoModal(true)
      }
    } catch (err) {
      console.error('Memo generation failed:', err)
    }
    setMemoLoading(null)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('deal_flow').select('*').order('updated_at', { ascending: false }).limit(200)
      if (data) setDeals(data)
      setLoading(false)
    }
    load()
  }, [])

  // Typewriter effect for memo output
  useEffect(() => {
    if (!memoContent || !showMemoModal) { setMemoDisplayed(''); return }
    setMemoDisplayed('')
    setMemoCopied(false)
    let i = 0
    const id = setInterval(() => {
      i++
      setMemoDisplayed(memoContent.slice(0, i))
      if (i >= memoContent.length) clearInterval(id)
    }, 12)
    return () => clearInterval(id)
  }, [memoContent, showMemoModal])

  const handleAddDeal = async () => {
    if (!formData.company.trim()) return
    const newDeal = { ...formData, id: Date.now(), source: 'manual', ingested_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    setDeals([newDeal, ...deals])
    setShowForm(false)
    setFormData({ company: '', acquirer: '', deal_type: '', status: 'announced', value: '', notes: '' })
    const { error } = await supabase.from('deal_flow').insert([{
      company: newDeal.company || '',
      acquirer: newDeal.acquirer || null,
      deal_type: newDeal.deal_type || null,
      status: newDeal.status || 'announced',
      value: newDeal.value || null,
      notes: newDeal.notes || null,
      source: 'manual',
      ingested_at: new Date().toISOString()
    }])
    if (error) console.error('Deal Flow insert failed:', error)
  }

  const stageCounts = {}
  deals.forEach(d => { stageCounts[d.stage] = (stageCounts[d.stage] || 0) + 1 })

  const filtered = deals.filter(d => {
    const stageMatch  = filterStage === 'ALL' || d.stage === filterStage
    const searchMatch = !search || d.company?.toLowerCase().includes(search.toLowerCase()) || d.acquirer?.toLowerCase().includes(search.toLowerCase())
    return stageMatch && searchMatch
  })

  const activeDeals = deals.filter(d => !['closed','dead'].includes(d.stage)).length

  return (
    <div>
      <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '4px' }}>💼 DEAL FLOW TRACKER</div>
          <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', margin: 0 }}>AI-extracted deal pipeline · auto-updated from news ingestion</p>
        </div>
        <button onClick={() => setShowForm(f => !f)} style={{ padding: '5px 13px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', flexShrink: 0 }}>+ ADD DEAL</button>
      </div>

      {showForm && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--input-border)', borderRadius: '10px', padding: '18px 20px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <input placeholder="Company *" value={formData.company} onChange={e => setFormData(f => ({ ...f, company: e.target.value }))} style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none' }} />
            <input placeholder="Acquirer" value={formData.acquirer} onChange={e => setFormData(f => ({ ...f, acquirer: e.target.value }))} style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none' }} />
            <input placeholder="Deal type (e.g. M&A, IPO)" value={formData.deal_type} onChange={e => setFormData(f => ({ ...f, deal_type: e.target.value }))} style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none' }} />
            <input placeholder="Value (e.g. $2.5B)" value={formData.value} onChange={e => setFormData(f => ({ ...f, value: e.target.value }))} style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none' }} />
          </div>
          <input placeholder="Notes" value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none', marginBottom: '10px' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAddDeal} style={{ padding: '6px 16px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>SAVE DEAL</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '6px 16px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid var(--card-border)', background: 'transparent', color: 'var(--tertiary)' }}>CANCEL</button>
          </div>
        </div>
      )}

      {deals.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '16px 0 20px' }}>
            {[
              { label: 'DEALS TRACKED',   value: deals.length },
              { label: 'ACTIVE',          value: activeDeals },
              { label: 'CLOSED',          value: stageCounts['closed'] || 0 },
              { label: 'WITH VALUATION',  value: deals.filter(d => d.valuation).length },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: 700, color: 'var(--heading)', marginBottom: '3px' }}>{s.value}</div>
                <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.12em' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <input type="text" placeholder="Search company, acquirer..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', padding: '9px 15px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none', marginBottom: '14px' }} />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <button onClick={() => setFilterStage('ALL')} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: `1px solid ${filterStage === 'ALL' ? '#f59e0b' : 'var(--filter-inactive-border)'}`, background: filterStage === 'ALL' ? 'rgba(245,158,11,0.12)' : 'transparent', color: filterStage === 'ALL' ? '#f59e0b' : 'var(--filter-inactive-text-mid)' }}>ALL ({deals.length})</button>
            {Object.entries(DEAL_STAGE_MAP).map(([key, s]) => {
              const count = stageCounts[key] || 0
              if (!count) return null
              const isActive = filterStage === key
              return <button key={key} onClick={() => setFilterStage(key)} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: `1px solid ${isActive ? s.color : 'var(--filter-inactive-border)'}`, background: isActive ? s.color + '18' : 'transparent', color: isActive ? s.color : 'var(--filter-inactive-text-mid)' }}>{s.label} ({count})</button>
            })}
          </div>
        </>
      )}

      {loading && (
        <div style={{ padding: '10px 0' }}><SkeletonCard height="80px" count={4} /></div>
      )}

      {!loading && deals.length === 0 && (
        <EmptyState
          icon={EMPTY_ICONS.briefcase}
          title="Deal pipeline populating"
          subtitle="AI is extracting deals from ingested articles. Check back shortly."
        />
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', marginBottom: '6px' }}>{filtered.length} {filtered.length === 1 ? 'DEAL' : 'DEALS'}{filterStage !== 'ALL' ? ` · ${DEAL_STAGE_MAP[filterStage]?.label}` : ''}</div>
          {filtered.map(deal => {
            const stage    = DEAL_STAGE_MAP[deal.stage] || DEAL_STAGE_MAP.rumored
            const secColor = deal.sector ? getSectorColor(deal.sector) : '#64748b'
            const isExp    = expanded === deal.id
            return (
              <div key={deal.id} onClick={() => setExpanded(isExp ? null : deal.id)}
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '16px 20px', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-hover-bg)'; e.currentTarget.style.borderColor = 'var(--card-hover-border)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--card-bg)'; e.currentTarget.style.borderColor = 'var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '18px', fontWeight: 700, color: 'var(--heading)' }}>{deal.company}</span>
                    {deal.acquirer && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'var(--tertiary)' }}>← {deal.acquirer}</span>}
                    {deal.company && <button onClick={e => { e.stopPropagation(); handleAddDealCompany(deal.company) }} style={{ background: 'none', border: 'none', cursor: dealAddedSet.has(deal.company) ? 'default' : 'pointer', color: '#f59e0b', fontFamily: "'DM Mono', monospace", fontSize: '11px', padding: '1px 3px', flexShrink: 0, lineHeight: 1 }}>{dealAddedSet.has(deal.company) ? '✓' : '+'}</button>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                    {deal.valuation && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#fbbf24' }}>{deal.valuation}</span>}
                    <span style={{ padding: '3px 9px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: stage.color, background: stage.color + '18', border: `1px solid ${stage.color}40` }}>{stage.label}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {deal.deal_type && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'var(--tertiary)', background: 'var(--card-hover-bg)', border: '1px solid var(--card-border)', padding: '2px 8px', borderRadius: '3px' }}>{deal.deal_type}</span>}
                  {deal.sector && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: secColor, background: secColor + '15', border: `1px solid ${secColor}28`, padding: '2px 8px', borderRadius: '3px' }}>{deal.sector.split(' ')[0]}</span>}
                  <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>{timeAgo(deal.updated_at)}</span>
                  {deal.auto_extracted && <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(245,158,11,0.4)' }}>🤖 AI</span>}
                </div>
                {isExp && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--divider)' }}>
                    {deal.thesis && (
                      <div style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: '6px', padding: '10px 14px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#fbbf24', letterSpacing: '0.12em', marginBottom: '4px' }}>SIGNAL</div>
                        <p style={{ fontSize: '13px', color: 'var(--body)', margin: 0, lineHeight: 1.55, fontStyle: 'italic' }}>{deal.thesis}</p>
                      </div>
                    )}
                    {deal.source_url && <a href={deal.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#60a5fa', textDecoration: 'none' }}>READ SOURCE →</a>}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                  <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>{isExp ? '↑ collapse' : '↓ expand'}</span>
                  <button
                    onClick={e => generateMemo(deal, e)}
                    disabled={memoLoading === deal.id}
                    style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '9px', fontFamily: "'DM Mono', monospace", cursor: memoLoading === deal.id ? 'default' : 'pointer', border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.06)', color: memoLoading === deal.id ? 'rgba(245,158,11,0.4)' : '#f59e0b', letterSpacing: '0.06em' }}>
                    {memoLoading === deal.id ? 'GENERATING...' : '✦ GENERATE MEMO'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showMemoModal && (
        <div onClick={() => setShowMemoModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', animation: 'contentFadeIn 200ms ease' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '960px', maxHeight: '85vh', display: 'flex', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(245,158,11,0.15)', animation: 'cardSlideIn 350ms ease' }}>
            {/* Left pane — frosted glass form info */}
            <div style={{ width: '38%', minWidth: '280px', background: 'rgba(13,13,26,0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderRight: '1px solid var(--divider)', padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.16em', marginBottom: '8px' }}>DEAL MEMO</div>
                <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '28px', fontWeight: 700, color: 'var(--heading)', margin: 0, lineHeight: 1.2 }}>{memoTitle}</h2>
                <div style={{ width: '40px', height: '2px', background: 'linear-gradient(90deg, #f59e0b, transparent)', margin: '12px 0 0' }} />
              </div>
              {/* Deal details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                {[
                  { label: 'STATUS', value: 'AI-Generated Analysis' },
                  { label: 'MODEL', value: 'Groq · LLaMA 3' },
                  { label: 'GENERATED', value: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                ].map((item, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '8px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.14em', marginBottom: '4px' }}>{item.label}</div>
                    <div style={{ fontSize: '13px', fontFamily: "'DM Mono', monospace", color: 'var(--body)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
              {/* Ghost Bα monogram */}
              <div style={{ display: 'flex', justifyContent: 'center', opacity: 0.04, marginTop: 'auto' }}>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '80px', fontWeight: 700, color: 'var(--heading)', lineHeight: 1 }}>Bα</span>
              </div>
            </div>
            {/* Right pane — memo output */}
            <div style={{ flex: 1, background: '#0a0a18', display: 'flex', flexDirection: 'column' }}>
              {/* Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: '1px solid var(--divider)', background: 'var(--card-bg-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: memoDisplayed.length < memoContent.length ? '#f59e0b' : '#10b981', animation: memoDisplayed.length < memoContent.length ? 'cursorBlink 1s infinite' : 'none' }} />
                  <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)' }}>
                    {memoDisplayed.length < memoContent.length ? 'GENERATING...' : 'COMPLETE'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => { navigator.clipboard.writeText(memoContent); setMemoCopied(true); setTimeout(() => setMemoCopied(false), 2000) }}
                    style={{ padding: '5px 14px', borderRadius: '4px', fontSize: '9px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid rgba(245,158,11,0.35)', background: memoCopied ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.08)', color: memoCopied ? '#10b981' : '#f59e0b', letterSpacing: '0.08em', transition: 'all 150ms ease' }}>
                    {memoCopied ? '✓ COPIED' : 'COPY'}
                  </button>
                  <button
                    onClick={() => setShowMemoModal(false)}
                    style={{ padding: '5px 14px', borderRadius: '4px', fontSize: '9px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid var(--card-border)', background: 'transparent', color: 'var(--tertiary)', letterSpacing: '0.08em' }}>
                    CLOSE
                  </button>
                </div>
              </div>
              {/* Memo content with typewriter */}
              <div style={{ overflowY: 'auto', padding: '28px 32px', flex: 1 }}>
                {!memoDisplayed ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '48px', fontWeight: 700, color: 'var(--card-bg)' }}>Bα</div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {[0, 1, 2].map(j => (
                        <div key={j} style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#f59e0b', animation: 'cursorBlink 1.2s infinite', animationDelay: `${j * 200}ms` }} />
                      ))}
                    </div>
                    <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.1em' }}>ANALYZING DEAL...</div>
                  </div>
                ) : (
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '12.5px', color: 'var(--body)', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}
                    dangerouslySetInnerHTML={{ __html: memoDisplayed.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f8fafc;font-weight:600">$1</strong>').replace(/\n/g, '<br/>') }} />
                )}
                {memoDisplayed && memoDisplayed.length < memoContent.length && (
                  <span style={{ display: 'inline-block', width: '2px', height: '14px', background: '#f59e0b', marginLeft: '2px', animation: 'cursorBlink 0.8s infinite', verticalAlign: 'text-bottom' }} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Company Intel ─────────────────────────────────────────────────────────────
function CompanyIntel() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [addedSet, setAddedSet] = useState(new Set())
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [companyArticles, setCompanyArticles] = useState([])
  const [companyArticlesLoading, setCompanyArticlesLoading] = useState(false)

  const handleAddCompany = async (name) => {
    if (addedSet.has(name)) return
    const { data: { session: wlSession } } = await supabase.auth.getSession()
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wlSession?.access_token}` },
      body: JSON.stringify({ identifier: name, type: 'company' })
    })
    setAddedSet(prev => new Set([...prev, name]))
  }

  const handleSelectCompany = async (company) => {
    setSelectedCompany(company)
    setCompanyArticlesLoading(true)
    const { data } = await supabase
      .from('articles')
      .select('*')
      .order('ingested_at', { ascending: false })
      .limit(500)
    if (data) {
      const matched = data.filter(a => {
        let cos = a.companies
        if (typeof cos === 'string') { try { cos = JSON.parse(cos) } catch { cos = [] } }
        if (!Array.isArray(cos)) return false
        return cos.some(c => c === company.name)
      }).slice(0, 30)
      setCompanyArticles(matched)
    }
    setCompanyArticlesLoading(false)
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('articles').select('companies, sector').order('ingested_at', { ascending: false }).limit(200)
      if (data) {
        const map = {}
        data.forEach(a => {
          let cos = a.companies
          if (typeof cos === 'string') { try { cos = JSON.parse(cos) } catch { cos = [] } }
          if (!Array.isArray(cos)) return
          cos.forEach(c => {
            if (!c || c.length < 2) return
            if (!map[c]) map[c] = { name: c, mentions: 0, sectors: new Set() }
            map[c].mentions++
            if (a.sector) map[c].sectors.add(a.sector)
          })
        })
        setCompanies(Object.values(map).sort((a, b) => b.mentions - a.mentions).map(c => ({ ...c, sectors: Array.from(c.sectors) })))
      }
      setLoading(false)
    }
    load()
  }, [])
  const filtered = companies.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '14px' }}>🏢 COMPANY INTEL</div>
      <input type="text" placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', padding: '9px 15px', fontSize: '13px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none', marginBottom: '18px' }} />
      {loading ? <div style={{ padding: '20px 0' }}><SkeletonRows rows={6} /></div>
        : filtered.length === 0 ? <EmptyState icon={EMPTY_ICONS.grid} title={search ? 'No matching companies' : 'No data yet'} subtitle={search ? 'Try a different search term' : 'Companies will appear as articles are ingested'} />
        : (<>
          {/* Note: company count differs from deal count — sourced from different Supabase queries */}
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', marginBottom: '14px' }}>{filtered.length} COMPANIES TRACKED</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '9px' }}>
            {filtered.slice(0, 60).map((c, i) => {
              const color = c.sectors[0] ? getSectorColor(c.sectors[0]) : '#64748b'
              const isAdded = addedSet.has(c.name)
              return (
                <div key={i}
                  onClick={() => handleSelectCompany(c)}
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '13px 15px', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-hover-bg)'; e.currentTarget.style.borderColor = 'var(--card-hover-border)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--card-bg)'; e.currentTarget.style.borderColor = 'var(--card-border)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '15px', fontWeight: 600, color: 'var(--heading)' }}>{c.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' }}>{c.mentions}×</span>
                      <button onClick={e => { e.stopPropagation(); handleAddCompany(c.name) }} style={{ background: 'none', border: 'none', cursor: isAdded ? 'default' : 'pointer', color: '#f59e0b', fontFamily: "'DM Mono', monospace", fontSize: '11px', padding: '1px 3px', flexShrink: 0, lineHeight: 1 }}>{isAdded ? '✓' : '+'}</button>
                    </div>
                  </div>
                  {c.sectors[0] && <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color, background: color + '15', border: `1px solid ${color}28`, padding: '1px 6px', borderRadius: '3px' }}>{c.sectors[0].split(' ')[0]}</span>}
                </div>
              )
            })}
          </div>
        </>)}

      {selectedCompany && (
        <div style={{ position: 'fixed', top: '32px', right: 0, width: '480px', height: 'calc(100vh - 32px)', background: 'var(--sidebar-bg)', borderLeft: '1px solid var(--input-border)', zIndex: 200, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
          {/* Panel header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--card-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '20px', fontWeight: 600, color: 'var(--heading)' }}>{selectedCompany.name}</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' }}>{selectedCompany.mentions}×</span>
            </div>
            <button onClick={() => setSelectedCompany(null)} style={{ background: 'none', border: 'none', color: 'var(--secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          {/* Panel body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {companyArticlesLoading ? (
              <div style={{ padding: '20px 0' }}><SkeletonCard height="80px" count={3} /></div>
            ) : (
              <>
                {selectedCompany.sectors.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
                    {selectedCompany.sectors.map((s, i) => <SectorPill key={i} sector={s} />)}
                  </div>
                )}
                <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.12em', marginBottom: '12px' }}>
                  ARTICLES MENTIONING {selectedCompany.name.toUpperCase()}
                </div>
                {companyArticles.length > 0
                  ? companyArticles.map(a => <ArticleCard key={a.id} article={a} />)
                  : <EmptyState icon={EMPTY_ICONS.newspaper} title="No articles found" subtitle="No recent articles mention this company" />
                }
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Trends ────────────────────────────────────────────────────────────────────
function Trends() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('articles')
        .select('sector, sentiment, companies, ingested_at, published_at')
        .order('ingested_at', { ascending: false })
        .limit(500)
      if (data) setArticles(data)
      setLoading(false)
    }
    load()
  }, [])

  // Split into last-24h vs prior-24h
  const now     = Date.now()
  const h24     = now - 24 * 60 * 60 * 1000
  const h48     = now - 48 * 60 * 60 * 1000
  const recent  = articles.filter(a => new Date(a.ingested_at || a.published_at) >= h24)
  const prior   = articles.filter(a => { const t = new Date(a.ingested_at||a.published_at); return t >= h48 && t < h24 })

  // Sector momentum
  const sectorRecent = {}, sectorPrior = {}, sectorSentRecent = {}, sectorSentPrior = {}
  const sentScore = s => {
    const l = (s||'').toLowerCase()
    if (l === 'bullish' || l === 'positive') return 1
    if (l === 'bearish' || l === 'negative') return -1
    return 0
  }
  articles.forEach(a => {
    if (!a.sector) return
    const isRecent = new Date(a.ingested_at||a.published_at) >= h24
    const bucket   = isRecent ? sectorRecent : sectorPrior
    bucket[a.sector] = (bucket[a.sector] || 0) + 1
    const sBucket  = isRecent ? sectorSentRecent : sectorSentPrior
    if (!sBucket[a.sector]) sBucket[a.sector] = []
    sBucket[a.sector].push(sentScore(a.sentiment))
  })

  const avgSent = obj => {
    const scores = obj || []
    if (!scores.length) return 0
    return scores.reduce((s, v) => s + v, 0) / scores.length
  }

  const allSectors = Array.from(new Set(articles.map(a => a.sector).filter(Boolean)))
  const sectorStats = allSectors.map(s => {
    const r  = sectorRecent[s] || 0
    const p  = sectorPrior[s]  || 0
    const momentum = p === 0 ? (r > 0 ? 100 : 0) : Math.round(((r - p) / p) * 100)
    const sentNow  = avgSent(sectorSentRecent[s])
    const sentPrev = avgSent(sectorSentPrior[s])
    const sentShift = sentNow - sentPrev
    return { sector: s, recent: r, prior: p, total: (sectorRecent[s]||0) + (sectorPrior[s]||0), momentum, sentNow, sentShift }
  }).sort((a, b) => b.recent - a.recent)

  const maxRecent = Math.max(...sectorStats.map(s => s.recent), 1)

  // Top company movers: mentions in last 24h vs prior 24h
  const compRecent = {}, compPrior = {}
  const parseCompanies = a => {
    let cos = a.companies
    if (typeof cos === 'string') { try { cos = JSON.parse(cos) } catch { cos = [] } }
    return Array.isArray(cos) ? cos : []
  }
  recent.forEach(a => parseCompanies(a).forEach(c => { if (c) compRecent[c] = (compRecent[c]||0)+1 }))
  prior.forEach(a  => parseCompanies(a).forEach(c => { if (c) compPrior[c]  = (compPrior[c] ||0)+1 }))

  const movers = Object.keys({ ...compRecent, ...compPrior })
    .map(c => ({
      name:     c,
      recent:   compRecent[c] || 0,
      prior:    compPrior[c]  || 0,
      delta:    (compRecent[c]||0) - (compPrior[c]||0),
      pct:      compPrior[c] ? Math.round(((compRecent[c]||0) - compPrior[c]) / compPrior[c] * 100) : (compRecent[c] > 0 ? 100 : 0)
    }))
    .filter(m => m.recent > 0)
    .sort((a, b) => b.recent - a.recent || b.delta - a.delta)
    .slice(0, 8)

  const sentLabel = score => {
    if (score >  0.25) return { label: 'BULLISH',  color: '#4ade80' }
    if (score < -0.25) return { label: 'BEARISH',  color: '#f87171' }
    return                    { label: 'NEUTRAL',  color: '#94a3b8' }
  }
  const shiftLabel = delta => {
    if (delta >  0.2) return { label: '▲ IMPROVING', color: '#4ade80' }
    if (delta < -0.2) return { label: '▼ WORSENING', color: '#f87171' }
    return                   { label: '— STABLE',    color: '#94a3b8' }
  }

  if (loading) return (
    <div style={{ padding: '20px 0' }}><SkeletonCard height="100px" count={3} /></div>
  )

  return (
    <div>
      <div style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:'#f59e0b', letterSpacing:'0.14em', marginBottom:'4px' }}>📈 SIGNAL TRENDS</div>
      <p style={{ fontSize:'12px', fontFamily:"'DM Mono', monospace", color:'var(--tertiary)', marginBottom:'24px' }}>
        {articles.length} articles · last 24h vs prior 24h
      </p>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px', alignItems:'start' }}>
      {/* Top Company Movers */}
      <div>
        <div style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:'var(--tertiary)', letterSpacing:'0.14em', marginBottom:'10px' }}>TOP COMPANY MOVERS · LAST 24H</div>
        {movers.length === 0
          ? <EmptyState icon={EMPTY_ICONS.trending} title="Not enough data yet" subtitle="Check back after the next ingest cycle" />
          : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(185px, 1fr))', gap:'8px' }}>
              {movers.map((m, i) => (
                <div key={i} style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:'8px', padding:'12px 14px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
                    <span style={{ fontFamily:"'Cormorant Garamond', serif", fontSize:'15px', fontWeight:600, color:'var(--heading)', lineHeight:1.2 }}>{m.name}</span>
                    <span style={{ fontFamily:"'DM Mono', monospace", fontSize:'11px', color: m.delta >= 0 ? '#4ade80' : '#f87171', flexShrink:0, marginLeft:'6px' }}>
                      {m.delta > 0 ? '+' : ''}{m.delta}
                    </span>
                  </div>
                  <div style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:'var(--tertiary)' }}>
                    {m.recent} mentions today · {m.prior} prior
                  </div>
                  {m.prior > 0 && (
                    <div style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color: m.pct >= 0 ? '#4ade80' : '#f87171', marginTop:'3px' }}>
                      {m.pct > 0 ? '▲' : '▼'} {Math.abs(m.pct)}% vs yesterday
                    </div>
                  )}
                </div>
              ))}
            </div>
        }
      </div>

      {/* Sector Momentum + Sentiment Shift */}
      <div>
        <div style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:'var(--tertiary)', letterSpacing:'0.14em', marginBottom:'12px' }}>SECTOR MOMENTUM</div>
        {sectorStats.map(s => {
          const color   = getSectorColor(s.sector)
          const sent    = sentLabel(s.sentNow)
          const shift   = shiftLabel(s.sentShift)
          const momColor = s.momentum > 0 ? '#4ade80' : s.momentum < 0 ? '#f87171' : '#94a3b8'
          return (
            <div key={s.sector} style={{ marginBottom:'16px', background:'var(--card-bg-subtle)', border:'1px solid var(--divider)', borderRadius:'8px', padding:'14px 16px' }}>
              {/* Top row */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                <span style={{ fontFamily:"'DM Mono', monospace", fontSize:'11px', color:'var(--body)' }}>{s.sector}</span>
                <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                  <span style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:sent.color, background:sent.color+'15', border:`1px solid ${sent.color}30`, padding:'2px 7px', borderRadius:'3px' }}>{sent.label}</span>
                  <span style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:shift.color }}>{shift.label}</span>
                </div>
              </div>
              {/* Bar */}
              <div style={{ height:'4px', background:'var(--card-hover-bg)', borderRadius:'3px', overflow:'hidden', marginBottom:'8px' }}>
                <div style={{ height:'100%', width:`${(s.recent / maxRecent) * 100}%`, background:`linear-gradient(to right, ${color}60, ${color})`, borderRadius:'3px', transition:'width 0.4s ease' }} />
              </div>
              {/* Stats row */}
              <div style={{ display:'flex', gap:'16px' }}>
                <span style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:'var(--tertiary)' }}>{s.recent} stories today</span>
                <span style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:'var(--faint)' }}>{s.prior} yesterday</span>
                <span style={{ fontSize:'10px', fontFamily:"'DM Mono', monospace", color:momColor, marginLeft:'auto' }}>
                  {s.momentum > 0 ? '▲' : s.momentum < 0 ? '▼' : '—'} {Math.abs(s.momentum)}% {s.momentum > 0 ? 'MORE' : s.momentum < 0 ? 'LESS' : 'SAME'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}

// ── Nav ───────────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'morning',   label: 'Morning Review', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> },
  { id: 'live',      label: 'Live Tracker',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { id: 'evening',   label: 'Evening Wrap',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> },
  { id: 'dealflow',  label: 'Deal Flow',      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> },
  { id: 'thesis',    label: 'Thesis Board',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> },
  { id: 'companies', label: 'Company Intel',  icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg> },
  { id: 'trends',    label: 'Trends',         icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
  { id: 'watchlist',    label: 'Watchlist',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> },
  { id: 'preferences', label: 'Preferences',  icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> },
]

// ── App ───────────────────────────────────────────────────────────────────────
export default function Home() {
  const { theme, toggleTheme } = useTheme()
  const [themeRotate, setThemeRotate] = useState(false)
  const [activeTab, setActiveTab] = useState('morning')
  const [quotes, setQuotes] = useState([])
  const [marketTime, setMarketTime] = useState('')
  const [marketOpen, setMarketOpen] = useState(null)
  const [todayStr, setTodayStr] = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [watchlistLoading, setWatchlistLoading] = useState(true)
  const [watchlistInput, setWatchlistInput] = useState('')
  const [watchlistType, setWatchlistType] = useState('ticker')
  const [watchlistError, setWatchlistError] = useState('')
  const [watchlistMatches, setWatchlistMatches] = useState([])
  const [watchlistBadge, setWatchlistBadge] = useState(0)
  const [watchlistPrices, setWatchlistPrices] = useState({})
  const [watchlistPricesLoading, setWatchlistPricesLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    async function loadQuotes() {
      try {
        const res = await fetch('/api/quotes')
        const data = await res.json()
        if (data.quotes?.length) setQuotes(data.quotes)
      } catch (e) { console.error(e) }
    }
    loadQuotes()
    const t = setInterval(loadQuotes, 90000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const update = () => setMarketTime(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date()))
    update()
    const t = setInterval(update, 10000)
    return () => clearInterval(t)
  }, [])

  const isMarketOpen = () => {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes()
    return d >= 1 && d <= 5 && m >= 570 && m <= 960
  }

  useEffect(() => {
    setMarketOpen(isMarketOpen())
    const t = setInterval(() => setMarketOpen(isMarketOpen()), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setTodayStr(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\//g, '-'))
  }, [])

  const refreshWatchlist = useCallback(async () => {
    const { data: { session: wlSession } } = await supabase.auth.getSession()
    const res = await fetch('/api/watchlist', { headers: { Authorization: `Bearer ${wlSession?.access_token}` } })
    const { entries } = await res.json()
    const newEntries = entries || []
    setWatchlist(newEntries)
    const tickers = newEntries.filter(e => e.type === 'ticker').map(e => e.identifier)
    if (tickers.length > 0) {
      setWatchlistPricesLoading(true)
      fetch(`/api/watchlist-quotes?symbols=${tickers.join(',')}`)
        .then(r => r.json())
        .then(d => { if (d.quotes) setWatchlistPrices(d.quotes) })
        .catch(() => {})
        .finally(() => setWatchlistPricesLoading(false))
    }
    if (newEntries.length > 0) {
      const identifiers = newEntries.map(e => e.identifier.toLowerCase())
      const { data: articles } = await supabase
        .from('articles')
        .select('id, title, source, sector, published_at, ingested_at, summary, companies')
        .order('relevance_score', { ascending: false })
        .limit(50)
      if (articles) {
        const matched = articles.filter(a => {
          const title = (a.title || '').toLowerCase()
          const summary = (a.summary || '').toLowerCase()
          let cos = a.companies
          if (typeof cos === 'string') { try { cos = JSON.parse(cos) } catch { cos = [] } }
          const compStr = Array.isArray(cos) ? cos.map(c => c.toLowerCase()).join(' ') : ''
          return identifiers.some(ident => title.includes(ident) || summary.includes(ident) || compStr.includes(ident))
        })
        setWatchlistMatches(matched.slice(0, 20))
      }
    } else {
      setWatchlistMatches([])
    }
    setWatchlistLoading(false)
  }, [])

  useEffect(() => {
    if (activeTab !== 'watchlist') return
    setWatchlistLoading(true)
    refreshWatchlist().then(() => setWatchlistBadge(0))
  }, [activeTab, refreshWatchlist])

  useEffect(() => {
    async function loadBadge() {
      try {
        const { data: { session: wlSession } } = await supabase.auth.getSession()
        const res = await fetch('/api/watchlist', { headers: { Authorization: `Bearer ${wlSession?.access_token}` } })
        const { entries } = await res.json()
        if (!entries || entries.length === 0) return
        const identifiers = entries.map(e => e.identifier.toLowerCase())
        const { data: articles } = await supabase
          .from('articles')
          .select('id, title, summary')
          .order('ingested_at', { ascending: false })
          .limit(50)
        if (articles) {
          const matched = articles.filter(a => {
            const title = (a.title || '').toLowerCase()
            const summary = (a.summary || '').toLowerCase()
            return identifiers.some(ident => title.includes(ident) || summary.includes(ident))
          })
          setWatchlistBadge(matched.length)
        }
      } catch (e) {}
    }
    loadBadge()
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      if (u && !localStorage.getItem(`ba_onboarded_${u.id}`)) setShowOnboarding(true)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u && !localStorage.getItem(`ba_onboarded_${u.id}`)) setShowOnboarding(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleWatchlistAdd() {
    const identifier = watchlistInput.trim()
    if (!identifier) return
    const { data: { session: wlSession } } = await supabase.auth.getSession()
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wlSession?.access_token}` },
      body: JSON.stringify({ identifier, type: watchlistType })
    })
    if (!res.ok) {
      const body = await res.json()
      setWatchlistError(body.error || 'Something went wrong.')
      return
    }
    setWatchlistError('')
    setWatchlistInput('')
    await refreshWatchlist()
  }

  async function handleWatchlistAddSector(sectorName) {
    const { data: { session: wlSession } } = await supabase.auth.getSession()
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wlSession?.access_token}` },
      body: JSON.stringify({ identifier: sectorName, type: 'sector' })
    })
    await refreshWatchlist()
  }

  async function handleWatchlistRemove(id) {
    const { data: { session: wlSession } } = await supabase.auth.getSession()
    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wlSession?.access_token}` },
      body: JSON.stringify({ id })
    })
    await refreshWatchlist()
  }

  if (authLoading) return null
  if (!user) return <SignedOutHomepage />

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg-primary); overflow: hidden; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
        @keyframes scrollTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-33.333%); } }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes emptyFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes contentFadeIn { from { opacity: 0; } to { opacity: 1; } }
        button:focus { outline: none; }
        button:active:not(:disabled) { transform: scale(0.97); }
        input::placeholder, textarea::placeholder { color: var(--placeholder); }
        input:focus, textarea:focus { border-color: rgba(245,158,11,0.35) !important; box-shadow: 0 0 0 2px rgba(245,158,11,0.08); }
        .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 16px; border-radius: 6px; border: none; border-left: 2px solid transparent; background: transparent; color: var(--text-mid); font-size: 12.5px; font-family: 'DM Mono', monospace; cursor: pointer; text-align: left; transition: all 0.15s ease; margin-bottom: 1px; }
        .nav-item:hover { background: var(--gold-glow); color: var(--text); }
        .nav-item:hover .nav-icon { color: var(--gold-bright); }
        .nav-item.nav-active { background: rgba(245,158,11,0.10); color: var(--gold-bright); border-left: 2px solid var(--gold-bright); }
        .nav-item.nav-active .nav-icon { color: var(--gold-bright); }
        .nav-icon { color: var(--text-dim); display: flex; align-items: center; flex-shrink: 0; transition: color 0.15s ease; }
        .sector-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .sector-row:hover .sector-label { color: var(--text-mid); }
        :root.light input::placeholder, :root.light textarea::placeholder { color: var(--text-dim); }
        :root.light ::-webkit-scrollbar-thumb { background: var(--border); }
        :root.light .nav-item { color: var(--text-mid); }
        :root.light .nav-item:hover { background: rgba(191,115,0,0.06); color: var(--text); }
        :root.light .nav-item.nav-active { background: rgba(191,115,0,0.08); color: var(--accent); border-left-color: var(--accent); }
      `}</style>

      <TickerBar quotes={quotes} />

      <div style={{ display: 'flex', height: 'calc(100vh - 32px)' }}>
        {/* Sidebar */}
        <div style={{ width: '232px', flexShrink: 0, background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '21px', fontWeight: 700 }}>
              <span style={{ color: 'var(--heading)' }}>Breaking</span><span style={{ color: '#f59e0b' }}>Alpha</span>
            </div>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.15em', marginTop: '3px' }}>MARKET INTELLIGENCE</div>
          </div>
          <nav style={{ padding: '10px 10px' }}>
            {NAV.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} className={`nav-item${activeTab === item.id ? ' nav-active' : ''}`}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.id === 'live' && <span style={{ marginLeft: 'auto', width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite', flexShrink: 0 }} />}
                {item.id === 'watchlist' && watchlistBadge > 0 && <span style={{ marginLeft: 'auto', background: '#f59e0b', color: '#000', fontSize: '9px', fontFamily: "'DM Mono', monospace", fontWeight: 700, padding: '1px 5px', borderRadius: '8px', flexShrink: 0 }}>{watchlistBadge}</span>}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
              <AuthButton />
            </div>
          </nav>
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--divider)' }}>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.12em', marginBottom: '10px' }}>SECTORS TRACKED</div>
            {SIDEBAR_SECTORS.map(s => (
              <div key={s.name} className="sector-row">
                <div style={{ width: '3px', height: '3px', borderRadius: '1px', background: s.color, flexShrink: 0 }} />
                <span className="sector-label" style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', transition: 'color 0.15s ease' }}>{s.name}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--divider)' }}>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', letterSpacing: '0.12em', marginBottom: '6px' }}>MARKET TIME</div>
            <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', lineHeight: 1.6 }}>{marketTime || '—'}</div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: marketOpen ? '#4ade80' : '#f87171', animation: 'pulse 2s infinite', flexShrink: 0 }} />
              <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: marketOpen ? '#4ade80' : '#f87171', letterSpacing: '0.1em' }}>US EQUITIES {marketOpen ? 'OPEN' : 'CLOSED'}</span>
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 30px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--topbar-bg)', backdropFilter: 'blur(12px)', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.16em' }}>
              {NAV.find(n => n.id === activeTab)?.icon} {NAV.find(n => n.id === activeTab)?.label.toUpperCase()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)' }}>{todayStr}</span>
              <button
                onClick={() => { setThemeRotate(true); toggleTheme(); setTimeout(() => setThemeRotate(false), 350) }}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', padding: '5px 7px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 150ms ease' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold-bright)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: 'transform 300ms ease', transform: themeRotate ? 'rotate(360deg)' : 'rotate(0deg)' }}>
                  {theme === 'dark' ? (
                    <>
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </>
                  ) : (
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  )}
                </svg>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#4ade80', letterSpacing: '0.1em' }}>LIVE</span>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '30px' }}>
            <div key={activeTab} style={{ animation: 'contentFadeIn 200ms ease' }}>
              {activeTab === 'morning'   && <BriefView type="morning" />}
              {activeTab === 'live'      && <LiveTracker />}
              {activeTab === 'evening'   && <BriefView type="evening" />}
              {activeTab === 'dealflow'  && <DealFlowTracker />}
              {activeTab === 'thesis'    && <ThesisBoard />}
              {activeTab === 'companies' && <CompanyIntel />}
              {activeTab === 'trends'    && <Trends />}
              {activeTab === 'preferences' && <PreferencesPanel user={user} />}
              {activeTab === 'watchlist' && (
                <div>
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '4px' }}>⭐ WATCHLIST</div>
                    <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', margin: 0 }}>Track companies, tickers, and sectors. Articles matching your watchlist are boosted in relevance.</p>
                  </div>

                  <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="e.g. NVDA, Anthropic, Private Equity"
                        value={watchlistInput}
                        onChange={e => { setWatchlistInput(e.target.value); setWatchlistError('') }}
                        onKeyDown={e => { if (e.key === 'Enter' && watchlistInput.trim()) handleWatchlistAdd() }}
                        style={{ flex: 1, minWidth: '200px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'var(--heading)', outline: 'none' }}
                      />
                      <button onClick={handleWatchlistAdd} style={{ padding: '8px 18px', borderRadius: '6px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: '1px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', letterSpacing: '0.06em', flexShrink: 0 }}>ADD</button>
                    </div>
                    {watchlistError && <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#f87171', marginTop: '6px' }}>{watchlistError}</div>}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {['ticker', 'company', 'sector'].map(t => (
                        <button key={t} onClick={() => setWatchlistType(t)} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: `1px solid ${watchlistType === t ? '#f59e0b' : 'var(--input-border)'}`, background: watchlistType === t ? 'rgba(245,158,11,0.12)' : 'transparent', color: watchlistType === t ? '#f59e0b' : 'var(--tertiary)' }}>{t.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.14em', marginBottom: '8px' }}>QUICK ADD SECTOR</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {SIDEBAR_SECTORS.map(s => {
                        const isTracked = watchlist.some(e => e.identifier.toLowerCase() === s.name.toLowerCase())
                        return (
                          <button key={s.name} onClick={() => !isTracked && handleWatchlistAddSector(s.name)} style={{ padding: '4px 11px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: isTracked ? 'default' : 'pointer', border: `1px solid ${isTracked ? 'var(--card-hover-bg)' : s.color + '40'}`, background: isTracked ? 'transparent' : s.color + '12', color: isTracked ? 'var(--faint)' : s.color, opacity: isTracked ? 0.5 : 1 }}>{s.name}{isTracked ? ' ✓' : ''}</button>
                        )
                      })}
                    </div>
                  </div>

                  <div style={{ marginBottom: '28px' }}>
                    <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.14em', marginBottom: '10px' }}>TRACKING ({watchlist.length})</div>
                    {watchlistLoading ? (
                      <div style={{ padding: '10px 0' }}><SkeletonRows rows={3} /></div>
                    ) : watchlist.length === 0 ? (
                      <EmptyState icon={EMPTY_ICONS.bookmark} title="Nothing tracked yet" subtitle="Add a ticker, company, or sector above to start tracking" />
                    ) : watchlist.map(entry => (
                      <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', background: 'var(--card-bg-subtle)', border: '1px solid var(--divider)', borderRadius: '6px', marginBottom: '6px' }}>
                        <span style={{ flex: 1, fontFamily: "'DM Mono', monospace", fontSize: '13px', color: 'var(--heading)' }}>{entry.identifier}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          {mounted && entry.type === 'ticker' && watchlistPrices[entry.identifier] && (
                            <span style={{
                              fontSize: '12px',
                              color: watchlistPrices[entry.identifier].pct >= 0 ? '#22c55e' : '#ef4444',
                              fontVariantNumeric: 'tabular-nums',
                              fontFamily: "'DM Mono', monospace",
                              letterSpacing: '0.01em',
                              whiteSpace: 'nowrap'
                            }}>
                              ${watchlistPrices[entry.identifier].price} {watchlistPrices[entry.identifier].pct >= 0 ? '+' : ''}{watchlistPrices[entry.identifier].pct}%
                            </span>
                          )}
                          <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', padding: '2px 5px', borderRadius: '3px', flexShrink: 0 }}>
                            {(entry.type || '').toUpperCase()}
                          </span>
                          <button onClick={() => handleWatchlistRemove(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tertiary)', fontSize: '16px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {watchlist.length > 0 && (
                    <div>
                      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)', letterSpacing: '0.14em', marginBottom: '10px' }}>WATCHLIST FEED ({watchlistMatches.length})</div>
                      {watchlistMatches.length === 0 ? (
                        <EmptyState icon={EMPTY_ICONS.newspaper} title="No matching articles yet" subtitle="Recent articles matching your watchlist will appear here" />
                      ) : watchlistMatches.map(a => {
                        const timestamp = a.published_at || a.ingested_at
                        return (
                          <div key={a.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                {a.sector && <SectorPill sector={a.sector} />}
                                {a.source && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--tertiary)' }}>{a.source}</span>}
                              </div>
                              {timestamp && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'var(--faint)', flexShrink: 0 }}>{timeAgo(timestamp)}</span>}
                            </div>
                            <div style={{ fontSize: '15px', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: 'var(--heading)', lineHeight: 1.4 }}>{a.title}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {showOnboarding && user && (
        <OnboardingModal user={user} onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}
