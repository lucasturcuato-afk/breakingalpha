import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import styles from './Dashboard.module.css'

// ── Conviction → color mapping (same as ThesisBoard) ─────────────────────────
const CONVICTION_COLORS = {
  BULLISH: '#16c25e',
  BEARISH: '#e83a3a',
  WATCH:   '#f0c040',
}

// ── Sector → color lookup (same as ThesisBoard / index.js) ───────────────────
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

// ── timeAgo — replicated from index.js ───────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard({ onNavigate, marketOpen }) {
  const [stats, setStats]       = useState({ articles: 0, deals: 0, theses: 0 })
  const [theses, setTheses]     = useState([])
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const [artCount, dealCount, thesisCount, recentArt, recentThesis] = await Promise.all([
        supabase.from('articles').select('*', { count: 'exact', head: true }),
        supabase.from('deal_flow').select('*', { count: 'exact', head: true }),
        supabase.from('theses').select('*', { count: 'exact', head: true }),
        supabase.from('articles')
          .select('title, sector, source, ingested_at, published_at')
          .order('ingested_at', { ascending: false })
          .limit(8),
        supabase.from('theses')
          .select('title, conviction, signal, sector, generated_at')
          .order('generated_at', { ascending: false })
          .limit(4),
      ])
      setStats({
        articles: artCount.count || 0,
        deals:    dealCount.count || 0,
        theses:   thesisCount.count || 0,
      })
      if (recentArt.data)    setArticles(recentArt.data)
      if (recentThesis.data) setTheses(recentThesis.data)
      setLoading(false)
    }
    load()
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>

      {/* ── Stats bar (36px) ── */}
      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.articles}</span>
          <span className={styles.statLabel}>ARTICLES</span>
        </div>
        <div className={styles.statDiv} />
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.deals}</span>
          <span className={styles.statLabel}>DEALS</span>
        </div>
        <div className={styles.statDiv} />
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.theses}</span>
          <span className={styles.statLabel}>THESES</span>
        </div>
        <div className={styles.statDiv} />
        <div className={styles.stat}>
          <span
            className={styles.statDot}
            style={{ background: marketOpen ? '#16c25e' : '#e83a3a' }}
          />
          <span
            className={styles.statLabel}
            style={{ color: marketOpen ? '#16c25e' : '#e83a3a' }}
          >
            US {marketOpen ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
      </div>

      {/* ── 12-column grid: 3 panels ── */}
      <div className={styles.grid}>

        {/* ── Left panel: recent theses (3 cols) ── */}
        <section className={styles.panelLeft}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>RECENT THESES</span>
          </div>

          {loading ? (
            <div className={styles.skeletonStack}>
              {[0, 1, 2].map(i => <div key={i} className={styles.skeleton} />)}
            </div>
          ) : theses.length === 0 ? (
            <div className={styles.empty}>No theses yet</div>
          ) : (
            <div className={styles.thesisList}>
              {theses.map((t, i) => {
                const conv  = t.conviction || t.signal
                const color = CONVICTION_COLORS[conv] || '#94a3b8'
                return (
                  <div
                    key={i}
                    className={styles.thesisItem}
                    style={{ borderLeftColor: color }}
                  >
                    <div className={styles.thesisTop}>
                      <span className={styles.thesisConv} style={{ color }}>{conv}</span>
                      <span className={styles.thesisTime}>{timeAgo(t.generated_at)}</span>
                    </div>
                    <div className={styles.thesisTitle}>{t.title}</div>
                    {t.sector && (
                      <span
                        className={styles.thesisSector}
                        style={{ color: getSectorColor(t.sector) }}
                      >
                        {t.sector.split(' ')[0]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <button className={styles.linkBtn} onClick={() => onNavigate('thesis')}>
            VIEW ALL THESES →
          </button>
        </section>

        {/* ── Center panel: live feed (6 cols) ── */}
        <section className={styles.panelCenter}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>LIVE FEED</span>
            <span className={styles.feedMeta}>{stats.articles} tracked</span>
          </div>

          {loading ? (
            <div className={styles.skeletonStack}>
              {[0, 1, 2, 3, 4].map(i => <div key={i} className={styles.skeletonWide} />)}
            </div>
          ) : articles.length === 0 ? (
            <div className={styles.empty}>No articles yet</div>
          ) : (
            <div className={styles.feedList}>
              {articles.map((a, i) => {
                const ts = a.published_at || a.ingested_at
                return (
                  <div key={i} className={styles.feedItem}>
                    <div className={styles.feedTop}>
                      <div className={styles.feedTags}>
                        {a.sector && (
                          <span
                            className={styles.feedSector}
                            style={{ color: getSectorColor(a.sector) }}
                          >
                            {a.sector.split(' ')[0]}
                          </span>
                        )}
                        {a.source && (
                          <span className={styles.feedSource}>{a.source}</span>
                        )}
                      </div>
                      <span className={styles.feedTime}>{timeAgo(ts)}</span>
                    </div>
                    <div className={styles.feedTitle}>{a.title}</div>
                  </div>
                )
              })}
            </div>
          )}

          <button className={styles.linkBtn} onClick={() => onNavigate('live')}>
            OPEN LIVE TRACKER →
          </button>
        </section>

        {/* ── Right panel: quick actions (3 cols) ── */}
        <section className={styles.panelRight}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>QUICK ACTIONS</span>
          </div>

          <div className={styles.actionList}>
            <button className={styles.actionBtn} onClick={() => onNavigate('morning')}>
              <span className={styles.actionIcon}>☀</span> Morning Review
            </button>
            <button className={styles.actionBtn} onClick={() => onNavigate('evening')}>
              <span className={styles.actionIcon}>☽</span> Evening Wrap
            </button>
            <button className={styles.actionBtn} onClick={() => onNavigate('dealflow')}>
              <span className={styles.actionIcon}>✦</span> Deal Memo
            </button>
            <button className={styles.actionBtn} onClick={() => onNavigate('thesis')}>
              <span className={styles.actionIcon}>⟳</span> Thesis Board
            </button>
            <button className={styles.actionBtn} onClick={() => onNavigate('companies')}>
              <span className={styles.actionIcon}>◫</span> Company Intel
            </button>
            <button className={styles.actionBtn} onClick={() => onNavigate('trends')}>
              <span className={styles.actionIcon}>↗</span> Signal Trends
            </button>
          </div>

          {/* ── Mini stats ── */}
          <div className={styles.sectionHeader} style={{ marginTop: 14 }}>
            <span className={styles.sectionTitle}>PIPELINE SNAPSHOT</span>
          </div>
          <div className={styles.miniStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniValue}>{stats.deals}</span>
              <span className={styles.miniLabel}>ACTIVE DEALS</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniValue}>{stats.theses}</span>
              <span className={styles.miniLabel}>AI THESES</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
