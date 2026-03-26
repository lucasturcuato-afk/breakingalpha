/*
  Run this SQL in Supabase SQL Editor to create the theses table:

  create table theses (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    conviction text not null,
    rationale text,
    sector text,
    catalyst text,
    generated_at timestamptz default now(),
    source text default 'ai-generated'
  );

  alter table theses enable row level security;
  create policy "Public read" on theses for select using (true);
  create policy "Service insert" on theses for insert with check (true);
*/

import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    // Fetch today's top 30 most relevant articles
    const { data: articles, error: articlesError } = await supabase
      .from('articles')
      .select('title, summary, sector, sentiment, companies, deal_type')
      .order('ingested_at', { ascending: false })
      .limit(30)

    if (articlesError) throw articlesError
    if (!articles || articles.length === 0) {
      return res.status(200).json({ theses: [] })
    }

    // Format articles for the prompt
    const articleContext = articles.map((a, i) =>
      `${i + 1}. [${a.sector || 'General'}] ${a.title}${a.summary ? ' — ' + a.summary.slice(0, 120) : ''}`
    ).join('\n')

    const prompt = `You are a senior investment banking analyst at a bulge bracket firm. Based on the following news articles from today, generate exactly 5 investment theses that a sophisticated IB analyst or buy-side investor would find actionable and insightful.

TODAY'S NEWS:
${articleContext}

Generate exactly 5 theses. Respond ONLY with a valid JSON array, no other text, no markdown, no backticks. Use this exact structure:
[
  {
    "title": "Short punchy thesis title (5-8 words)",
    "conviction": "BULLISH" or "BEARISH" or "WATCH",
    "rationale": "2-3 sentences explaining the thesis with specific evidence from today's news. Be specific — name companies, deals, and figures.",
    "sector": "Primary sector this applies to",
    "catalyst": "The single most important near-term catalyst to watch"
  }
]

Requirements:
- Each thesis must be grounded in the actual news provided above
- Use real company names and deal specifics from the articles
- Conviction should reflect actual signal strength from the news
- Rationale should read like an analyst note, not a news summary
- Sectors should be one of: Technology M&A, Private Equity, Venture Capital, Public Markets, Geopolitics & Macro, Fintech & Crypto, Healthcare & Biotech, Energy & Climate`

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content || '[]'

    // Parse JSON safely
    let theses = []
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim()
      theses = JSON.parse(cleaned)
    } catch (parseError) {
      console.error('Failed to parse Groq response:', raw)
      return res.status(500).json({ error: 'Failed to parse thesis response' })
    }

    // Save to Supabase theses table
    const rows = theses.map(t => ({
      title: t.title,
      conviction: t.conviction,
      rationale: t.rationale,
      sector: t.sector,
      catalyst: t.catalyst,
      generated_at: new Date().toISOString(),
      source: 'ai-generated'
    }))

    const { error: insertError } = await supabase
      .from('theses')
      .insert(rows)

    if (insertError) {
      // Log but don't fail — still return theses to frontend
      console.error('Supabase insert error:', insertError)
    }

    res.status(200).json({ theses, count: theses.length })

  } catch (err) {
    console.error('Theses API error:', err)
    res.status(500).json({ error: 'Failed to generate theses' })
  }
}
