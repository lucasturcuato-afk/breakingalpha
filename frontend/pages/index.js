import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const SECTORS = [
  { key: 'ALL',    label: 'ALL',         value: null,                                  color: '#f59e0b' },
  { key: 'tech',   label: 'TECH M&A',    value: 'Technology M&A & Investment Banking', color: '#f59e0b' },
  { key: 'vc',     label: 'VENTURE',     value: 'Venture Capital & Startup Funding',   color: '#8b5cf6' },
  { key: 'pe',     label: 'PRIVATE EQ',  value: 'Private Equity & Buyouts',            color: '#3b82f6' },
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

const DEAL_STAGES = [
  { value: 'rumored',    label: 'RUMORED',    color: '#94a3b8' },
  { value: 'announced',  label: 'ANNOUNCED',  color: '#fbbf24' },
  { value: 'loi',        label: 'UNDER LOI',  color: '#f97316' },
  { value: 'diligence',  label: 'DILIGENCE',  color: '#8b5cf6' },
  { value: 'signed',     label: 'SIGNED',     color: '#3b82f6' },
  { value: 'closed',     label: 'CLOSED',     color: '#4ade80' },
  { value: 'dead',       label: 'DEAD',       color: '#f87171' },
]

const DEAL_TYPES = ['M&A', 'LBO', 'IPO', 'VC Round', 'SPAC', 'Recap', 'Minority Stake', 'Other']

function getSectorColor(sector) {
  if (!sector) return '#64748b'
  const found = SECTORS.find(s => s.value && sector.includes(s.value.split(' ')[0]))
  return found?.color || '#64748b'
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function stageInfo(val) {
  return DEAL_STAGES.find(s => s.value === val) || DEAL_STAGES[0]
}

// ── Ticker Bar ──────────────────────────────────────────────────────────────
function TickerBar({ quotes }) {
  if (!quotes || quotes.length === 0) return (
    <div style={{ background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em' }}>FETCHING MARKET DATA...</span>
    </div>
  )
  const items = [...quotes, ...quotes, ...quotes]
  return (
    <div style={{ background: 'rgba(0,0,0,0.7)', borderBottom: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', height: '32px', display: 'flex', alignItems: 'center', position: 'relative', width: '100%' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40px', background: 'linear-gradient(to right, #080c18, transparent)', zIndex: 2 }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40px', background: 'linear-gradient(to left, #080c18, transparent)', zIndex: 2 }} />
      <div style={{ display: 'flex', animation: 'scrollTicker 60s linear infinite', whiteSpace: 'nowrap', willChange: 'transform' }}>
        {items.map((q, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '0 20px', fontSize: '11px', fontFamily: "'DM Mono', monospace", borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <span style={{ color: 'rgba(255,255,255,0.32)', fontSize: '10px' }}>{q.symbol}</span>
            <span style={{ color: '#fff', fontWeight: 500 }}>{q.price}</span>
            <span style={{ color: q.pct >= 0 ? '#4ade80' : '#f87171', fontSize: '10px' }}>{q.pct >= 0 ? '▲' : '▼'} {Math.abs(q.pct).toFixed(2)}%</span>
          </span>
        ))}
      </div>
      <style>{`@keyframes scrollTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-33.333%); } }`}</style>
    </div>
  )
}

// ── Sector Pill ─────────────────────────────────────────────────────────────
function SectorPill({ sector }) {
  const color = getSectorColor(sector)
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em', color, background: color + '18', border: `1px solid ${color}38` }}>
      {sector}
    </span>
  )
}

// ── Article Card ─────────────────────────────────────────────────────────────
function ArticleCard({ article }) {
  const [expanded, setExpanded] = useState(false)
  let companies = article.companies
  if (typeof companies === 'string') { try { companies = JSON.parse(companies) } catch { companies = [] } }
  if (!Array.isArray(companies)) companies = []
  const timestamp = article.published_at || article.ingested_at

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '16px 20px', cursor: 'pointer', marginBottom: '8px', transition: 'background 0.15s, border-color 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.052)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {article.sector && <SectorPill sector={article.sector} />}
          {article.source && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)' }}>{article.source}</span>}
        </div>
        {timestamp && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)', flexShrink: 0 }}>{timeAgo(timestamp)}</span>}
      </div>
      <h3 style={{ fontSize: '15.5px', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: '#f1f5f9', lineHeight: 1.4, margin: 0 }}>{article.title}</h3>
      {expanded && (
        <div style={{ marginTop: '12px' }}>
          {article.summary && <p style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.58)', lineHeight: 1.72, margin: '0 0 14px 0' }}>{article.summary}</p>}
          {article.relevance_reason && (
            <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '6px', padding: '10px 14px', marginBottom: '12px' }}>
              <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#fbbf24', letterSpacing: '0.12em', marginBottom: '4px' }}>SIGNAL</div>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.68)', margin: 0, lineHeight: 1.5 }}>{article.relevance_reason}</p>
            </div>
          )}
          {companies.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
              {companies.map((c, i) => <span key={i} style={{ padding: '2px 9px', borderRadius: '4px', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>{c}</span>)}
            </div>
          )}
          {article.url && <a href={article.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#60a5fa', textDecoration: 'none' }}>READ SOURCE →</a>}
        </div>
      )}
      <div style={{ marginTop: '7px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.18)' }}>{expanded ? '↑ collapse' : '↓ expand'}</div>
    </div>
  )
}

// ── Brief View ───────────────────────────────────────────────────────────────
function BriefView({ type }) {
  const [briefing, setBriefing] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [sectorCounts, setSectorCounts] = useState({})

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: bData } = await supabase.from('briefings').select('*').eq('briefing_type', type).order('created_at', { ascending: false }).limit(1)
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '28px', height: '28px', border: '2px solid rgba(255,255,255,0.08)', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.28)', letterSpacing: '0.12em' }}>LOADING INTEL...</div>
      </div>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em' }}>{type === 'morning' ? '☀ MORNING BRIEF' : '🌙 EVENING BRIEF'}</span>
        {briefing && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}>{new Date(briefing.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
      </div>
      {briefing ? (
        <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(139,92,246,0.04))', border: '1px solid rgba(245,158,11,0.18)', borderRadius: '12px', padding: '26px 30px', marginBottom: '28px' }}>
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '10px' }}>TODAY'S LEAD</div>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(22px, 2.8vw, 30px)', fontWeight: 700, color: '#f8fafc', lineHeight: 1.3, margin: '0 0 14px 0' }}>{briefing.headline}</h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.62)', lineHeight: 1.78, margin: 0 }}>{briefing.summary}</p>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '12px', padding: '44px', textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '30px', marginBottom: '12px' }}>{type === 'morning' ? '☀️' : '🌙'}</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '20px', color: 'rgba(255,255,255,0.35)', marginBottom: '8px' }}>No {type} brief yet</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.22)' }}>{type === 'morning' ? 'Publishes weekdays at 6:00 AM PT' : 'Publishes weekdays at 10:00 PM PT'}</div>
        </div>
      )}
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.12em', marginBottom: '10px' }}>TOP STORIES</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
        {SECTORS.map(s => {
          const count = s.key === 'ALL' ? articles.length : (sectorCounts[s.value] || 0)
          const isActive = sectorFilter === s.key
          return (
            <button key={s.key} onClick={() => setSectorFilter(s.key)} style={{ padding: '4px 11px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.12s', letterSpacing: '0.05em', outline: 'none', border: `1px solid ${isActive ? s.color : 'rgba(255,255,255,0.07)'}`, background: isActive ? s.color + '18' : 'transparent', color: isActive ? s.color : count > 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)' }}>
              {s.label}{count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.18)', marginBottom: '14px' }}>{filtered.length} {filtered.length === 1 ? 'STORY' : 'STORIES'}{sectorFilter !== 'ALL' && ` · ${activeSector?.label}`}</div>
      {filtered.length > 0
        ? filtered.map(a => <ArticleCard key={a.id} article={a} />)
        : <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>NO STORIES IN THIS SECTOR YET</div>}
    </div>
  )
}

// ── Thesis Board ─────────────────────────────────────────────────────────────
function ThesisBoard() {
  const THESES = [
    { title: 'AI Infrastructure Supercycle', signal: 'BULLISH', sectors: ['Technology M&A & Investment Banking'], thesis: 'Hyperscaler capex commitments ($300B+ in 2025) are creating durable demand for AI chips, data centers, and infrastructure software. NVDA, MSFT Azure, and custom silicon plays remain core positions. DeepSeek dynamics bear close monitoring for multiple compression risk.' },
    { title: 'Rate-Sensitive PE Dealflow Revival', signal: 'WATCH', sectors: ['Private Equity & Buyouts'], thesis: 'As the Fed signals rate normalization, LBO math improves materially. Watch for middle-market PE shops to re-activate deal pipelines in H2. Potential multiple compression in growth equity if cuts are delayed further.' },
    { title: 'Defense & Industrial Re-shoring', signal: 'BULLISH', sectors: ['Geopolitics & Macro', 'Energy & Climate'], thesis: 'NATO 2% GDP defense targets combined with IRA manufacturing credits are driving long-term capex into US industrials. LMT, RTX, NOC well-positioned. Defense tech VC (Anduril, Shield AI) activity accelerating.' },
    { title: 'Fintech Consolidation Wave', signal: 'WATCH', sectors: ['Fintech & Crypto', 'Technology M&A & Investment Banking'], thesis: 'Post-ZIRP valuation reset is creating compelling M&A opportunities. Legacy banks are acquiring fintech distribution. Traditional IB mandates emerging from consolidation wave.' },
    { title: 'Healthcare AI Commercialization', signal: 'BULLISH', sectors: ['Healthcare & Biotech'], thesis: 'FDA accelerating digital health approvals. Drug discovery AI (Recursion, Insilico) moving from hype to clinical trials. Vertical SaaS in EHR/RCM ripe for PE roll-up strategies with strong recurring revenue profiles.' },
  ]
  const SIG = { BULLISH: '#4ade80', BEARISH: '#f87171', WATCH: '#fbbf24', NEUTRAL: '#94a3b8' }
  return (
    <div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '6px' }}>📋 THESIS BOARD</div>
      <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', marginBottom: '22px' }}>Curated investment theses synthesized from BreakingAlpha signal flow</p>
      {THESES.map((t, i) => (
        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '20px 24px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '19px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>{t.title}</h3>
            <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: SIG[t.signal], background: SIG[t.signal] + '18', border: `1px solid ${SIG[t.signal]}40`, flexShrink: 0, marginLeft: '12px' }}>{t.signal}</span>
          </div>
          <p style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.52)', lineHeight: 1.68, margin: '0 0 14px 0' }}>{t.thesis}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{t.sectors.map((s, j) => <SectorPill key={j} sector={s} />)}</div>
        </div>
      ))}
    </div>
  )
}

