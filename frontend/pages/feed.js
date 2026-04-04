import { useState, useEffect, useMemo, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabaseClient'
import { AppShell } from '../components/shell'
import { FeedFilters, FeedRow } from '../components/feed'
import { SkeletonRow } from '../components/primitives/Skeleton'
import EmptyState from '../components/primitives/EmptyState'

const SECTOR_KEY_MAP = {
  tech: 'technology m&a',
  vc: 'venture capital',
  pe: 'private equity',
  pub: 'public markets',
  geo: 'geopolitics',
  fin: 'fintech',
  health: 'healthcare',
  energy: 'energy',
  cons: 'consumer',
}

// Client-side state persistence keys
const READ_KEY = 'sig-feed-read'
const SAVED_KEY = 'sig-feed-saved'

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {}
}

export default function FeedPage() {
  const [articles, setArticles] = useState([])
  const [thesisArticleIds, setThesisArticleIds] = useState(new Set())
  const [loading, setLoading] = useState(true)

  // Client-side row states
  const [readIds, setReadIds] = useState(new Set())
  const [savedIds, setSavedIds] = useState(new Set())

  // Filters
  const [sector, setSector] = useState('all')
  const [sentiment, setSentiment] = useState('all')
  const [sort, setSort] = useState('newest')
  const [stateFilter, setStateFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Load persisted state on mount
  useEffect(() => {
    setReadIds(loadSet(READ_KEY))
    setSavedIds(loadSet(SAVED_KEY))
  }, [])

  // Fetch data
  useEffect(() => {
    async function load() {
      setLoading(true)

      const [articlesRes, thesesRes] = await Promise.all([
        supabase
          .from('articles')
          .select('id, title, source, sector, published_at, ingested_at, summary, url, sentiment, companies, deal_type')
          .order('ingested_at', { ascending: false })
          .limit(200),
        supabase
          .from('theses')
          .select('evidence_chain')
          .not('evidence_chain', 'is', null),
      ])

      if (articlesRes.data) setArticles(articlesRes.data)

      // Build set of article IDs referenced in thesis evidence chains
      if (thesesRes.data) {
        const ids = new Set()
        thesesRes.data.forEach(t => {
          if (Array.isArray(t.evidence_chain)) {
            t.evidence_chain.forEach(e => {
              if (e.article_id) ids.add(e.article_id)
            })
          }
        })
        setThesisArticleIds(ids)
      }

      setLoading(false)
    }
    load()
  }, [])

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && e.target.tagName !== 'INPUT') {
        e.preventDefault()
        setSearch(prev => prev) // trigger re-render to open search
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const markRead = useCallback((id) => {
    setReadIds(prev => {
      const next = new Set(prev)
      next.add(id)
      saveSet(READ_KEY, next)
      return next
    })
  }, [])

  const toggleSave = useCallback((id) => {
    setSavedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveSet(SAVED_KEY, next)
      return next
    })
  }, [])

  const filtered = useMemo(() => {
    let result = articles

    // Sector filter
    if (sector !== 'all') {
      const prefix = SECTOR_KEY_MAP[sector]
      if (prefix) {
        result = result.filter(a =>
          (a.sector || '').toLowerCase().includes(prefix)
        )
      }
    }

    // Sentiment filter
    if (sentiment !== 'all') {
      result = result.filter(a => {
        const s = String(a.sentiment || '').toLowerCase()
        if (sentiment === 'positive') return s === 'positive' || s === 'bullish'
        if (sentiment === 'negative') return s === 'negative' || s === 'bearish'
        if (sentiment === 'neutral') return s === 'neutral' || s === 'mixed' || !a.sentiment
        return true
      })
    }

    // State filter
    if (stateFilter !== 'all') {
      result = result.filter(a => {
        if (stateFilter === 'unread') return !readIds.has(a.id)
        if (stateFilter === 'saved') return savedIds.has(a.id)
        if (stateFilter === 'in-thesis') return thesisArticleIds.has(a.id)
        return true
      })
    }

    // Search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.summary || '').toLowerCase().includes(q) ||
        (a.source || '').toLowerCase().includes(q) ||
        (a.sector || '').toLowerCase().includes(q)
      )
    }

    // Sort
    if (sort === 'oldest') {
      result = [...result].reverse()
    }

    return result
  }, [articles, sector, sentiment, sort, stateFilter, search, readIds, savedIds, thesisArticleIds])

  return (
    <>
      <Head>
        <title>Feed — Signalera</title>
      </Head>
      <AppShell breadcrumb="Live Feed">
        <div className="flex flex-col h-full">
          <FeedFilters
            sector={sector}
            onSectorChange={setSector}
            sentiment={sentiment}
            onSentimentChange={setSentiment}
            sort={sort}
            onSortChange={setSort}
            stateFilter={stateFilter}
            onStateChange={setStateFilter}
            search={search}
            onSearchChange={setSearch}
            totalCount={articles.length}
            filteredCount={filtered.length}
          />

          <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
            {loading ? (
              <div className="px-4 py-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No articles found"
                description={search ? `No results for "${search}"` : 'Try adjusting your filters.'}
              />
            ) : (
              filtered.map(article => (
                <FeedRow
                  key={article.id}
                  article={article}
                  isRead={readIds.has(article.id)}
                  isSaved={savedIds.has(article.id)}
                  isInThesis={thesisArticleIds.has(article.id)}
                  onToggleSave={toggleSave}
                  onMarkRead={markRead}
                />
              ))
            )}
          </div>
        </div>
      </AppShell>
    </>
  )
}
