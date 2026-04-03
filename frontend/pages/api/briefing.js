import { createClient } from '@supabase/supabase-js'

// Maps preference panel module names → briefing section keys
const MODULE_TO_SECTION = {
  'Deals & M&A':    'deals_and_ma',
  'Macro & Rates':  'macro_and_rates',
  'Public Markets': 'public_markets',
  'Sector Signals': 'sector_spotlight',
}

// These sections always render last — they are full-width meta sections and
// should not be displaced from the bottom of the brief by preference shaping.
const PINNED_LAST = ['what_to_watch', 'tomorrow_setup']

/**
 * Reorder sections so preferred modules appear first.
 * Pinned-last sections (what_to_watch, tomorrow_setup) always stay at the end.
 * Sections not mapped to any preference retain their original relative order.
 */
function shapeSections(sections, modulePrefs) {
  const preferredKeys = modulePrefs
    .map(m => MODULE_TO_SECTION[m])
    .filter(k => k && k in sections)

  const pinnedKeys = PINNED_LAST.filter(k => k in sections)

  const remainingKeys = Object.keys(sections).filter(
    k => !preferredKeys.includes(k) && !pinnedKeys.includes(k)
  )

  const result = {}
  for (const key of [...preferredKeys, ...remainingKeys, ...pinnedKeys]) {
    result[key] = sections[key]
  }
  return result
}

/**
 * True if a sector_breakdown key (e.g. "Healthcare & Biotech") matches
 * a user preference sector (e.g. "Healthcare").
 * Uses word-level substring match; skips short words to avoid false positives.
 */
function sectorMatchesPreference(breakdownSector, prefSector) {
  const bs = breakdownSector.toLowerCase()
  const words = prefSector.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  return words.some(w => bs.includes(w))
}

/**
 * Reorder sector_breakdown so preferred sectors appear first.
 * Non-preferred sectors retain their original relative order.
 */
function shapeSectorBreakdown(breakdown, sectorPrefs) {
  const allKeys = Object.keys(breakdown)
  const preferredKeys = allKeys.filter(k =>
    sectorPrefs.some(pref => sectorMatchesPreference(k, pref))
  )
  const remainingKeys = allKeys.filter(k => !preferredKeys.includes(k))

  const result = {}
  for (const key of [...preferredKeys, ...remainingKeys]) {
    result[key] = breakdown[key]
  }
  return result
}

function safeParseJSON(val) {
  if (!val) return null
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const type = req.query.type || 'morning'
  if (!['morning', 'evening'].includes(type)) {
    return res.status(400).json({ error: 'type must be morning or evening' })
  }

  // Attempt auth — fail open to baseline briefing on any error
  let userPreferences = null
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (token) {
    try {
      const authedClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      )
      const { data: { user } } = await authedClient.auth.getUser()
      if (user) {
        const { data: prefs } = await authedClient
          .from('user_preferences')
          .select('sectors, modules')
          .eq('user_id', user.id)
          .single()
        if (prefs) userPreferences = prefs
      }
    } catch {
      // Preference load failed — fall through to unmodified briefing
    }
  }

  // Fetch global briefing (no user auth needed for public briefings table)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { data: bData, error } = await supabase
    .from('briefings')
    .select('*')
    .eq('briefing_type', type)
    .neq('headline', 'Market Intelligence Unavailable')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !bData?.[0]) {
    return res.status(200).json({ briefing: null, pref_applied: false })
  }

  const raw = bData[0]

  const hasModulePrefs = (userPreferences?.modules?.length ?? 0) > 0
  const hasSectorPrefs = (userPreferences?.sectors?.length ?? 0) > 0

  // No preferences — return briefing unchanged
  if (!hasModulePrefs && !hasSectorPrefs) {
    return res.status(200).json({ briefing: raw, pref_applied: false })
  }

  // Apply preference shaping
  const sections    = safeParseJSON(raw.sections) || {}
  const sectorBreak = safeParseJSON(raw.sector_breakdown) || {}

  const shapedSections    = hasModulePrefs
    ? shapeSections(sections, userPreferences.modules)
    : sections

  const shapedSectorBreak = hasSectorPrefs
    ? shapeSectorBreakdown(sectorBreak, userPreferences.sectors)
    : sectorBreak

  // Return shaped briefing. headline / summary / market_tone / top_deals are never touched.
  const briefing = {
    ...raw,
    sections:         shapedSections,
    sector_breakdown: shapedSectorBreak,
  }

  return res.status(200).json({
    briefing,
    pref_applied:  true,
    modules_used:  hasModulePrefs ? userPreferences.modules : [],
    sectors_used:  hasSectorPrefs ? userPreferences.sectors : [],
  })
}
