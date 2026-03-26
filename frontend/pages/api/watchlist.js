import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entries: data || [] })
  }

  if (req.method === 'POST') {
    const { identifier, type } = req.body
    if (!identifier || !type) return res.status(400).json({ error: 'identifier and type required' })
    const { data, error } = await supabase
      .from('watchlist')
      .insert([{ identifier, type, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entry: data })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { data, error } = await supabase
      .from('watchlist')
      .delete()
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entry: data })
  }

  return res.status(405).end()
}
