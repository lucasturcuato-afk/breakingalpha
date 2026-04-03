/*
  Requires these columns on the theses table (run in Supabase SQL Editor):

  ALTER TABLE theses ADD COLUMN IF NOT EXISTS catalyst_note text;
  ALTER TABLE theses ADD COLUMN IF NOT EXISTS evidence_chain jsonb;

  Also add update policy if not present:
  CREATE POLICY "Public update" ON theses FOR UPDATE USING (true) WITH CHECK (true);
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

  const { thesis, articles, thesisId } = req.body
  if (!thesis) return res.status(400).json({ error: 'thesis is required' })

  const articleList = (articles || []).slice(0, 8)
  const articleContext = articleList.map((a, i) =>
    `${i + 1}. "${a.title}" (${a.source || 'Unknown'})${a.summary ? '\n   Summary: ' + a.summary.slice(0, 200) : ''}`
  ).join('\n\n')

  const prompt = `You are a senior equity research analyst at Goldman Sachs writing internal research notes. Given a thesis and its contributing source articles, generate two outputs.

THESIS:
- Title: ${thesis.title}
- Conviction: ${thesis.conviction} (score context: BULLISH=high confidence positive, BEARISH=high confidence negative, WATCH=monitoring)
- Current Analysis: ${thesis.rationale || ''}
- Catalyst Label: ${thesis.catalyst || 'None specified'}
- Sector: ${thesis.sector || 'General'}

SOURCE ARTICLES (these were used to generate the thesis):
${articleContext || 'No articles available'}

Generate a JSON response with exactly this structure. Respond ONLY with valid JSON, no markdown, no backticks:
{
  "catalyst_note": "A 3-4 sentence analyst-grade catalyst note in the style of a Goldman Sachs or Bloomberg Intelligence research note. Sentence 1: State WHAT the catalyst is and its specific timing/date if known. Sentence 2: Explain WHY it matters structurally to the thesis — what does it validate or invalidate? Reference specific metrics, dollar figures, or growth rates from the source articles. Sentence 3: Identify WHAT specific data point, metric, or executive commentary to watch when the catalyst triggers. Sentence 4: Describe WHAT the market reaction could look like — impact on comparable companies, sector multiples, or deal flow. Use the exact terminology, company names, and figures from the source articles. Write with confidence and precision — no hedging language like 'could potentially' or 'might possibly'.",
  "evidence": [
    {
      "article_index": 0,
      "label": "Supports bull case" or "Key data point" or "Risk factor" or "Sector signal" or "Valuation anchor" or "Deal precedent" or "Regulatory risk",
      "type": "support" or "context" or "risk",
      "bridge": "One precise analytical sentence connecting this article to the thesis. Reference specific figures, companies, or data points from the article. Example: 'Microsoft's $13B Azure revenue run-rate confirms enterprise cloud spend acceleration at 29% YoY, directly supporting the bull case for infrastructure plays.'"
    }
  ]
}

Rules:
- Generate exactly one evidence entry per article provided (${articleList.length} total)
- catalyst_note MUST reference specific companies, dollar figures, percentages, or dates from the source articles — never genericize
- catalyst_note should read like it came from a Bloomberg Terminal research note, not a news summary
- label should be a concise 2-4 word analytical tag
- type: "support" (confirms thesis), "context" (relevant background), "risk" (threatens thesis)
- bridge must cite specific data from the article — no generic connections like "this is relevant to the sector"`

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed = {}
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse AI response' })
    }

    // Save back to Supabase if thesisId provided
    if (thesisId && (parsed.catalyst_note || parsed.evidence)) {
      try {
        const updateData = {}
        if (parsed.catalyst_note) updateData.catalyst_note = parsed.catalyst_note
        if (parsed.evidence) updateData.evidence_chain = parsed.evidence
        await supabase.from('theses').update(updateData).eq('id', thesisId)
      } catch (e) {
        // Columns may not exist yet — graceful fallback
        console.error('Failed to save enrichment to Supabase:', e)
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.status(200).json(parsed)
  } catch (err) {
    console.error('Thesis detail error:', err)
    res.status(500).json({ error: 'Failed to generate thesis detail' })
  }
}
