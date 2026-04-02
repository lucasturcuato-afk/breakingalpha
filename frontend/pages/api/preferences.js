import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Sign in to manage preferences' })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return res.status(401).json({ error: 'Invalid session' })

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message })
    return res.status(200).json({ preferences: data || null })
  }

  if (req.method === 'POST') {
    const { sectors, modules, prioritize_watchlist } = req.body
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: user.id,
          sectors: sectors ?? [],
          modules: modules ?? [],
          prioritize_watchlist: prioritize_watchlist ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ preferences: data })
  }

  return res.status(405).end()
}
