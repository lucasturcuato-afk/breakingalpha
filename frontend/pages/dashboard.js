import { useState, useEffect } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabaseClient'
import { AppShell } from '../components/shell'
import { LiveFeed, ResearchQueue, MarketSnapshot, QuickActions } from '../components/dashboard'

export default function DashboardPage() {
  const [articles, setArticles] = useState([])
  const [theses, setTheses] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [articlesRes, thesesRes] = await Promise.all([
        supabase
          .from('articles')
          .select('id, title, source, sector, published_at, ingested_at, summary, url, sentiment, companies, deal_type')
          .order('ingested_at', { ascending: false })
          .limit(100),
        supabase
          .from('theses')
          .select('*')
          .order('generated_at', { ascending: false })
          .limit(10),
      ])

      if (articlesRes.data) setArticles(articlesRes.data)
      if (thesesRes.data) setTheses(thesesRes.data)

      // Fetch watchlist quotes via existing API
      try {
        const quotesRes = await fetch('/api/quotes')
        if (quotesRes.ok) {
          const quotesData = await quotesRes.json()
          if (quotesData?.quotes) setQuotes(quotesData.quotes)
        }
      } catch {
        // Quotes API may not be available — graceful fallback
      }

      setLoading(false)
    }
    load()
  }, [])

  return (
    <>
      <Head>
        <title>Dashboard — Signalera</title>
      </Head>
      <AppShell breadcrumb="Dashboard">
        <div className="flex h-full">
          {/* Left 2/3 — Live feed */}
          <div className="flex-1 min-w-0 border-r border-border-subtle">
            <LiveFeed articles={articles} loading={loading} />
          </div>

          {/* Right 1/3 — Research + Market + Actions */}
          <div className="w-[360px] shrink-0 overflow-y-auto p-4 space-y-4">
            <QuickActions />
            <ResearchQueue theses={theses} loading={loading} />
            <MarketSnapshot quotes={quotes} loading={loading} />
          </div>
        </div>
      </AppShell>
    </>
  )
}
