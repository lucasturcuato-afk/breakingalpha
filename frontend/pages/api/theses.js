/*
  Run this SQL in Supabase SQL Editor to create/update the theses table:

  create table if not exists theses (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    conviction text not null,
    rationale text,
    sector text,
    catalyst text,
    catalyst_note text,
    evidence_chain jsonb,
    generated_at timestamptz default now(),
    source text default 'ai-generated'
  );

  -- Add new columns to existing table:
  ALTER TABLE theses ADD COLUMN IF NOT EXISTS catalyst_note text;
  ALTER TABLE theses ADD COLUMN IF NOT EXISTS evidence_chain jsonb;

  alter table theses enable row level security;
  create policy "Public read" on theses for select using (true);
  create policy "Service insert" on theses for insert with check (true);
  create policy "Public update" on theses for update using (true) with check (true);
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
    // Fetch today's top 30 most relevant articles with full context
    const { data: articles, error: articlesError } = await supabase
      .from('articles')
      .select('id, title, summary, sector, sentiment, companies, deal_type, source, published_at, url')
      .order('ingested_at', { ascending: false })
      .limit(30)

    if (articlesError) throw articlesError
    if (!articles || articles.length === 0) {
      return res.status(200).json({ theses: [] })
    }

    // Format articles with more context for better analysis
    const articleContext = articles.map((a, i) =>
      `${i + 1}. [${a.sector || 'General'}] "${a.title}" (${a.source || 'Unknown'})${a.summary ? '\n   ' + a.summary.slice(0, 200) : ''}${a.companies ? '\n   Companies: ' + (typeof a.companies === 'string' ? a.companies : JSON.stringify(a.companies)) : ''}`
    ).join('\n\n')

    const prompt = `You are a senior investment banking analyst at Goldman Sachs writing the daily sector research digest. Based on the following news articles, generate exactly 5 investment theses that a sophisticated buy-side investor or IB coverage team would find actionable.

TODAY'S NEWS FLOW (${articles.length} articles):
${articleContext}

Generate exactly 5 theses. Respond ONLY with a valid JSON array, no other text, no markdown, no backticks:
[
  {
    "title": "Punchy thesis title (5-8 words) — must name a specific company, sector, or transaction",
    "conviction": "BULLISH" or "BEARISH" or "WATCH",
    "rationale": "A detailed analytical paragraph of 6-8 sentences (minimum 120 words, target 160 words) written in the style of a Bloomberg Intelligence sector brief. Structure: (1) Open with the single most important data point or market development from the source articles — cite specific dollar figures, company names, deal values. (2) Build a logical chain from what happened to why it matters for the sector to what it signals about forward trajectory. (3) Reference specific named companies, dollar figures, percentages, and deal terms — never genericize. (4) Connect evidence to broader sector dynamics — deal flow implications, valuation multiples, institutional positioning. (5) Close with a forward-looking statement matching the conviction level.",
    "sector": "One of: Technology M&A, Private Equity, Venture Capital, Public Markets, Geopolitics & Macro, Fintech & Crypto, Healthcare & Biotech, Energy & Climate",
    "catalyst": "The single most important near-term catalyst — be specific about what event, what date/timeframe, what metric to watch",
    "catalyst_note": "3-4 sentences in Goldman Sachs research note style. Sentence 1: WHAT the catalyst is with specific timing. Sentence 2: WHY it matters structurally — cite metrics from the articles. Sentence 3: WHAT specific data point to watch when it triggers. Sentence 4: Expected market reaction for comps, multiples, or deal flow.",
    "evidence_chain": [
      {
        "article_index": 0,
        "label": "2-4 word analytical tag (e.g. 'Valuation anchor', 'Deal precedent', 'Revenue signal')",
        "type": "support" or "context" or "risk",
        "bridge": "One precise analytical sentence connecting this article to the thesis, citing specific data."
      }
    ]
  }
]

Requirements:
- Each thesis must be grounded in specific articles above — evidence_chain links back to article indices
- rationale must be 120-160 words, analyst-grade prose — not bullet points or a news summary
- catalyst_note must reference specific companies, dollar figures, and timeframes from the articles
- evidence_chain: 3-5 items per thesis linking to the most relevant articles by index number
- conviction should reflect actual signal strength: BULLISH only if multiple confirming data points, BEARISH if risk signals dominate, WATCH if mixed
- Use exact company names, deal values, growth rates from the articles — no generic sector commentary`

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content || '[]'

    let theses = []
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim()
      theses = JSON.parse(cleaned)
    } catch (parseError) {
      console.error('Failed to parse Groq response:', raw)
      return res.status(500).json({ error: 'Failed to parse thesis response' })
    }

    // Save to Supabase with all enrichment fields
    const rows = theses.map(t => ({
      title: t.title,
      conviction: t.conviction,
      rationale: t.rationale,
      sector: t.sector,
      catalyst: t.catalyst,
      catalyst_note: t.catalyst_note || null,
      evidence_chain: t.evidence_chain || null,
      generated_at: new Date().toISOString(),
      source: 'ai-generated'
    }))

    const { error: insertError } = await supabase
      .from('theses')
      .insert(rows)

    if (insertError) {
      console.error('Supabase insert error:', insertError)
    }

    res.status(200).json({ theses, count: theses.length })

  } catch (err) {
    console.error('Theses API error:', err)
    res.status(500).json({ error: 'Failed to generate theses' })
  }
}