// ── Company Intel ─────────────────────────────────────────────────────────────
function CompanyIntel() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

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
      <input type="text" placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '8px', padding: '9px 15px', fontSize: '13px', fontFamily: "'DM Mono', monospace", color: '#fff', outline: 'none', marginBottom: '18px' }} />
      {loading ? <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>LOADING...</div>
        : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>{search ? 'NO COMPANIES MATCH' : 'NO COMPANY DATA YET'}</div>
        : (
          <>
            <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.18)', marginBottom: '14px' }}>{filtered.length} COMPANIES TRACKED</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '9px' }}>
              {filtered.slice(0, 60).map((c, i) => {
                const color = c.sectors[0] ? getSectorColor(c.sectors[0]) : '#64748b'
                return (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '13px 15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '15px', fontWeight: 600, color: '#f1f5f9' }}>{c.name}</span>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' }}>{c.mentions}×</span>
                    </div>
                    {c.sectors[0] && <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color, background: color + '15', border: `1px solid ${color}28`, padding: '1px 6px', borderRadius: '3px' }}>{c.sectors[0].split(' ')[0]}</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}
    </div>
  )
}

// ── Trends ────────────────────────────────────────────────────────────────────
function Trends() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('articles').select('sector').order('ingested_at', { ascending: false }).limit(500)
      if (data) setArticles(data)
      setLoading(false)
    }
    load()
  }, [])

  const counts = {}
  articles.forEach(a => { if (a.sector) counts[a.sector] = (counts[a.sector] || 0) + 1 })
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] || 1

  return (
    <div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '6px' }}>📈 SIGNAL TRENDS</div>
      <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', marginBottom: '24px' }}>Story volume by sector · {articles.length} articles ingested</p>
      {loading ? <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>LOADING...</div>
        : sorted.map(([sector, count]) => {
          const color = getSectorColor(sector)
          return (
            <div key={sector} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.55)' }}>{sector}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color }}>{count} stories</span>
              </div>
              <div style={{ height: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: `linear-gradient(to right, ${color}70, ${color})`, borderRadius: '3px' }} />
              </div>
            </div>
          )
        })}
    </div>
  )
}

