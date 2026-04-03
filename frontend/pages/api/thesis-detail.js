import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { thesis, articles } = req.body
  if (!thesis) return res.status(400).json({ error: 'thesis is required' })

  const articleList = (articles || []).slice(0, 8)
  const articleContext = articleList.map((a, i) =>
    `${i + 1}. "${a.title}" (${a.source || 'Unknown'})${a.summary ? ' — ' + a.summary.slice(0, 100) : ''}`
  ).join('\n')

  const prompt = `You are a senior investment analyst. Given a thesis and its related articles, generate two things:

THESIS:
- Title: ${thesis.title}
- Conviction: ${thesis.conviction}
- Rationale: ${thesis.rationale || ''}
- Catalyst: ${thesis.catalyst || 'None specified'}
- Sector: ${thesis.sector || 'General'}

RELATED ARTICLES:
${articleContext || 'No articles available'}

Generate a JSON response with exactly this structure. Respond ONLY with valid JSON, no markdown, no backticks:
{
  "catalyst_note": "2-3 sentences elaborating WHY the catalyst matters. What could happen if it triggers? What should investors watch for? What is the timeframe?",
  "evidence": [
    {
      "article_index": 0,
      "label": "Supports bull case" or "Key data point" or "Risk factor" or "Sector signal" or "Context",
      "type": "support" or "context" or "risk",
      "bridge": "One sentence reasoning bridge connecting this article to the thesis, e.g. 'Confirms enterprise AI spend is accelerating, supporting the bull case for cloud infrastructure plays'"
    }
  ]
}

Rules:
- Generate exactly one evidence entry per article provided (${articleList.length} total)
- label should be a short 2-4 word tag describing the article's relationship
- type must be "support" (green), "context" (yellow), or "risk" (red)
- bridge should be a specific, analytical one-sentence connection — not generic
- catalyst_note should be actionable and time-specific if possible`

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed = {}
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse AI response' })
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.status(200).json(parsed)
  } catch (err) {
    console.error('Thesis detail error:', err)
    res.status(500).json({ error: 'Failed to generate thesis detail' })
  }
}
