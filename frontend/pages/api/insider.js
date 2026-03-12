/**
 * /api/insider.js
 * Fetches SEC Form 4 filings + Congress trades server-side (bypasses CORS)
 * Endpoint: /api/insider?type=sec|congress
 */

// Cache to avoid hammering APIs
let cache = { sec: null, congress: null, secTs: 0, congressTs: 0 }
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function fetchSEC() {
  if (cache.sec && Date.now() - cache.secTs < CACHE_TTL) return cache.sec

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // EDGAR full-text search for Form 4 filings
  const url = `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=${weekAgo}&enddt=${today}&hits.hits.total=true`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'BreakingAlpha research@breakingalpha.com', 'Accept': 'application/json' }
  })

  if (!res.ok) throw new Error(`SEC API ${res.status}`)
  const data = await res.json()

  // Parse hits into clean trade objects
  const hits = data?.hits?.hits || []
  const trades = hits.slice(0, 50).map(h => {
    const src = h._source || {}
    return {
      id:          h._id,
      filer:       src.display_names?.[0]?.name || src.entity_name || 'Unknown',
      company:     src.entity_name || '',
      filed:       src.file_date || '',
      period:      src.period_of_report || '',
      url:         `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.entity_id}&type=4&dateb=&owner=include&count=10`,
      formUrl:     h._source?.file_date ? `https://www.sec.gov/Archives/edgar/data/${src.entity_id}/${h._id?.replace(/-/g,'')}` : null,
      ticker:      src.tickers?.[0] || null,
    }
  })

  cache.sec   = trades
  cache.secTs = Date.now()
  return trades
}

async function fetchCongress() {
  if (cache.congress && Date.now() - cache.congressTs < CACHE_TTL) return cache.congress

  // Fetch both House and Senate stock watcher APIs
  const [houseRes, senateRes] = await Promise.allSettled([
    fetch('https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json', {
      headers: { 'User-Agent': 'BreakingAlpha research@breakingalpha.com', 'Accept': 'application/json' }
    }),
    fetch('https://senate-stock-watcher-data.s3-us-east-2.amazonaws.com/aggregate/all_transactions.json', {
      headers: { 'User-Agent': 'BreakingAlpha research@breakingalpha.com', 'Accept': 'application/json' }
    })
  ])

  let combined = []

  if (houseRes.status === 'fulfilled' && houseRes.value.ok) {
    const houseData = await houseRes.value.json()
    const trades = Array.isArray(houseData) ? houseData : (houseData.data || [])
    combined.push(...trades
      .filter(t => t.ticker && t.ticker !== '--' && t.transaction_date)
      .map(t => ({
        id:             `house-${t.representative}-${t.ticker}-${t.transaction_date}`,
        representative: t.representative || 'Unknown',
        party:          t.party || '',
        chamber:        'House',
        ticker:         (t.ticker||'').replace('$',''),
        asset:          t.asset_description || t.ticker || '',
        type:           t.type || '',
        amount:         t.amount || '',
        filed:          t.disclosure_date || '',
        traded:         t.transaction_date || '',
        district:       t.district || '',
      }))
    )
  }

  if (senateRes.status === 'fulfilled' && senateRes.value.ok) {
    const senateData = await senateRes.value.json()
    // Senate data is nested: array of senators, each with transactions[]
    const senators = Array.isArray(senateData) ? senateData : []
    senators.forEach(senator => {
      const name = `${senator.first_name || ''} ${senator.last_name || ''}`.trim() || senator.office || 'Unknown'
      const transactions = Array.isArray(senator.transactions) ? senator.transactions : []
      transactions.forEach(t => {
        if (!t.ticker || t.ticker === '--') return
        combined.push({
          id:             `senate-${name}-${t.ticker}-${t.transaction_date}`,
          representative: name,
          party:          senator.party || '',
          chamber:        'Senate',
          ticker:         (t.ticker||'').replace('$',''),
          asset:          t.asset_description || t.ticker || '',
          type:           t.type || '',
          amount:         t.amount || '',
          filed:          senator.date_recieved || '',
          traded:         t.transaction_date || '',
          district:       senator.office || '',
        })
      })
    })
  }

  if (combined.length === 0) throw new Error('No data returned from congress trade APIs')

  // Sort by most recent, take top 100
  const recent = combined
    .filter(t => t.ticker && t.ticker !== '--' && t.traded)
    .sort((a, b) => new Date(b.traded) - new Date(a.traded))
    .slice(0, 100)

  cache.congress    = recent
  cache.congressTs  = Date.now()
  return recent
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
      return res.status(200).json({ trades: data, source: 'House Stock Watcher / STOCK Act', updated: new Date().toISOString() })
    }
    return res.status(400).json({ error: 'Invalid type. Use ?type=sec or ?type=congress' })
  } catch (err) {
    console.error('Insider API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
