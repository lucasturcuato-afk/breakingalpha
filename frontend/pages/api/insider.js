/**
 * /api/insider.js — BreakingAlpha
 * SEC Form 4 (EDGAR full-text search with correct field mapping)
 * Congress trades (Capitol Trades API — free, no key required)
 */

let cache = { sec: null, congress: null, secTs: 0, congressTs: 0 }
const CACHE_TTL = 5 * 60 * 1000

async function fetchSEC() {
  if (cache.sec && Date.now() - cache.secTs < CACHE_TTL) return cache.sec

  const today   = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Use EDGAR full-text search — correct endpoint with proper field extraction
  const url = `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=${weekAgo}&enddt=${today}&_source=period_of_report,entity_name,file_date,display_names,tickers&hits.hits.total.value=true`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'BreakingAlpha research@breakingalpha.com',
      'Accept': 'application/json'
    }
  })
  if (!res.ok) throw new Error(`SEC API ${res.status}`)

  const data  = await res.json()
  const hits  = data?.hits?.hits || []

  const trades = hits.slice(0, 50).map(h => {
    const src     = h._source || {}
    // display_names is an array of {name, entity_id, ticker}
    const filerObj   = Array.isArray(src.display_names) ? src.display_names[0] : null
    const issuerObj  = Array.isArray(src.display_names) ? src.display_names[1] : null
    return {
      id:      h._id,
      filer:   filerObj?.name   || src.entity_name || 'N/A',
      company: issuerObj?.name  || '',
      ticker:  filerObj?.ticker || issuerObj?.ticker || src.tickers?.[0] || null,
      filed:   src.file_date    || '',
      period:  src.period_of_report || '',
      url:     filerObj?.entity_id
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filerObj.entity_id}&type=4&dateb=&owner=include&count=10`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=10`,
    }
  })

  cache.sec   = trades
  cache.secTs = Date.now()
  return trades
}

async function fetchCongress() {
  if (cache.congress && Date.now() - cache.congressTs < CACHE_TTL) return cache.congress

  // Capitol Trades — free API, no key, covers both House + Senate
  // Returns recent trades with politician name, party, ticker, trade type, amount
  const res = await fetch(
    'https://capitoltrades.com/api/trades?per_page=100&sort=-traded',
    {
      headers: {
        'User-Agent': 'BreakingAlpha research@breakingalpha.com',
        'Accept':     'application/json',
        'Origin':     'https://capitoltrades.com',
        'Referer':    'https://capitoltrades.com/trades',
      }
    }
  )

  if (!res.ok) {
    // Fallback: try the quiver quant public endpoint
    const fallback = await fetch(
      'https://www.quiverquant.com/beta/live/congresstrading',
      { headers: { 'User-Agent': 'BreakingAlpha research@breakingalpha.com', 'Accept': 'application/json', 'X-CSRFToken': 'null' } }
    )
    if (!fallback.ok) throw new Error(`Congress APIs unavailable (${res.status})`)
    const fb = await fallback.json()
    const trades = (Array.isArray(fb) ? fb : []).slice(0, 100).map((t, i) => ({
      id:             `qv-${i}`,
      representative: t.Representative || t.Senator || 'Unknown',
      party:          t.Party || '',
      chamber:        t.Chamber || '',
      ticker:         (t.Ticker || '').replace('$', ''),
      asset:          t.Asset || t.Ticker || '',
      type:           t.Transaction || '',
      amount:         t.Range || '',
      filed:          t.ReportDate || '',
      traded:         t.TransactionDate || '',
      district:       t.District || t.State || '',
    }))
    cache.congress   = trades
    cache.congressTs = Date.now()
    return trades
  }

  const data   = await res.json()
  const items  = data?.data || data?.trades || (Array.isArray(data) ? data : [])

  const trades = items.slice(0, 100).map((t, i) => ({
    id:             `ct-${t.id || i}`,
    representative: t.politician?.name || t.politician_name || 'Unknown',
    party:          t.politician?.party || t.party || '',
    chamber:        t.politician?.chamber || '',
    ticker:         (t.asset?.ticker || t.ticker || '').replace('$', ''),
    asset:          t.asset?.name || t.asset_name || t.ticker || '',
    type:           t.type || t.transaction_type || '',
    amount:         t.size || t.amount || '',
    filed:          t.published_at || t.filed_at || '',
    traded:         t.traded_at || t.transaction_date || '',
    district:       t.politician?.state || t.state || '',
  }))

  cache.congress   = trades
  cache.congressTs = Date.now()
  return trades
}

export default async function handler(req, res) {
  const { type = 'sec' } = req.query
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate')

  try {
    if (type === 'sec') {
      const data = await fetchSEC()
      return res.status(200).json({ trades: data, source: 'SEC EDGAR Form 4', updated: new Date().toISOString() })
    }
    if (type === 'congress') {
      const data = await fetchCongress()
      return res.status(200).json({ trades: data, source: 'Capitol Trades / STOCK Act', updated: new Date().toISOString() })
    }
    return res.status(400).json({ error: 'Invalid type. Use ?type=sec or ?type=congress' })
  } catch (err) {
    console.error('Insider API error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
