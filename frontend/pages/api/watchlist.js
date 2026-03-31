import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  )

  if (req.method === 'GET') {
    if (!token) return res.status(200).json({ entries: [] })
    const { data, error } = await supabase.from('watchlist').select('*').order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entries: data || [] })
  }

  if (req.method === 'POST') {
    if (!token) return res.status(401).json({ error: 'Sign in to add to your watchlist' })
    const { identifier, type } = req.body
    if (!identifier || !type) return res.status(400).json({ error: 'identifier and type required' })
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Invalid session' })
    const normalizedIdentifier = identifier.trim().toUpperCase()
    const { data: existing } = await supabase.from('watchlist').select('id').eq('identifier', normalizedIdentifier).eq('type', type).single()
    if (existing) return res.status(400).json({ error: `${normalizedIdentifier} is already in your watchlist.` })
    if (type === 'ticker') {
      const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(normalizedIdentifier)}&token=${process.env.FINNHUB_API_KEY}`)
      const d = await r.json()
      if (!(d.result || []).some(x => x.symbol === normalizedIdentifier)) return res.status(400).json({ error: 'Ticker not found. Please enter a valid symbol.' })
    } else if (type === 'company') {
      const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(normalizedIdentifier)}&token=${process.env.FINNHUB_API_KEY}`)
      const d = await r.json()
      if (!(d.result || []).length) return res.status(400).json({ error: 'Company not found.' })
    }
    const { data, error } = await supabase.from('watchlist').insert([{ identifier: normalizedIdentifier, type, user_id: user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entry: data })
  }

  if (req.method === 'DELETE') {
    if (!token) return res.status(401).json({ error: 'Sign in to manage your watchlist' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { data, error } = await supabase.from('watchlist').delete().eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entry: data })
  }

  return res.status(405).end()
}
