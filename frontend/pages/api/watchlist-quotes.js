// /pages/api/watchlist-quotes.js
// Accepts: GET ?symbols=AAPL,MSFT,TSLA
// Returns: { quotes: { AAPL: { price, pct }, ... } }

function fmt(price) {
  if (!price || isNaN(price)) return '—'
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(2)
  return price.toFixed(4)
}

async function fetchFinnhub(symbol, apiKey) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return null
  const d = await res.json()
  if (!d.c || d.c === 0) return null
  const pct = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0
  return { price: fmt(d.c), pct: parseFloat(pct.toFixed(2)) }
}

export default async function handler(req, res) {
  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'symbols required' })

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' })

  const symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20)

  const results = await Promise.allSettled(
    symbolList.map(async (symbol) => {
      const data = await fetchFinnhub(symbol, FINNHUB_KEY).catch(() => null)
      return { symbol, data }
    })
  )

  const quotes = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.data) {
      quotes[r.value.symbol] = r.value.data
    }
  }

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=90')
  return res.status(200).json({ quotes })
}
