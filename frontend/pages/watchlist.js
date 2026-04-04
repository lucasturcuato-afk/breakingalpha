import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabaseClient'
import { AppShell } from '../components/shell'
import {
  WatchlistHeader,
  WatchlistAddModal,
  WatchlistTable,
  WatchlistSummary,
} from '../components/watchlist'

export default function WatchlistPage() {
  const [entries, setEntries] = useState([])
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const fetchEntries = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setEntries([])
      setLoading(false)
      return
    }

    const res = await fetch('/api/watchlist', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    setEntries(data.entries || [])
    setLoading(false)
  }, [])

  const fetchQuotes = useCallback(async (list) => {
    const tickers = list.filter(e => e.type === 'ticker').map(e => e.identifier)
    if (tickers.length === 0) return

    try {
      const res = await fetch(`/api/watchlist-quotes?symbols=${tickers.join(',')}`)
      const data = await res.json()
      setQuotes(data.quotes || {})
    } catch {
      // quotes are best-effort
    }
  }, [])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  useEffect(() => {
    if (entries.length > 0) {
      fetchQuotes(entries)
    }
  }, [entries, fetchQuotes])

  async function handleAdd({ identifier, type }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('Sign in to add to your watchlist')
    }

    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ identifier, type }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to add')

    setEntries(prev => [data.entry, ...prev])
  }

  async function handleRemove(id) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    const res = await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ id }),
    })

    if (res.ok) {
      setEntries(prev => prev.filter(e => e.id !== id))
    }
  }

  return (
    <>
      <Head>
        <title>Watchlist — Signalera</title>
      </Head>
      <AppShell breadcrumb="Watchlist">
        <div className="flex flex-col h-full">
          <WatchlistHeader onAdd={() => setShowAdd(true)} />

          {!loading && entries.length > 0 && (
            <WatchlistSummary entries={entries} quotes={quotes} />
          )}

          <div className="flex-1 overflow-y-auto">
            <WatchlistTable
              entries={entries}
              quotes={quotes}
              loading={loading}
              onRemove={handleRemove}
              onAdd={() => setShowAdd(true)}
            />
          </div>

          <WatchlistAddModal
            open={showAdd}
            onClose={() => setShowAdd(false)}
            onSubmit={handleAdd}
          />
        </div>
      </AppShell>
    </>
  )
}
