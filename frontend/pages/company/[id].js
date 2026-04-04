import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../lib/supabaseClient'
import { AppShell } from '../../components/shell'
import {
  CompanyHeader,
  CompanyTabs,
  CompanyDevelopments,
  CompanyResearch,
  CompanyMetadata,
} from '../../components/company'
import EmptyState from '../../components/primitives/EmptyState'
import Skeleton from '../../components/primitives/Skeleton'

function parseCompanies(raw) {
  if (!raw) return []
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return Array.isArray(raw) ? raw : []
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function CompanyPage() {
  const router = useRouter()
  const { id } = router.query
  const companyName = id ? decodeURIComponent(id) : ''

  const [articles, setArticles] = useState([])
  const [theses, setTheses] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('developments')
  const [isWatchlisted, setIsWatchlisted] = useState(false)

  useEffect(() => {
    if (!companyName) return

    async function load() {
      setLoading(true)

      const [articlesRes, thesesRes] = await Promise.all([
        supabase
          .from('articles')
          .select('id, title, source, sector, published_at, ingested_at, summary, url, sentiment, companies, deal_type')
          .order('ingested_at', { ascending: false })
          .limit(500),
        supabase
          .from('theses')
          .select('*')
          .order('generated_at', { ascending: false })
          .limit(50),
      ])

      // Filter articles mentioning this company
      if (articlesRes.data) {
        const matched = articlesRes.data.filter(a => {
          const cos = parseCompanies(a.companies)
          return cos.some(c => c.toLowerCase() === companyName.toLowerCase())
        })
        setArticles(matched)
      }

      // Filter theses mentioning this company in title or rationale
      if (thesesRes.data) {
        const nameLower = companyName.toLowerCase()
        const matched = thesesRes.data.filter(t =>
          (t.title || '').toLowerCase().includes(nameLower) ||
          (t.rationale || '').toLowerCase().includes(nameLower) ||
          (t.catalyst || '').toLowerCase().includes(nameLower)
        )
        setTheses(matched)
      }

      setLoading(false)
    }
    load()
  }, [companyName])

  // Derived metadata
  const metadata = useMemo(() => {
    if (articles.length === 0) return {}
    const sectors = new Set()
    const dealTypes = new Set()
    let firstSeen = null
    let lastSeen = null

    articles.forEach(a => {
      if (a.sector) sectors.add(a.sector)
      if (a.deal_type) dealTypes.add(a.deal_type)
      const date = a.ingested_at || a.published_at
      if (date) {
        if (!firstSeen || date < firstSeen) firstSeen = date
        if (!lastSeen || date > lastSeen) lastSeen = date
      }
    })

    return {
      sectors: Array.from(sectors),
      dealTypes: Array.from(dealTypes),
      firstSeen: formatDate(firstSeen),
      lastSeen: formatDate(lastSeen),
    }
  }, [articles])

  async function handleToggleWatchlist() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ identifier: companyName, type: 'company' }),
      })
      setIsWatchlisted(true)
    } catch (err) {
      console.error('Watchlist error:', err)
    }
  }

  if (!companyName) return null

  return (
    <>
      <Head>
        <title>{companyName} — Signalera</title>
      </Head>
      <AppShell breadcrumb={`Company / ${companyName}`}>
        <div className="flex flex-col h-full">
          {loading ? (
            <div className="px-6 py-5 space-y-3">
              <Skeleton width="200px" height="24px" rounded="md" />
              <Skeleton width="120px" height="14px" rounded="sm" />
            </div>
          ) : (
            <CompanyHeader
              name={companyName}
              sector={metadata.sectors?.[0]}
              mentionCount={articles.length}
              isWatchlisted={isWatchlisted}
              onToggleWatchlist={handleToggleWatchlist}
            />
          )}

          <CompanyTabs active={tab} onChange={setTab} />

          <div className="flex-1 overflow-y-auto">
            {tab === 'developments' && (
              <CompanyDevelopments articles={articles} loading={loading} />
            )}
            {tab === 'research' && (
              <CompanyResearch theses={theses} loading={loading} />
            )}
            {tab === 'memos' && (
              <EmptyState
                title="No deal memos"
                description={`No memos have been generated for ${companyName} yet. Go to the Memo page to create one.`}
              />
            )}
            {tab === 'metadata' && (
              <CompanyMetadata
                name={companyName}
                mentionCount={articles.length}
                sectors={metadata.sectors}
                dealTypes={metadata.dealTypes}
                firstSeen={metadata.firstSeen}
                lastSeen={metadata.lastSeen}
              />
            )}
          </div>
        </div>
      </AppShell>
    </>
  )
}