// ── Deal Flow Tracker (AI-automated) ─────────────────────────────────────────
const DEAL_STAGE_MAP = {
  rumored:   { label: 'RUMORED',    color: '#94a3b8' },
  announced: { label: 'ANNOUNCED',  color: '#fbbf24' },
  loi:       { label: 'UNDER LOI',  color: '#f97316' },
  diligence: { label: 'DILIGENCE',  color: '#8b5cf6' },
  signed:    { label: 'SIGNED',     color: '#3b82f6' },
  closed:    { label: 'CLOSED',     color: '#4ade80' },
  dead:      { label: 'DEAD',       color: '#f87171' },
}

function DealFlowTracker() {
  const [deals, setDeals]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [filterStage, setFilterStage] = useState('ALL')
  const [search, setSearch]         = useState('')
  const [expanded, setExpanded]     = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('deal_flow')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(200)
      if (data) setDeals(data)
      if (error) console.error('Deal flow error:', error)
      setLoading(false)
    }
    load()
  }, [])

  // Stage counts for filter tabs
  const stageCounts = {}
  deals.forEach(d => { stageCounts[d.stage] = (stageCounts[d.stage] || 0) + 1 })

  const filtered = deals.filter(d => {
    const stageMatch = filterStage === 'ALL' || d.stage === filterStage
    const searchMatch = !search || 
      d.company?.toLowerCase().includes(search.toLowerCase()) ||
      d.acquirer?.toLowerCase().includes(search.toLowerCase()) ||
      d.sector?.toLowerCase().includes(search.toLowerCase())
    return stageMatch && searchMatch
  })

  // Summary stats
  const totalVal = deals.filter(d => d.valuation).length
  const activeDeals = deals.filter(d => !['closed','dead'].includes(d.stage)).length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em', marginBottom: '4px' }}>💼 DEAL FLOW TRACKER</div>
        <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', margin: 0 }}>
          AI-extracted deal pipeline · auto-updated from news ingestion
        </p>
      </div>

      {/* Stats row */}
      {deals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '16px 0 20px' }}>
          {[
            { label: 'DEALS TRACKED', value: deals.length },
            { label: 'ACTIVE',        value: activeDeals },
            { label: 'CLOSED',        value: stageCounts['closed'] || 0 },
            { label: 'WITH VALUATION',value: totalVal },
          ].map((s, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: 700, color: '#f8fafc', marginBottom: '3px' }}>{s.value}</div>
              <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.12em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {deals.length > 0 && (
        <input
          type="text"
          placeholder="Search company, acquirer, sector..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '8px', padding: '9px 15px', fontSize: '12px', fontFamily: "'DM Mono', monospace", color: '#fff', outline: 'none', marginBottom: '14px' }}
        />
      )}

      {/* Stage filter tabs */}
      {deals.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <button onClick={() => setFilterStage('ALL')} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: `1px solid ${filterStage === 'ALL' ? '#f59e0b' : 'rgba(255,255,255,0.07)'}`, background: filterStage === 'ALL' ? 'rgba(245,158,11,0.12)' : 'transparent', color: filterStage === 'ALL' ? '#f59e0b' : 'rgba(255,255,255,0.38)' }}>
            ALL ({deals.length})
          </button>
          {Object.entries(DEAL_STAGE_MAP).map(([key, s]) => {
            const count = stageCounts[key] || 0
            if (!count) return null
            const isActive = filterStage === key
            return (
              <button key={key} onClick={() => setFilterStage(key)} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', border: `1px solid ${isActive ? s.color : 'rgba(255,255,255,0.07)'}`, background: isActive ? s.color + '18' : 'transparent', color: isActive ? s.color : 'rgba(255,255,255,0.38)' }}>
                {s.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '28px', height: '28px', border: '2px solid rgba(255,255,255,0.08)', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.28)', letterSpacing: '0.12em' }}>LOADING DEAL PIPELINE...</div>
          </div>
        </div>
      )}

      {/* Empty state — first run before table exists */}
      {!loading && deals.length === 0 && (
        <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(59,130,246,0.04))', border: '1px solid rgba(245,158,11,0.14)', borderRadius: '12px', padding: '32px', marginTop: '16px' }}>
          <div style={{ fontSize: '28px', marginBottom: '14px' }}>💼</div>
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', color: '#f8fafc', margin: '0 0 12px 0' }}>What is a Deal Flow Tracker?</h2>
          <p style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, margin: '0 0 18px 0' }}>
            In IB and PE, <strong style={{ color: 'rgba(255,255,255,0.8)' }}>deal flow</strong> is the pipeline of live transactions your firm is tracking — from early rumors through close. BreakingAlpha automatically extracts deals from every article it ingests using AI, classifying the target, deal type, stage, and valuation. Your pipeline builds itself.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px', marginBottom: '20px' }}>
            {[
              { icon: '🤖', title: 'Fully automated',    desc: 'AI scans every article and extracts deals — no manual input needed.' },
              { icon: '📊', title: 'Stage tracking',      desc: 'Rumored → Announced → LOI → Diligence → Signed → Closed.' },
              { icon: '💰', title: 'Valuation capture',   desc: 'Dollar figures extracted directly from the news, when reported.' },
              { icon: '⚡', title: 'Runs every ingest',   desc: 'Updated each morning and evening alongside your briefs.' },
            ].map((item, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '14px 16px' }}>
                <div style={{ fontSize: '18px', marginBottom: '8px' }}>{item.icon}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#f59e0b', marginBottom: '5px' }}>{item.title}</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.55 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.3)', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.07)' }}>
            ⚠ Pipeline populates after next scheduled ingest. See setup instructions below to create the <span style={{ color: '#f59e0b' }}>deal_flow</span> Supabase table and run the extractor.
          </div>
        </div>
      )}

      {/* Deal cards */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.18)', marginBottom: '6px' }}>
            {filtered.length} {filtered.length === 1 ? 'DEAL' : 'DEALS'}{filterStage !== 'ALL' ? ` · ${DEAL_STAGE_MAP[filterStage]?.label}` : ''}
          </div>
          {filtered.map(deal => {
            const stage     = DEAL_STAGE_MAP[deal.stage] || DEAL_STAGE_MAP.rumored
            const secColor  = deal.sector ? getSectorColor(deal.sector) : '#64748b'
            const isExpanded = expanded === deal.id
            return (
              <div key={deal.id}
                onClick={() => setExpanded(isExpanded ? null : deal.id)}
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '16px 20px', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
              >
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>{deal.company}</span>
                    {deal.acquirer && (
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>← {deal.acquirer}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                    {deal.valuation && (
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#fbbf24', fontWeight: 500 }}>{deal.valuation}</span>
                    )}
                    <span style={{ padding: '3px 9px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: stage.color, background: stage.color + '18', border: `1px solid ${stage.color}40` }}>
                      {stage.label}
                    </span>
                  </div>
                </div>
                {/* Meta row */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {deal.deal_type && (
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '3px' }}>{deal.deal_type}</span>
                  )}
                  {deal.sector && (
                    <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: secColor, background: secColor + '15', border: `1px solid ${secColor}28`, padding: '2px 8px', borderRadius: '3px' }}>
                      {deal.sector.split(' ')[0]}
                    </span>
                  )}
                  <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.18)' }}>
                    {timeAgo(deal.updated_at)}
                  </span>
                  {deal.auto_extracted && (
                    <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(245,158,11,0.4)', letterSpacing: '0.08em' }}>🤖 AI</span>
                  )}
                </div>
                {/* Expanded */}
                {isExpanded && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {deal.thesis && (
                      <div style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: '6px', padding: '10px 14px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#fbbf24', letterSpacing: '0.12em', marginBottom: '4px' }}>SIGNAL</div>
                        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', margin: 0, lineHeight: 1.55, fontStyle: 'italic' }}>{deal.thesis}</p>
                      </div>
                    )}
                    {deal.source_url && (
                      <a href={deal.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#60a5fa', textDecoration: 'none' }}>
                        READ SOURCE →
                      </a>
                    )}
                  </div>
                )}
                <div style={{ marginTop: '8px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.15)' }}>
                  {isExpanded ? '↑ collapse' : '↓ expand'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* No results for filter */}
      {!loading && deals.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>
          NO DEALS MATCH THIS FILTER
        </div>
      )}
    </div>
  )
}

