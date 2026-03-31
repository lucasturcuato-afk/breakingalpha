import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
  const { entries } = req.body
  if (!entries?.length) return res.status(400).json({ error: 'entries array required' })
  const { data, error } = await supabase.from('watchlist').insert(entries).select()
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ entries: data })
}
