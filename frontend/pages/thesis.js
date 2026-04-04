import { useState, useEffect, useMemo, useCallback } from 'react'
import Head from 'next/head'
import clsx from 'clsx'
import { LayoutGrid, Table2, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { AppShell } from '../components/shell'
import { ThesisBoardView, ThesisTableView } from '../components/thesis'
import Badge from '../components/primitives/Badge'
import { SkeletonRow } from '../components/primitives/Skeleton'
import EmptyState from '../components/primitives/EmptyState'

const STATUS_KEY = 'sig-thesis-status'
const VIEW_KEY = 'sig-thesis-view'

function loadStatusMap() {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveStatusMap(map) {
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(map)) } catch {}
}

const CONVICTION_FILTERS = ['ALL', 'BULLISH', 'BEARISH', 'WATCH']

export default function ThesisPage() {
  const [theses, setTheses] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [view, setView] = useState('board')
  const [statusMap, setStatusMap] = useState({})
  const [convictionFilter, setConvictionFilter] = useState('ALL')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [sortKey, setSortKey] = useState('generated_at')
  const [sortDir, setSortDir] = useState('desc')

  // Load persisted state
  useEffect(() => {
    setStatusMap(loadStatusMap())
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === 'table' || saved === 'board') setView(saved)
    } catch {}
  }, [])

  // Fetch theses
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('theses')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(50)
      if (data) setTheses(data)
      setLoading(false)
    }
    load()
  }, [])

  const handleStatusChange = useCallback((id, status) => {
    setStatusMap(prev => {
      const next = { ...prev, [id]: status }
      saveStatusMap(next)
      return next
    })
  }, [])

  const handleViewChange = useCallback((v) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch {}
  }, [])

  const handleRegenerate = useCallback(async (thesisId) => {
    try {
      const res = await fetch('/api/thesis-regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thesisId }),
      })
      if (res.ok) {
        const { thesis: updated } = await res.json()
        setTheses(prev => prev.map(t => t.id === thesisId ? { ...t, ...updated } : t))
      }
    } catch (err) {
      console.error('Regenerate failed:', err)
    }
  }, [])

  const handleGenerateNew = useCallback(async () => {
    if (generating) return
    setGenerating(true)
    try {
      const res = await fetch('/api/theses', { method: 'POST' })
      if (res.ok) {
        const { theses: newTheses } = await res.json()
        // Refresh from Supabase to get IDs
        const { data } = await supabase
          .from('theses')
          .select('*')
          .order('generated_at', { ascending: false })
          .limit(50)
        if (data) setTheses(data)
      }
    } catch (err) {
      console.error('Generate failed:', err)
    } finally {
      setGenerating(false)
    }
  }, [generating])

  const handleSort = useCallback((key, dir) => {
    setSortKey(key)
    setSortDir(dir)
  }, [])

  // Collect unique sectors
  const sectors = useMemo(() => {
    const set = new Set()
    theses.forEach(t => { if (t.sector) set.add(t.sector) })
    return ['all', ...Array.from(set).sort()]
  }, [theses])

  // Filter + sort
  const filtered = useMemo(() => {
    let result = theses

    if (convictionFilter !== 'ALL') {
      result = result.filter(t => t.conviction === convictionFilter)
    }
    if (sectorFilter !== 'all') {
      result = result.filter(t => t.sector === sectorFilter)
    }

    // Sort (table view)
    if (view === 'table' && sortKey) {
      result = [...result].sort((a, b) => {
        let av = a[sortKey] || ''
        let bv = b[sortKey] || ''
        if (typeof av === 'string') av = av.toLowerCase()
        if (typeof bv === 'string') bv = bv.toLowerCase()
        if (av < bv) return sortDir === 'asc' ? -1 : 1
        if (av > bv) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }

    return result
  }, [theses, convictionFilter, sectorFilter, view, sortKey, sortDir])

  return (
    <>
      <Head>
        <title>Thesis Board — Signalera</title>
      </Head>
      <AppShell breadcrumb="Thesis Board">
        <div className="flex flex-col h-full">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 h-11 border-b border-border-subtle shrink-0">
            {/* View toggle */}
            <div className="flex items-center bg-base-elevated rounded-md border border-border-subtle p-0.5">
              <button
                onClick={() => handleViewChange('board')}
                className={clsx(
                  'flex items-center justify-center h-6 w-7 rounded sig-transition',
                  view === 'board'
                    ? 'bg-base-surface text-content-primary shadow-sm'
                    : 'text-content-muted hover:text-content-secondary'
                )}
                aria-label="Board view"
              >
                <LayoutGrid size={13} />
              </button>
              <button
                onClick={() => handleViewChange('table')}
                className={clsx(
                  'flex items-center justify-center h-6 w-7 rounded sig-transition',
                  view === 'table'
                    ? 'bg-base-surface text-content-primary shadow-sm'
                    : 'text-content-muted hover:text-content-secondary'
                )}
                aria-label="Table view"
              >
                <Table2 size={13} />
              </button>
            </div>

            {/* Conviction filters */}
            <div className="flex items-center gap-1 ml-2">
              {CONVICTION_FILTERS.map(c => (
                <button
                  key={c}
                  onClick={() => setConvictionFilter(c)}
                  className={clsx(
                    'px-2 h-6 rounded text-11 font-medium sig-transition',
                    convictionFilter === c
                      ? c === 'BULLISH' ? 'bg-signal-muted text-signal-400'
                        : c === 'BEARISH' ? 'bg-live/10 text-live'
                        : c === 'WATCH' ? 'bg-draft/10 text-draft'
                        : 'bg-base-elevated text-content-primary'
                      : 'text-content-muted hover:text-content-secondary'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Sector dropdown */}
            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              className="h-7 px-2 rounded-md text-11 bg-base-elevated border border-border-subtle text-content-secondary sig-transition outline-none ml-1"
            >
              {sectors.map(s => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All sectors' : s}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            {/* Count */}
            <span className="text-11 text-content-muted font-mono">
              {filtered.length} theses
            </span>

            {/* Generate new */}
            <button
              onClick={handleGenerateNew}
              disabled={generating}
              className={clsx(
                'flex items-center gap-1.5 h-7 px-3 rounded-md text-12 font-medium',
                'bg-signal-500 text-base',
                'hover:bg-signal-400',
                'disabled:opacity-40 disabled:pointer-events-none',
                'sig-transition',
              )}
            >
              {generating ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="px-4 py-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No theses found"
                description={convictionFilter !== 'ALL' || sectorFilter !== 'all'
                  ? 'Try adjusting your filters.'
                  : 'Click Generate to create AI-powered investment theses from your feed.'
                }
              />
            ) : view === 'board' ? (
              <ThesisBoardView
                theses={filtered}
                statusMap={statusMap}
                onStatusChange={handleStatusChange}
                onRegenerate={handleRegenerate}
              />
            ) : (
              <ThesisTableView
                theses={filtered}
                statusMap={statusMap}
                onStatusChange={handleStatusChange}
                onRegenerate={handleRegenerate}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}
          </div>
        </div>
      </AppShell>
    </>
  )
}