// ── Nav ───────────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'morning',   label: 'Morning Brief',      icon: '☀️' },
  { id: 'evening',   label: 'Evening Brief',       icon: '🌙' },
  { id: 'thesis',    label: 'Thesis Board',        icon: '📋' },
  { id: 'dealflow',  label: 'Deal Flow',           icon: '💼' },
  { id: 'companies', label: 'Company Intel',       icon: '🏢' },
  { id: 'trends',    label: 'Trends',              icon: '📈' },
]

// ── App ───────────────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab] = useState('morning')
  const [quotes, setQuotes] = useState([])
  const [marketTime, setMarketTime] = useState('')

  useEffect(() => {
    async function loadQuotes() {
      try {
        const res = await fetch('/api/quotes')
        const data = await res.json()
        if (data.quotes?.length) setQuotes(data.quotes)
      } catch (e) { console.error('Quotes error:', e) }
    }
    loadQuotes()
    const t = setInterval(loadQuotes, 90000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const update = () => setMarketTime(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())
    )
    update()
    const t = setInterval(update, 10000)
    return () => clearInterval(t)
  }, [])

  const isMarketOpen = () => {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes()
    return d >= 1 && d <= 5 && m >= 570 && m <= 960
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080c18', color: '#f8fafc' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080c18; overflow: hidden; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
        button:focus { outline: none; }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.2); }
        select option { background: #0f172a; }
      `}</style>

      <TickerBar quotes={quotes} />

      <div style={{ display: 'flex', height: 'calc(100vh - 32px)' }}>
        {/* Sidebar */}
        <div style={{ width: '232px', flexShrink: 0, background: '#060a15', borderRight: '1px solid rgba(255,255,255,0.055)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <div style={{ padding: '22px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '21px', fontWeight: 700 }}>
              <span style={{ color: '#fff' }}>Breaking</span><span style={{ color: '#f59e0b' }}>Alpha</span>
            </div>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)', letterSpacing: '0.22em', marginTop: '3px' }}>MARKET INTELLIGENCE</div>
          </div>

          <nav style={{ padding: '14px 10px', flex: 1 }}>
            {NAV.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 11px', borderRadius: '6px', border: 'none', background: activeTab === item.id ? 'rgba(245,158,11,0.09)' : 'transparent', color: activeTab === item.id ? '#f59e0b' : 'rgba(255,255,255,0.42)', fontSize: '12.5px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', marginBottom: '1px', borderLeft: activeTab === item.id ? '2px solid #f59e0b' : '2px solid transparent' }}>
                <span>{item.icon}</span>
                {item.label}
                {activeTab === item.id && <span style={{ marginLeft: 'auto', width: '4px', height: '4px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />}
              </button>
            ))}
          </nav>

          <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.055)' }}>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)', letterSpacing: '0.18em', marginBottom: '10px' }}>SECTORS TRACKED</div>
            {SIDEBAR_SECTORS.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.32)' }}>{s.name}</span>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.055)' }}>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)', letterSpacing: '0.18em', marginBottom: '6px' }}>MARKET TIME</div>
            <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.38)', lineHeight: 1.6 }}>{marketTime || '—'}</div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isMarketOpen() ? '#4ade80' : '#f87171', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)', letterSpacing: '0.1em' }}>US EQUITIES {isMarketOpen() ? 'OPEN' : 'CLOSED'}</span>
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 30px', borderBottom: '1px solid rgba(255,255,255,0.055)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(8,12,24,0.97)', backdropFilter: 'blur(12px)', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.16em' }}>
              {NAV.find(n => n.id === activeTab)?.icon} {NAV.find(n => n.id === activeTab)?.label.toUpperCase()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)' }}>{new Date().toISOString().split('T')[0]}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#4ade80', letterSpacing: '0.1em' }}>LIVE</span>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '30px' }}>
            <div style={{ maxWidth: '860px' }}>
              {activeTab === 'morning'   && <BriefView type="morning" />}
              {activeTab === 'evening'   && <BriefView type="evening" />}
              {activeTab === 'thesis'    && <ThesisBoard />}
              {activeTab === 'dealflow'  && <DealFlowTracker />}
              {activeTab === 'companies' && <CompanyIntel />}
              {activeTab === 'trends'    && <Trends />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
