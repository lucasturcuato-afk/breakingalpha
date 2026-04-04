import { useState, useEffect, useMemo, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabaseClient'
import { AppShell } from '../components/shell'
import {
  SignalsHeader,
  SignalFilters,
  SignalsList,
  SignalsSummary,
} from '../components/signals'

function parseCompanies(raw) {
  if (!raw) return []
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return Array.isArray(raw) ? raw : []
}

/**
 * Derive signals from articles and theses.
 * No backend changes — purely client-side pattern detection.
 */
function deriveSignals(articles, theses) {
  const signals = []
  let id = 0

  // 1. Sentiment signals — strongly positive or negative recent articles
  articles.forEach(a => {
    const sentiment = String(a.sentiment || '').toLowerCase()
    if (sentiment === 'positive' || sentiment === 'bullish') {
      signals.push({
        id: `sent-pos-${id++}`,
        type: 'sentiment_positive',
        title: a.title,
        description: a.summary,
        sector: a.sector,
        companies: parseCompanies(a.companies),
        timestamp: a.ingested_at || a.published_at,
        url: a.url,
      })
    } else if (sentiment === 'negative' || sentiment === 'bearish') {
      signals.push({
        id: `sent-neg-${id++}`,
        type: 'sentiment_negative',
        title: a.title,
        description: a.summary,
        sector: a.sector,
        companies: parseCompanies(a.companies),
        timestamp: a.ingested_at || a.published_at,
        url: a.url,
      })
    }
  })

  // 2. Breaking signals — very recent articles (< 3 hours)
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
  articles.forEach(a => {
    const ts = new Date(a.ingested_at || a.published_at).getTime()
    if (ts > threeHoursAgo && !String(a.sentiment || '').toLowerCase().match(/positive|bullish|negative|bearish/)) {
      signals.push({
        id: `break-${id++}`,
        type: 'breaking',
        title: a.title,
        description: a.summary,
        sector: a.sector,
        companies: parseCompanies(a.companies),
        timestamp: a.ingested_at || a.published_at,
        url: a.url,
      })
    }
  })

  // 3. Volume spikes — companies mentioned in 3+ articles in the dataset
  const companyCount = {}
  articles.forEach(a => {
    const cos = parseCompanies(a.companies)
    cos.forEach(c => {
      companyCount[c] = (companyCount[c] || 0) + 1
    })
  })
  Object.entries(companyCount)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([company, count]) => {
      signals.push({
        id: `vol-${id++}`,
        type: 'volume',
        title: `${company} — ${count} mentions detected`,
        description: `This company appears in ${count} recent articles, indicating elevated activity.`,
        sector: null,
        companies: [company],
        timestamp: new Date().toISOString(),
        url: null,
      })
    })

  // 4. Thesis alerts — recent high-conviction theses
  theses.forEach(t => {
    const conviction = String(t.conviction || '').toUpperCase()
    if (conviction === 'BULLISH' || conviction === 'BEARISH') {
      signals.push({
        id: `thesis-${id++}`,
        type: 'thesis',
        title: t.title,
        description: t.rationale,
        sector: t.sector,
        companies: [],
        timestamp: t.generated_at,
        url: null,
      })
    }
  })

  // Sort by recency
  signals.sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime()
    const tb = new Date(b.timestamp || 0).getTime()
    return tb - ta
  })

  return signals
}

export default function SignalsPage() {
  const [articles, setArticles] = useState([])
  const [theses, setTheses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [articlesRes, thesesRes] = await Promise.all([
      supabase
        .from('articles')
        .select('id, title, source, sector, published_at, ingested_at, summary, url, sentiment, companies, deal_type')
        .order('ingested_at', { ascending: false })
        .limit(300),
      supabase
        .from('theses')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(50),
    ])

    if (articlesRes.data) setArticles(articlesRes.data)
    if (thesesRes.data) setTheses(thesesRes.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const allSignals = useMemo(
    () => deriveSignals(articles, theses),
    [articles, theses]
  )

  const filtered = useMemo(() => {
    if (filter === 'all') return allSignals
    if (filter === 'sentiment') {
      return allSignals.filter(s => s.type === 'sentiment_positive' || s.type === 'sentiment_negative')
    }
    if (filter === 'volume') {
      return allSignals.filter(s => s.type === 'volume')
    }
    if (filter === 'breaking') {
      return allSignals.filter(s => s.type === 'breaking')
    }
    if (filter === 'thesis') {
      return allSignals.filter(s => s.type === 'thesis')
    }
    return allSignals
  }, [allSignals, filter])

  return (
    <>
      <Head>
        <title>Signals — Signalera</title>
      </Head>
      <AppShell breadcrumb="Signals">
        <div className="flex flex-col h-full">
          <SignalsHeader
            count={filtered.length}
            loading={loading}
            onRefresh={fetchData}
          />

          {!loading && allSignals.length > 0 && (
            <SignalsSummary signals={allSignals} />
          )}

          <SignalFilters active={filter} onChange={setFilter} />

          <div className="flex-1 overflow-y-auto">
            <SignalsList signals={filtered} loading={loading} />
          </div>
        </div>
      </AppShell>
    </>
  )
}
