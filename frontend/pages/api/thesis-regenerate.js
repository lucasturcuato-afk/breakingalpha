/*
  Regenerates a single thesis with upgraded analysis, catalyst note, and evidence chain.
  Saves everything back to Supabase.

  POST body: { thesisId: "uuid" }
  Returns: { thesis: { ...updated fields } }
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

  const { thesisId } = req.body
  if (!thesisId) return res.status(400).json({ error: 'thesisId is required' })

  try {
    // Fetch the thesis
    const { data: thesis, error: thesisErr } = await supabase
      .from('theses')
      .select('*')
      .eq('id', thesisId)
      .single()

    if (thesisErr || !thesis) {
      return res.status(404).json({ error: 'Thesis not found' })
    }

    // Fetch related articles by sector
    const query = supabase
      .from('articles')
      .select('id, title, source, sector, published_at, ingested_at, summary, url, companies, sentiment')
      .order('ingested_at', { ascending: false })
      .limit(12)
    if (thesis.sector) query.eq('sector', thesis.sector)
    const { data: articles } = await query
    const articleList = (articles || []).slice(0, 8)

    const articleContext = articleList.map((a, i) =>
      `${i + 1}. "${a.title}" (${a.source || 'Unknown'}, ${a.published_at ? new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'recent'})${a.summary ? '\n   ' + a.summary.slice(0, 250) : ''}`
    ).join('\n\n')

    // Step 1: Regenerate the full analysis (rationale)
    const analysisPrompt = `You are a senior sector analyst at Bloomberg Intelligence writing a research brief. Write a detailed analytical paragraph about this investment thesis based on the source articles provided.

THESIS: ${thesis.title}
CONVICTION: ${thesis.conviction}
SECTOR: ${thesis.sector || 'General'}
CATALYST: ${thesis.catalyst || 'Not specified'}

SOURCE ARTICLES:
${articleContext || 'No articles available'}

Write a single analytical paragraph of 6-8 sentences (minimum 120 words, target 160 words) that reads like a Bloomberg Intelligence sector brief or a tier-1 investment bank sector note. Follow this structure:

1. OPEN with the most important data point or market development from the source articles — cite specific figures, company names, deal values
2. BUILD a logical chain: what happened → why it matters for the sector → what it signals about forward trajectory
3. REFERENCE specific named companies, dollar figures, percentages, and deal terms from the articles — do not genericize or use placeholder language
4. CONNECT the evidence to broader sector dynamics — what does this mean for deal flow, valuations, or institutional investor behavior?
5. CLOSE with a forward-looking statement that matches the conviction level (${thesis.conviction}). ${thesis.conviction === 'BULLISH' ? 'Use confident positive momentum language.' : thesis.conviction === 'BEARISH' ? 'Use cautionary but precise risk language.' : 'Use measured monitoring language with clear triggers to watch.'}

Respond with ONLY the paragraph text, no labels, no headers, no markdown formatting.`

    const analysisCompletion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: analysisPrompt }],
      max_tokens: 600,
      temperature: 0.35,
    })
    const newRationale = analysisCompletion.choices[0]?.message?.content?.trim() || thesis.rationale

    // Step 2: Generate catalyst note + evidence chain
    const detailPrompt = `You are a senior equity research analyst at Goldman Sachs writing internal research notes.

THESIS:
- Title: ${thesis.title}
- Conviction: ${thesis.conviction}
- Sector: ${thesis.sector || 'General'}
- Catalyst: ${thesis.catalyst || 'None specified'}
- Analysis: ${newRationale}

SOURCE ARTICLES:
${articleContext || 'No articles available'}

Generate a JSON response. Respond ONLY with valid JSON, no markdown, no backticks:
{
  "catalyst_note": "A 3-4 sentence analyst-grade catalyst note in Goldman Sachs research style. Sentence 1: WHAT the catalyst is and its timing. Sentence 2: WHY it matters structurally — reference specific metrics/figures from the articles. Sentence 3: WHAT specific metric or event to watch. Sentence 4: WHAT the market reaction could look like for comparable companies, sector multiples, or deal flow. Use exact company names and figures from the source articles.",
  "evidence": [
    {
      "article_index": 0,
      "label": "2-4 word analytical tag",
      "type": "support" or "context" or "risk",
      "bridge": "One precise sentence connecting this article to the thesis, citing specific data points."
    }
  ]
}

Rules:
- One evidence entry per article (${articleList.length} total)
- catalyst_note must reference specific companies, dollar figures, and dates from source articles
- bridge must cite specific data — no generic statements`

    const detailCompletion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: detailPrompt }],
      max_tokens: 1200,
      temperature: 0.3,
    })

    let catalystNote = ''
    let evidenceChain = []
    try {
      const parsed = JSON.parse(
        (detailCompletion.choices[0]?.message?.content || '{}').replace(/```json|```/g, '').trim()
      )
      catalystNote = parsed.catalyst_note || ''
      evidenceChain = parsed.evidence || []
    } catch (e) {
      // Parse failed — still save rationale
    }

    // Save everything back to Supabase
    const updateData = { rationale: newRationale }
    if (catalystNote) updateData.catalyst_note = catalystNote
    if (evidenceChain.length > 0) updateData.evidence_chain = evidenceChain

    const { error: updateErr } = await supabase
      .from('theses')
      .update(updateData)
      .eq('id', thesisId)

    if (updateErr) {
      console.error('Supabase update error:', updateErr)
    }

    res.status(200).json({
      thesis: {
        ...thesis,
        rationale: newRationale,
        catalyst_note: catalystNote,
        evidence_chain: evidenceChain,
      }
    })

  } catch (err) {
    console.error('Thesis regenerate error:', err)
    res.status(500).json({ error: 'Failed to regenerate thesis' })
  }
}
