import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { company, acquirer, deal_type, value, sector, description } = req.body

  if (!company) return res.status(400).json({ error: 'company is required' })

  const prompt = `You are a senior investment banking analyst. Generate a concise, professional 1-page deal memo for the following transaction. Use IB-standard language. Be specific and analytical — not generic.

TRANSACTION DATA:
- Target/Company: ${company}
- Acquirer: ${acquirer || 'Undisclosed'}
- Deal Type: ${deal_type || 'M&A'}
- Deal Value: ${value || 'Undisclosed'}
- Sector: ${sector || 'Technology'}
- Context: ${description || 'No additional context provided'}

Generate the memo in this exact structure — use these exact section headers:

TRANSACTION OVERVIEW
[2-3 sentences summarizing the deal]

STRATEGIC RATIONALE
[3 bullet points explaining why this deal makes sense for the acquirer]

COMPARABLE TRANSACTIONS
[2-3 recent comparable deals with approximate values]

KEY RISKS
[3 bullet points covering integration, regulatory, or market risks]

ANALYST TAKE
[1-2 sentences with a direct risk/reward assessment and recommendation]

Keep the entire memo under 350 words. Be direct and specific.`

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.4,
    })

    const memo = completion.choices[0]?.message?.content || ''
    res.status(200).json({ memo })
  } catch (err) {
    console.error('Groq memo error:', err)
    res.status(500).json({ error: 'Failed to generate memo' })
  }
}
