// pages/api/quotes.js
// Server-side proxy for Yahoo Finance - no CORS issues

const TICKERS = ['SPY','QQQ','AAPL','NVDA','MSFT','META','GOOGL','AMZN','TSLA','BTC-USD','GLD','TLT']

async function fetchQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    })
    if (!res.ok) return null
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return null
    const meta = result.meta
    const price = meta.regularMarketPrice
    const prev = meta.previousClose || meta.chartPreviousClose
    if (!price || !prev) return null
    const change = price - prev
    const pct = (change / prev) * 100
    return { symbol, price: +price.toFixed(2), change: +change.toFixed(2), pct: +pct.toFixed(2) }
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
  try {
    const results = await Promise.all(TICKERS.map(fetchQuote))
    const quotes = results.filter(Boolean)
    res.status(200).json({ quotes })
  } catch (err) {
    res.status(500).json({ quotes: [], error: err.message })
  }
}
