// frontend/pages/api/quotes.js
// Runs server-side on Vercel — no CORS issues

const TICKERS = ['SPY','QQQ','AAPL','NVDA','MSFT','META','GOOGL','AMZN','TSLA','BTC-USD','GLD','TLT']

async function fetchQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    })
    if (!res.ok) return null
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return null
    const meta = result.meta
    const price = meta.regularMarketPrice
    const prev = meta.previousClose || meta.chartPreviousClose
    if (!price || !prev) return null
    const pct = ((price - prev) / prev) * 100
    return {
      symbol,
      price: price < 10 ? price.toFixed(2) : price.toFixed(2),
      pct: +pct.toFixed(2),
    }
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
  try {
    const results = await Promise.allSettled(TICKERS.map(fetchQuote))
    const quotes = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
    res.status(200).json({ quotes })
  } catch (err) {
    res.status(200).json({ quotes: [] })
  }
}
