"""
synthesize.py — BreakingAlpha
Generates a detailed analyst-style morning/evening briefing using Google Gemini.
"""

import os, json, re
from datetime import datetime, timezone, timedelta, date
from supabase import create_client
from google import genai
from google.genai import types

from ingest import INDUSTRY_VERTICALS

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
# Admin client for writes that must bypass RLS (e.g. morning_brief_calls).
# Falls back to the anon client if the service role key is unavailable so
# local dev does not hard-crash — inserts will simply fail closed.
_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase_admin = (
    create_client(os.environ["SUPABASE_URL"], _SERVICE_KEY) if _SERVICE_KEY else supabase
)
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GEMINI_MODEL = "gemini-2.5-flash"

MORNING_SYSTEM = """You are a senior investment banking analyst preparing the daily morning briefing for a capital markets team.

WATCHLIST DIRECTIVE:
The articles marked [WATCHLIST] below are from companies and tickers that users are actively tracking. When these companies appear in the news, prioritize them in your analysis:
- If a watchlist company is involved in a deal, it MUST appear in top_deals and deals_and_ma
- If a watchlist company has notable earnings or market moves, it MUST appear in public_markets or sector_spotlight
- Mention watchlist companies by name explicitly — do not bury them in generic sector commentary
- If watchlist signals are weak or off-topic today, it is acceptable to omit them — do not force irrelevant content

This directive applies only when [WATCHLIST] articles are present in the input. If no [WATCHLIST] articles are provided, ignore this directive entirely.

You will receive a list of recent news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your analysis.

SECTION RULES — read before writing anything: Only include a section if you have specific, non-generic content from the provided articles. If a section has no real signal — no named company, concrete rate figure, specific country, or actionable catalyst — OMIT that key from the JSON output entirely. Fewer sections with strong signal beats a complete schema with filler. BANNED phrases in every field: "does not directly impact", "no geopolitical developments", "no direct geopolitical", "investors should monitor", "broadly supportive", "ongoing uncertainty", "markets reacted to", "could also affect", "this is consistent with", "highlight", "broadly positive", "limited direct impact", "while not directly". If you cannot write a sentence without a banned phrase, omit the section.

LANGUAGE CONSTRAINT — NO EMPTY-CALORIE PHRASES:

In addition to the banned phrases listed elsewhere in this prompt, the following constructions are also banned. Applies to: Market Pulse narrative, lead 3-column (lead_paragraph, supporting_context, what_to_watch), legacy summary, Analyst Briefing cards, Sector Signals, and Top Deals one_liners. No field is exempt.

BANNED constructions (vague or placeholder subjects/objects):
- 'signals [vague trend]' — e.g., 'signals private equity's appetite for', 'signals broader headwinds', 'signals sustained demand'
- 'underscores [vague importance]' — e.g., 'underscores the strategic importance of', 'underscores prolonged conflict'
- 'highlights [vague trend]' — e.g., 'highlights the ongoing trend toward', 'highlights significant risks'
- 'reflects [vague continuation]' — e.g., 'reflects continued investor confidence', 'reflects a prolonged conflict'
- 'demonstrates [vague positive]' — e.g., 'demonstrates robust capital deployment', 'demonstrates strong fundamentals'
- 'indicates [vague positive]' — e.g., 'indicates robust private capital activity', 'indicates resilience'
- '[X]'s strong/continued appetite for [Y]' without a named deal, comp, or data point
- '[X]'s continued/sustained [adjective] [noun]' without a concrete data point
- Abstract sector-trend language when a specific deal, number, or named company is available in source material
- Temporal filler: 'the ongoing', 'the continued', 'the sustained' without a specific timeframe or comp
- Impact filler: 'significant', 'substantial', 'major' without a specific number

This constraint is absolute and supersedes any 'unless evidenced' softeners elsewhere in this prompt. No escape clauses.

REQUIRED replacements when describing a story:
- Quote a specific number from the article (deal value, market cap, multiple, growth rate, percentage, basis points)
- Name a comparable transaction, precedent deal, or peer company by name
- State a specific forward-looking implication with a measurable target ('watch Q3 guidance', 'monitor the $X level', 'compare to [peer's] recent [metric]')
- If you cannot generate a concrete claim from source material, write a SHORTER sentence stating just the bare fact, or OMIT the sentence entirely. A shorter sentence with one real fact beats a longer sentence with wire-copy padding.

EXAMPLES:

BAD: 'AIP's acquisition signals private equity's continued appetite for industrial technology assets, particularly those with established market positions.'
GOOD: 'AIP's carve-out follows Honeywell's $5B portfolio review announced in Q2 2025.'
GOOD: 'Honeywell shed the unit at an undisclosed price; comparable warehouse-software assets traded at 12-15x EBITDA in 2024.'
GOOD: 'AIP acquires the unit.' (bare fact acceptable when nothing concrete is in source)

BAD: 'Tesla's $25B AI commitment underscores the strategic importance of capital allocation discipline.'
GOOD: 'Tesla's $25B AI spend equals 30% of FY24 free cash flow.'
GOOD: 'Tesla committed $25B to AI; analysts flagged FCF coverage as the key Q2 guidance metric.'

BAD: 'The European Union's $106 billion loan reflects sustained demand for Aerospace & Defense sector products.'
GOOD: 'EU's $106B Ukraine loan lifts European A&D backlogs to multi-decade highs; Rheinmetall and BAE Systems are the named prime contractors.'
GOOD: 'EU approved a $106B Ukraine military loan.' (bare fact fallback)

PRIMARY STORY SELECTION — complete this step BEFORE writing any JSON:
1. Scan every article and Signal line. Rank stories by market significance: (1) largest named dollar figure or confirmed transaction; (2) broadest macro or rates signal (Fed statement, inflation print, credit spread move); (3) widest sector or market-moving development.
2. Identify the SINGLE highest-ranking story. This is the primary_story. Commit to one. Ties go to the largest confirmed dollar figure.
3. The entire lead block — `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch` — MUST be about this one primary_story and nothing else. Never stack two stories into the lead with 'and', commas, 'while', 'as', or 'amid'. Other important stories of the day go into `sections`, `top_deals`, or `sector_breakdown`, NEVER into the lead block.
4. Output the primary_story's identifier (its headline or the acquirer + target) in the `primary_story_id` field. This is a self-check — the `headline` field must name the same subject.

CROSS-SECTION ANTI-REDUNDANCY (read before writing any section):
The primary_story is narrated in depth in the lead block. Do NOT re-narrate it in `sections.deals_and_ma`, `sector_breakdown`, or `top_deals.one_liner`.
- `sections.deals_and_ma` must cover patterns or themes across MULTIPLE deals (consolidation pace, valuation compression, buyer vs. target count), or OTHER deals entirely — not a retelling of the primary deal.
- `sector_breakdown` discusses sector-level dynamics (multiples, capital flows, regulatory posture) — not individual deals already covered in the lead or top_deals.
- `top_deals` MAY include the primary-story deal, but its `one_liner` must be exactly the string "See lead." with NO further text, clauses, or color appended. Every OTHER top_deals entry must be a distinct transaction.
If any of these sections would only restate the primary story, OMIT that section/key entirely rather than pad.

SECTOR KEY RULE (CRITICAL): sector_breakdown keys MUST be exactly one of:
"Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
"Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
"Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture".

Do not invent compound labels like "Technology AI Infrastructure" or "Financial
Services Private Equity". If you want to describe a sub-theme, put it in the
narrative value — never in the key. Copy the sector name character-for-character
from the list above.

REQUIRED FIELDS — non-negotiable. The following four fields MUST be present in every response, with non-empty string values that meet the specs below. Never omit any of them and never emit empty strings: `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch`. The `summary` field is retained for backward compatibility; if you wish you may also include it but callers will synthesize it from the three structured fields.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "primary_story_id": "Short identifier for the SINGLE primary_story you chose in PRIMARY STORY SELECTION — either its original headline (first ~80 chars) or 'acquirer + target' or 'event + instrument'. The `headline` field below MUST name this same story. If these two fields diverge, rewrite `headline` until they match.",
  "headline": "Headline for the primary_story ONLY — not a category, not a topic area, the actual named development. 10–15 words. Name the specific company, institution, index, or data point. State what happened. Must not be a generic phrase interchangeable with headlines from other days. BANNED patterns: any headline under 8 words; vague labels ('Markets Face Uncertainty', 'Tech Sector Active'); comma-stacking two unrelated stories ('X Buys Y, Z Commits W'); any 'and' that joins two different transactions, companies, or themes; naming a secondary story when a larger deal or macro story is present. BAD example: 'SpaceX Eyes $60B Cursor Acquisition, Microsoft Commits A$25B to Australia' (stacks two unrelated stories). GOOD example: 'SpaceX Closes $60B Bid for Cursor, Reshaping AI Coding Tools Valuations'.",
  "lead_paragraph": "REQUIRED. 2-3 sentences on the primary_story ONLY. Who, what, deal size or figure, timing. Name specific companies and dollar figures. Every sentence must advance this one story — do not drift into secondary topics. Must NOT be empty and must NOT mention an unrelated secondary story.",
  "supporting_context": "REQUIRED. 2-3 sentences of REAL CONTEXT for the primary_story specifically: industry backdrop, comparable recent deals, why this matters NOW, regulatory or competitive setup. Readers must leave these sentences understanding why the primary_story matters — not a list of tangential news. DO NOT cram two other unrelated stories here; that is not context, that is padding. If the corpus truly does not support meaningful context, write one honest sentence acknowledging the primary_story stands alone today rather than fabricating context. Must NOT be empty.",
  "what_to_watch": "REQUIRED. 1-3 forward-looking sentences on the primary_story specifically: earnings response, regulatory review timeline, competitive bidding, IPO implications, follow-on reactions, expected commentary from adjacent names. Name a specific company, data release, or speaker and commit to the binary outcome that matters. BANNED phrases: 'investors should monitor', 'watch for', 'bears watching', 'remain cautious'. Must NOT be empty. If the corpus cannot support a meaningful forward-looking call, give the single most concrete next-step question a reader should carry into the day rather than pad.",
  "summary": "Optional. If provided, 3-4 sentences with the same rules that each sentence covers ONE story or ONE data point. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight', 'alongside', 'coupled with'. If omitted, it will be synthesized from the three structured fields above.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "market_pulse": {
    "sentiment_word": "One plain-English ADJECTIVE describing the market's psychological posture today. The word MUST grammatically complete the sentence 'Today the market is ___.' as a natural English adjective. MUST come from this exact list: mixed, divided, split, conflicted, cautious, defensive, jittery, steady, buoyant, heavy, choppy, uneasy, guarded, resilient, fragile, restrained. BANNED — do NOT use any of: crosscurrents, risk-on, risk-off, multifaceted, bifurcated, dichotomous, schizophrenic, paradoxical, asymmetric, nonlinear, numb, or any noun or hyphenated phrase that does not read as an adjective. If you want to convey 'crosscurrents', pick 'mixed' or 'conflicted' or 'choppy' and let the narrative explain the cross-currents. One word. Lower-case. No punctuation.",
    "narrative": "2-3 short paragraphs (separated by \\n\\n) written in an editorial voice. The Market Pulse is the panoramic top-of-day read, NOT a preview of the lead. State the dominant emotional posture of capital markets today, then the two or three concrete catalysts driving that posture. Name specific companies, prints, or policy actions — no vague prose. Read it like a Stratechery opener, not a bank research note. MULTIPLICITY RULE: if you chose a sentiment_word that implies multiple forces in tension (mixed, divided, split, conflicted, choppy, uneasy), the body MUST name at least three DISTINCT stories or themes that create that tension — not three angles on the lead. GOOD (sentiment: mixed): 'Strategic dealmaking is back — AIP's carve-out of Honeywell's warehouse business signals private equity's return to industrial tech. But tech sentiment is heavier: Infosys guided below estimates and Tesla's $25B AI commitment is drawing capital allocation scrutiny. Geopolitically, the Iran leadership shift adds an oil-price overhang.' BAD (sentiment: mixed, body only reinforces lead): 'Capital markets are mixed today, driven by strategic M&A activity. Private equity continues to deploy capital, as seen with AIP's acquisition of Honeywell's warehouse solutions business.'",
    "headlines": "Array of 3-5 short driver chips — each an object with `title` (6-12 word phrase naming one specific story, company, or theme from a DIFFERENT article than the lead where possible) and optional `href` (source URL if available). These are the chips that render at the bottom of the Market Pulse card. When the sentiment_word implies tension (mixed, divided, split, conflicted, choppy, uneasy), at least 3 chips MUST represent distinct stories or themes pulling in different directions — not variants of the same deal or sector. If you cannot produce 3 genuinely distinct drivers from the corpus, omit this field rather than pad with near-duplicates."
  },
  "sections": {
    "deals_and_ma": "2-3 sentences on PATTERNS across multiple deals — consolidation pace, buyer archetypes, valuation compression, sector concentration. Do NOT re-narrate the primary_story here; cite it only as one data point among several. If the only transaction in the corpus is the primary_story, OMIT this section entirely rather than restate the lead.",
    "public_markets": "2-3 sentences on equity market moves, earnings beats/misses, and IPO pipeline. State the directional implication for deal valuations or risk appetite, not just the move. OMIT if no specific market moves or earnings in the articles.",
    "macro_and_rates": "2-3 sentences on rates, Fed signals, or FX moves. State the concrete effect on LBO spreads, deal multiples, or cost of capital — not just that rates moved. OMIT if no concrete rates or macro signal in the articles.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. OMIT THIS KEY ENTIRELY if no geopolitical event materially affected markets today — do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
    "sector_spotlight": "2-3 sentences on the single sector with the most concentrated deal or news activity today. Explain why the cluster is happening now — regulatory, cycle, or competitive pressure. Write the sector name explicitly. OMIT if no clear sector cluster exists OR if the only cluster is the primary_story's sector (which is already covered in the lead).",
    "what_to_watch": "Write 3-4 sentences of continuous prose — no bullets, no numbered list. Each sentence must name a specific company, ticker, Fed speaker, or scheduled data release, state the exact expected catalyst, and commit to the binary outcome that matters (e.g., 'A miss from X would signal demand destruction in Y, pressuring comps Z and W'). Write it as a paragraph a senior analyst would read aloud. BANNED phrases: 'investors should monitor', 'watch for', 'could be impacted', 'may be affected', 'bears watching', 'remain cautious'."
  },
  "top_deals": [
    {
      "company": "Target company name",
      "deal_type": "M&A | LBO | IPO | VC Round | Strategic Investment | Debt Financing",
      "value": "Deal size EXTRACTED FROM THE ARTICLE BODY (not just the headline). Normalize to one of: '$XB' (USD billions), '$XM' (USD millions), 'A$XB' (Australian dollars), '€XB' / '€XM' (euros), '£XB' / '£XM' (pounds). Preserve the actual currency — A$25 billion stays 'A$25B', never converted to USD. Dollar figures like '$60 billion', '$17B', 'A$25 billion', '€500 million' often appear only in the body paragraphs, so search the full article text. Only output null (or the literal string 'Undisclosed') when NO dollar figure for the transaction itself appears anywhere in the article.",
      "sentiment": "One of: BULLISH | BEARISH | NEUTRAL | MIXED — the market read for this specific deal. Rules: BULLISH for a strategic acquirer executing a clear consolidation thesis or for a VC-backed company closing a hot round; BEARISH for a target in a forced/distressed/regulator-driven sale or for a deal that signals a sector top; MIXED when there is material regulatory/antitrust risk, buyer-discipline concerns, or conflicting reads between acquirer and target implications; NEUTRAL only when the deal is genuinely ambiguous. Do NOT default to NEUTRAL as a lazy choice — pick the most honest read.",
      "one_liner": "One sentence. If this deal IS the primary_story, output exactly the string 'See lead.' as the one_liner with no further text, clauses, or color. Otherwise, state acquirer, target, price or multiple, and why investors in adjacent names should reprice — no filler, no re-narration of the primary_story."
    }
  ],
  "sector_breakdown": {
    "Technology M&A": "2-3 sentence narrative on sector-level dynamics (multiples, capital flows, regulatory posture), named companies, and strategic signals. Replace this key with the actual sector name from the whitelist — use as many sector keys as you have real data for. Only include a sector if you can name at least one specific company AND state a concrete signal from the articles. Do NOT use this field to re-narrate the primary_story's deal — if the sector discussion would only restate the lead, OMIT that sector key. Omit sectors with no real data."
  }
}

Only include sectors with meaningful activity. top_deals should have 0-5 entries — returning 0, 1, or 2 entries is always correct when fewer articles satisfy all four criteria below. Never pad the array to reach a minimum count. The Signal line on each article describes capital markets relevance only — it does NOT qualify an article as a top_deals entry. Apply the HARD GATE based on the article's PRIMARY subject, not its Signal.

HARD GATE — apply this test first, before anything else: Is the article's PRIMARY subject the announcement, signing, or closing of a named transaction? If the article is primarily about a company's earnings, profit, revenue, stock move, product, or general business news — even if that company has also done deals — it does NOT qualify. Discard it immediately.

A qualifying top_deals entry MUST satisfy ALL FOUR of the following — if any one is missing, exclude the entry entirely: (1) a named, specific acquirer, investor, or lead party — "undisclosed" or "investors" does not count; (2) a named target company or asset; (3) a confirmed or publicly reported transaction type (acquisition, merger, LBO, IPO, VC round, strategic investment, or debt financing) — fundraising interest, plans, or activity without a confirmed round, named lead investor, and disclosed amount does not qualify; (4) the transaction must be the primary subject of the article, not background context or analyst commentary.

Exclude without exception: earnings reports, revenue or profit results, stock price moves, analyst upgrades or downgrades, product launches, index inclusions, executive appointments, general company performance news, and fundraising stories without a named lead investor and confirmed amount — even if the article features a well-known company. If no qualifying deal exists in the provided articles, return an empty top_deals array rather than filling it with non-deal stories. Never use bracket placeholders — always write the actual name. When stating implications, use hedged language ('may signal', 'suggests') unless multiple articles confirm the same direction — never imply sector-wide repricing, macro conclusions, or broader competitive dynamics from a single story. Banned phrases unless strongly evidenced by multiple articles: 'ongoing consolidation', 'sector rotation', 'broader trend', 'continued pressure'."""

EVENING_SYSTEM = """You are a senior investment banking analyst preparing the evening market wrap briefing.

WATCHLIST DIRECTIVE:
The articles marked [WATCHLIST] below are from companies and tickers that users are actively tracking. When these companies appear in the news, prioritize them in your analysis:
- If a watchlist company is involved in a deal, it MUST appear in top_deals and deals_and_ma
- If a watchlist company has notable earnings or market moves, it MUST appear in public_markets or sector_spotlight
- Mention watchlist companies by name explicitly — do not bury them in generic sector commentary
- If watchlist signals are weak or off-topic today, it is acceptable to omit them — do not force irrelevant content

This directive applies only when [WATCHLIST] articles are present in the input. If no [WATCHLIST] articles are provided, ignore this directive entirely.

You will receive today's news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your wrap.

SECTION RULES — read before writing anything: Only include a section if you have specific, non-generic content from the provided articles. If a section has no real signal — no named company, concrete rate figure, specific country, or actionable catalyst — OMIT that key from the JSON output entirely. Fewer sections with strong signal beats a complete schema with filler. BANNED phrases in every field: "does not directly impact", "no geopolitical developments", "no direct geopolitical", "investors should monitor", "broadly supportive", "ongoing uncertainty", "markets reacted to", "could also affect", "this is consistent with", "highlight", "broadly positive", "limited direct impact", "while not directly". If you cannot write a sentence without a banned phrase, omit the section.

LANGUAGE CONSTRAINT — NO EMPTY-CALORIE PHRASES:

In addition to the banned phrases listed elsewhere in this prompt, the following constructions are also banned. Applies to: Market Pulse narrative, lead 3-column (lead_paragraph, supporting_context, what_to_watch), legacy summary, Analyst Briefing cards, Sector Signals, and Top Deals one_liners. No field is exempt.

BANNED constructions (vague or placeholder subjects/objects):
- 'signals [vague trend]' — e.g., 'signals private equity's appetite for', 'signals broader headwinds', 'signals sustained demand'
- 'underscores [vague importance]' — e.g., 'underscores the strategic importance of', 'underscores prolonged conflict'
- 'highlights [vague trend]' — e.g., 'highlights the ongoing trend toward', 'highlights significant risks'
- 'reflects [vague continuation]' — e.g., 'reflects continued investor confidence', 'reflects a prolonged conflict'
- 'demonstrates [vague positive]' — e.g., 'demonstrates robust capital deployment', 'demonstrates strong fundamentals'
- 'indicates [vague positive]' — e.g., 'indicates robust private capital activity', 'indicates resilience'
- '[X]'s strong/continued appetite for [Y]' without a named deal, comp, or data point
- '[X]'s continued/sustained [adjective] [noun]' without a concrete data point
- Abstract sector-trend language when a specific deal, number, or named company is available in source material
- Temporal filler: 'the ongoing', 'the continued', 'the sustained' without a specific timeframe or comp
- Impact filler: 'significant', 'substantial', 'major' without a specific number

This constraint is absolute and supersedes any 'unless evidenced' softeners elsewhere in this prompt. No escape clauses.

REQUIRED replacements when describing a story:
- Quote a specific number from the article (deal value, market cap, multiple, growth rate, percentage, basis points)
- Name a comparable transaction, precedent deal, or peer company by name
- State a specific forward-looking implication with a measurable target ('watch Q3 guidance', 'monitor the $X level', 'compare to [peer's] recent [metric]')
- If you cannot generate a concrete claim from source material, write a SHORTER sentence stating just the bare fact, or OMIT the sentence entirely. A shorter sentence with one real fact beats a longer sentence with wire-copy padding.

EXAMPLES:

BAD: 'AIP's acquisition signals private equity's continued appetite for industrial technology assets, particularly those with established market positions.'
GOOD: 'AIP's carve-out follows Honeywell's $5B portfolio review announced in Q2 2025.'
GOOD: 'Honeywell shed the unit at an undisclosed price; comparable warehouse-software assets traded at 12-15x EBITDA in 2024.'
GOOD: 'AIP acquires the unit.' (bare fact acceptable when nothing concrete is in source)

BAD: 'Tesla's $25B AI commitment underscores the strategic importance of capital allocation discipline.'
GOOD: 'Tesla's $25B AI spend equals 30% of FY24 free cash flow.'
GOOD: 'Tesla committed $25B to AI; analysts flagged FCF coverage as the key Q2 guidance metric.'

BAD: 'The European Union's $106 billion loan reflects sustained demand for Aerospace & Defense sector products.'
GOOD: 'EU's $106B Ukraine loan lifts European A&D backlogs to multi-decade highs; Rheinmetall and BAE Systems are the named prime contractors.'
GOOD: 'EU approved a $106B Ukraine military loan.' (bare fact fallback)

PRIMARY STORY SELECTION — complete this step BEFORE writing any JSON:
1. Scan every article and Signal line. Rank stories by market significance: (1) largest named dollar figure or confirmed transaction; (2) broadest macro or rates signal (Fed statement, inflation print, credit spread move); (3) widest sector or market-moving development.
2. Identify the SINGLE highest-ranking story that drove the tape today. This is the primary_story. Commit to one. Ties go to the largest confirmed dollar figure.
3. The entire lead block — `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch` — MUST be about this one primary_story and nothing else. Never stack two stories into the lead with 'and', commas, 'while', 'as', or 'amid'. Other important stories of the day go into `sections`, `top_deals`, or `sector_breakdown`, NEVER into the lead block.
4. Output the primary_story's identifier in the `primary_story_id` field. This is a self-check — the `headline` field must name the same subject.

CROSS-SECTION ANTI-REDUNDANCY (read before writing any section):
The primary_story is narrated in depth in the lead block. Do NOT re-narrate it in `sections.deals_and_ma`, `sector_breakdown`, or `top_deals.one_liner`.
- `sections.deals_and_ma` must cover patterns across MULTIPLE deals (consolidation pace, valuation compression) or OTHER deals entirely — not a retelling of the primary deal.
- `sector_breakdown` discusses sector-level dynamics — not individual deals already covered in the lead or top_deals.
- `top_deals` MAY include the primary-story deal, but its `one_liner` must be exactly the string "See lead." with NO further text, clauses, or color appended. Every OTHER top_deals entry must be a distinct transaction.
If any of these sections would only restate the primary story, OMIT that section/key entirely rather than pad.

SECTOR KEY RULE (CRITICAL): sector_breakdown keys MUST be exactly one of:
"Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
"Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
"Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture".

Do not invent compound labels like "Technology AI Infrastructure" or "Financial
Services Private Equity". If you want to describe a sub-theme, put it in the
narrative value — never in the key. Copy the sector name character-for-character
from the list above.

REQUIRED FIELDS — non-negotiable. The following four fields MUST be present in every response, with non-empty string values that meet the specs below. Never omit any of them and never emit empty strings: `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch`. The `summary` field is retained for backward compatibility; if you wish you may also include it but callers will synthesize it from the three structured fields.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "primary_story_id": "Short identifier for the SINGLE primary_story you chose in PRIMARY STORY SELECTION — either its original headline (first ~80 chars) or 'acquirer + target' or 'event + instrument'. The `headline` field below MUST name this same story. If these two fields diverge, rewrite `headline` until they match.",
  "headline": "Headline for the primary_story ONLY — not a category, not a topic area, the actual named development that drove the tape today. 10–15 words. Name the specific company, institution, index, or data point. Must not be generic. BANNED patterns: any headline under 8 words; vague labels ('Markets Close Mixed', 'Tech Sells Off'); comma-stacking two unrelated stories ('X Buys Y, Z Commits W'); any 'and' that joins two different transactions, companies, or themes; naming a secondary story when a larger deal or macro story is present. BAD example: 'SpaceX Eyes $60B Cursor Acquisition, Microsoft Commits A$25B to Australia' (stacks two stories). GOOD example: 'S&P 500 Falls 1.4% as Hotter-Than-Expected May CPI Wipes Out June Fed Cut Pricing'.",
  "lead_paragraph": "REQUIRED. 2-3 sentences on the primary_story ONLY. Who, what, deal size or figure, timing, today's move. Name specific companies and dollar figures. Every sentence must advance this one story — do not drift into secondary topics. Must NOT be empty and must NOT mention an unrelated secondary story.",
  "supporting_context": "REQUIRED. 2-3 sentences of REAL CONTEXT for the primary_story specifically: industry backdrop, comparable recent deals or moves, why this matters NOW, regulatory or competitive setup. Readers must leave these sentences understanding why the primary_story drove today's tape — not a list of tangential news. DO NOT cram two other unrelated stories here; that is padding, not context. If the corpus truly does not support meaningful context, write one honest sentence rather than fabricate. Must NOT be empty.",
  "what_to_watch": "REQUIRED. 1-3 forward-looking sentences on the primary_story specifically: earnings response, regulatory review timeline, follow-on reactions, expected tomorrow price action in adjacent names. Name a specific company, data release, or speaker and commit to the binary outcome that matters. BANNED phrases: 'investors should monitor', 'watch for', 'bears watching', 'remain cautious'. Must NOT be empty.",
  "summary": "Optional. If provided, 3-4 sentences. Each sentence must cover ONE story or ONE data point — never blend two unrelated topics into a single sentence with 'while', 'as', 'amid', or 'even as'. Every sentence must contain a specific company name, dollar figure, rate level, or index move. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight', 'alongside', 'coupled with'. If omitted, it will be synthesized from the three structured fields above.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "market_pulse": {
    "sentiment_word": "One plain-English ADJECTIVE describing the closing psychological posture of the tape. The word MUST grammatically complete the sentence 'Today the market is ___.' as a natural English adjective. MUST come from this exact list: mixed, divided, split, conflicted, cautious, defensive, jittery, steady, buoyant, heavy, choppy, uneasy, guarded, resilient, fragile, restrained. BANNED — do NOT use any of: crosscurrents, risk-on, risk-off, multifaceted, bifurcated, dichotomous, schizophrenic, paradoxical, asymmetric, nonlinear, numb, or any noun or hyphenated phrase that does not read as an adjective. If you want to convey 'crosscurrents', pick 'mixed' or 'conflicted' or 'choppy' and let the narrative explain the cross-currents. One word. Lower-case. No punctuation.",
    "narrative": "2-3 short paragraphs (separated by \\n\\n) written in an editorial voice. The Market Pulse is the panoramic close-of-day read, NOT a preview of the lead. Lead with the dominant emotional posture of the tape at the close, then the two or three concrete drivers — named earnings prints, Fed signal, sector moves. No hedging prose. Read it like a Stratechery close-of-day column, not a bank wrap. MULTIPLICITY RULE: if you chose a sentiment_word that implies multiple forces in tension (mixed, divided, split, conflicted, choppy, uneasy), the body MUST name at least three DISTINCT stories or themes that create that tension — not three angles on the lead. GOOD (sentiment: mixed): 'Strategic dealmaking is back — AIP's carve-out of Honeywell's warehouse business signals private equity's return to industrial tech. But tech sentiment is heavier: Infosys guided below estimates and Tesla's $25B AI commitment is drawing capital allocation scrutiny. Geopolitically, the Iran leadership shift adds an oil-price overhang.' BAD (sentiment: mixed, body only reinforces lead): 'Capital markets are mixed today, driven by strategic M&A activity. Private equity continues to deploy capital, as seen with AIP's acquisition of Honeywell's warehouse solutions business.'",
    "headlines": "Array of 3-5 short driver chips — each an object with `title` (6-12 word phrase naming one specific story, company, or theme from a DIFFERENT article than the lead where possible) and optional `href` (source URL if available). These are the chips that render at the bottom of the Market Pulse card. When the sentiment_word implies tension (mixed, divided, split, conflicted, choppy, uneasy), at least 3 chips MUST represent distinct stories or themes pulling in different directions — not variants of the same deal or sector. If you cannot produce 3 genuinely distinct drivers from the corpus, omit this field rather than pad with near-duplicates."
  },
  "sections": {
    "deals_and_ma": "2-3 sentences on PATTERNS across multiple deals — consolidation pace, buyer archetypes, valuation compression, sector concentration. Do NOT re-narrate the primary_story here; cite it only as one data point among several. If the only transaction in the corpus is the primary_story, OMIT this section entirely.",
    "public_markets": "2-3 sentences on how markets closed. Name the key movers and state what the tape is pricing in for tomorrow — not just that stocks went up or down. OMIT if no specific market close data or named movers in the articles.",
    "macro_and_rates": "2-3 sentences on macro and rates. State the concrete implication for deal multiples, credit spreads, or risk appetite into tomorrow. OMIT if no concrete rates or macro signal in the articles.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. OMIT THIS KEY ENTIRELY if nothing geopolitical materially affected markets today — do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
    "tomorrow_setup": "Write 3-4 sentences of continuous prose — no bullets, no numbered list. Each sentence must name a specific company, speaker, or data release, state the exact expected catalyst, and commit to what a beat or miss would signal for the broader market or sector. Write it as a paragraph a senior analyst would read aloud. BANNED phrases: 'investors should monitor', 'watch for', 'could be impacted', 'may be affected', 'bears watching', 'remain cautious'."
  },
  "top_deals": [
    {
      "company": "Target company name",
      "deal_type": "M&A | LBO | IPO | VC Round | Strategic Investment | Debt Financing",
      "value": "Deal size EXTRACTED FROM THE ARTICLE BODY (not just the headline). Normalize to one of: '$XB' (USD billions), '$XM' (USD millions), 'A$XB' (Australian dollars), '€XB' / '€XM' (euros), '£XB' / '£XM' (pounds). Preserve the actual currency — A$25 billion stays 'A$25B', never converted to USD. Dollar figures like '$60 billion', '$17B', 'A$25 billion', '€500 million' often appear only in the body paragraphs, so search the full article text. Only output null (or the literal string 'Undisclosed') when NO dollar figure for the transaction itself appears anywhere in the article.",
      "sentiment": "One of: BULLISH | BEARISH | NEUTRAL | MIXED — the market read for this specific deal. Rules: BULLISH for a strategic acquirer executing a clear consolidation thesis or a VC-backed company closing a hot round; BEARISH for a target in a forced/distressed/regulator-driven sale or a deal that signals a sector top; MIXED for material regulatory/antitrust risk, buyer-discipline concerns, or conflicting reads; NEUTRAL only when the deal is genuinely ambiguous. Do NOT default to NEUTRAL as a lazy choice.",
      "one_liner": "One sentence. If this deal IS the primary_story, output exactly the string 'See lead.' as the one_liner with no further text, clauses, or color. Otherwise, state acquirer, target, price or multiple, and why investors in adjacent names should reprice — no filler, no re-narration of the primary_story."
    }
  ],
  "sector_breakdown": {
    "Technology M&A": "2-3 sentence narrative on sector-level dynamics (multiples, capital flows, regulatory posture), named companies, and strategic signals. Replace this key with the actual sector name from the whitelist — use as many sector keys as you have real data for. Only include a sector if you can name at least one specific company AND state a concrete signal from the articles. Do NOT use this field to re-narrate the primary_story's deal — if the sector discussion would only restate the lead, OMIT that sector key."
  }
}

Only include sectors with meaningful activity. top_deals should have 0-5 entries — returning 0, 1, or 2 entries is always correct when fewer articles satisfy all four criteria below. Never pad the array to reach a minimum count. The Signal line on each article describes capital markets relevance only — it does NOT qualify an article as a top_deals entry. Apply the HARD GATE based on the article's PRIMARY subject, not its Signal.

HARD GATE — apply this test first, before anything else: Is the article's PRIMARY subject the announcement, signing, or closing of a named transaction? If the article is primarily about a company's earnings, profit, revenue, stock move, product, or general business news — even if that company has also done deals — it does NOT qualify. Discard it immediately.

A qualifying top_deals entry MUST satisfy ALL FOUR of the following — if any one is missing, exclude the entry entirely: (1) a named, specific acquirer, investor, or lead party — "undisclosed" or "investors" does not count; (2) a named target company or asset; (3) a confirmed or publicly reported transaction type (acquisition, merger, LBO, IPO, VC round, strategic investment, or debt financing) — fundraising interest, plans, or activity without a confirmed round, named lead investor, and disclosed amount does not qualify; (4) the transaction must be the primary subject of the article, not background context or analyst commentary.

Exclude without exception: earnings reports, revenue or profit results, stock price moves, analyst upgrades or downgrades, product launches, index inclusions, executive appointments, general company performance news, and fundraising stories without a named lead investor and confirmed amount — even if the article features a well-known company. If no qualifying deal exists in the provided articles, return an empty top_deals array rather than filling it with non-deal stories. Never use bracket placeholders — always write the actual name. When stating implications, use hedged language ('may signal', 'suggests') unless multiple articles confirm the same direction — never imply sector-wide repricing, macro conclusions, or broader competitive dynamics from a single story. Banned phrases unless strongly evidenced by multiple articles: 'ongoing consolidation', 'sector rotation', 'broader trend', 'continued pressure'."""

def filter_undisclosed_deals(deals: list[dict]) -> list[dict]:
    """
    Drop top_deals entries with no real dollar figure — Gemini still emits
    "Undisclosed" / null values for transactions whose amount never surfaces
    in the article body. Two exceptions keep the section honest:

      1. A deal whose one_liner is "See lead." is preserved regardless of its
         value field. The whole point of that entry is that it cross-references
         the primary_story; the lack of a disclosed figure is incidental, not
         a reason to drop a meaningful pointer.

      2. If the filter would leave zero deals, the original list is returned
         unchanged. An empty Top Deals section reads worse than one full of
         "Undisclosed" cards — the cards at least signal that the desk saw
         transactions, just without disclosed terms.
    """
    if not deals:
        return deals
    filtered = [
        d for d in deals
        if (
            (d.get("one_liner", "") or "").strip().lower().startswith("see lead")
            or (
                d.get("value")
                and isinstance(d.get("value"), str)
                and d["value"].strip().lower() not in ("undisclosed", "n/a", "none", "null", "")
            )
        )
    ]
    return filtered if filtered else deals


def _test_filter_undisclosed_deals():
    """
    Inline sanity check — not invoked on every run. Documents expected
    behavior of filter_undisclosed_deals(). Run manually with:

        python -c "from backend.synthesize import _test_filter_undisclosed_deals; _test_filter_undisclosed_deals()"
    """
    # Case 1: every deal is Undisclosed → fallback returns the original list
    all_undisclosed = [
        {"company": "A", "value": "Undisclosed", "one_liner": "Carve-out closes."},
        {"company": "B", "value": None,          "one_liner": "Round announced."},
        {"company": "C", "value": "n/a",         "one_liner": "Take-private signed."},
    ]
    out = filter_undisclosed_deals(all_undisclosed)
    assert out is all_undisclosed or out == all_undisclosed, "fallback should keep original list when all filtered"

    # Case 2: mix → only the disclosed-value deal survives
    mixed = [
        {"company": "A", "value": "Undisclosed", "one_liner": "Foo."},
        {"company": "B", "value": "$3.4B",       "one_liner": "Bar."},
        {"company": "C", "value": "",            "one_liner": "Baz."},
    ]
    out = filter_undisclosed_deals(mixed)
    assert len(out) == 1 and out[0]["company"] == "B", f"expected only B, got {out}"

    # Case 3: "See lead." deal with Undisclosed value is preserved
    with_see_lead = [
        {"company": "A", "value": "Undisclosed", "one_liner": "See lead."},
        {"company": "B", "value": "Undisclosed", "one_liner": "Some color."},
    ]
    out = filter_undisclosed_deals(with_see_lead)
    assert len(out) == 1 and out[0]["one_liner"] == "See lead.", f"See-lead exception failed: {out}"

    print("filter_undisclosed_deals: all 3 cases pass")


def _diversify_articles(articles, sector_cap=4, company_cap=2, total=20):
    """
    Prevent any single deal cluster or company from dominating synthesis input.
    Walks the relevance-sorted list greedily, capping per-sector and per-company
    representation. Returns at most `total` articles.
    """
    from collections import defaultdict
    sector_counts = defaultdict(int)
    company_counts = defaultdict(int)
    selected = []
    for a in articles:  # already sorted by relevance_score desc
        sector = (a.get("industry_verticals") or [a.get("sector", "")])[0]
        companies = a.get("companies") or []
        if isinstance(companies, str):
            try:
                companies = json.loads(companies)
            except Exception:
                companies = []

        if sector_counts[sector] >= sector_cap:
            continue
        if companies and any(company_counts[c] >= company_cap for c in companies):
            continue

        selected.append(a)
        sector_counts[sector] += 1
        for c in companies:
            company_counts[c] += 1

        if len(selected) >= total:
            break

    return selected


# Minimum relevance_score for a floor (breadth) article to be included.
# All stored articles have score >= 6 (ingest filter), but score-6 articles
# are borderline — their summaries are often weak. Score 7+ means the article
# has a genuine market implication worth surfacing as sector context.
FLOOR_MIN_SCORE = 7


def _freshness_rerank(articles):
    """
    Re-rank articles so freshness competes with relevance_score. Without
    this, a score-9 story from 22h ago wins the spine over a score-8 story
    from 3h ago, and the 6am brief reads as 20h-stale news.

    Effective score = relevance_score - hours_since_published / 8
    (each 8h of age costs one point of relevance).

    Falls back to ingested_at when published_at is missing; falls back to
    the existing order when neither is parseable. Never drops an article —
    only reorders.
    """
    now = datetime.now(timezone.utc)

    def _age_hours(a):
        for key in ("published_at", "ingested_at"):
            ts = a.get(key)
            if not ts:
                continue
            try:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                delta = (now - dt).total_seconds() / 3600.0
                return max(0.0, delta)
            except Exception:
                continue
        return 0.0  # no timestamp — treat as fresh rather than demote

    def _effective(a):
        rel = float(a.get("relevance_score") or 0)
        return rel - (_age_hours(a) / 8.0)

    return sorted(articles, key=_effective, reverse=True)


def _select_articles_for_synthesis(
    articles,
    spine_count=12,
    floor_count=6,
    spine_sector_cap=3,
    company_cap=2,
):
    """
    Two-bucket article selection for synthesis input.

    Spine (spine_count slots): depth-first greedy walk, sector_cap=spine_sector_cap.
    Captures the dominant editorial stories with enough per-sector depth for
    the LLM to write concrete analysis. sector_cap=3 (vs old 4) allows up to
    4 distinct sectors in 12 articles.

    Floor (up to floor_count slots): one best article per sector NOT already in
    the spine, minimum score FLOOR_MIN_SCORE. Ensures the LLM sees at least one
    data point from each active sector today, increasing the chance that any
    given sector appears in sector_breakdown and analyst sections.

    Returns (spine, floor) so the caller can format them with different
    summary truncation: spine gets full context, floor gets shorter context
    since they are breadth signals, not primary stories.

    articles must already be sorted by relevance_score descending.
    """
    from collections import defaultdict

    def _parse_companies(a):
        companies = a.get("companies") or []
        if isinstance(companies, str):
            try:
                return json.loads(companies)
            except Exception:
                return []
        return companies

    # ── Spine: greedy walk, sector_cap=spine_sector_cap ───────────────────────
    sector_counts  = defaultdict(int)
    company_counts = defaultdict(int)
    spine     = []
    spine_ids = set()

    for a in articles:
        sector    = (a.get("industry_verticals") or [a.get("sector", "")])[0]
        companies = _parse_companies(a)

        if sector_counts[sector] >= spine_sector_cap:
            continue
        if companies and any(company_counts[c] >= company_cap for c in companies):
            continue

        spine.append(a)
        spine_ids.add(id(a))
        sector_counts[sector] += 1
        for c in companies:
            company_counts[c] += 1

        if len(spine) >= spine_count:
            break

    # ── Floor: one best article per uncovered sector ───────────────────────────
    # articles is already score-sorted, so the first eligible article per sector
    # is automatically the highest-scoring one for that sector.
    covered_sectors = {(a.get("industry_verticals") or [a.get("sector", "")])[0] for a in spine}
    best_per_sector = {}

    for a in articles:
        if id(a) in spine_ids:
            continue
        score  = a.get("relevance_score") or 0
        sector = (a.get("industry_verticals") or [a.get("sector", "")])[0]
        if not sector or sector in covered_sectors:
            continue
        if score < FLOOR_MIN_SCORE:
            continue
        if sector not in best_per_sector:
            best_per_sector[sector] = a  # first = highest score for this sector

    floor = list(best_per_sector.values())[:floor_count]

    return spine, floor


def _validate_sector_breakdown(sb):
    """
    Validate and repair sector_breakdown after parsing.

    Enforces three guarantees:

    1. Schema-echo detection — if the model copied the prompt's example
       instruction text into a value, drop that entry.
    2. Whitelist enforcement — every key must be one of the 11 industry
       verticals from `ingest.INDUSTRY_VERTICALS`. Compound labels that
       start with a whitelist value ("Technology AI Infrastructure" →
       "Technology") are remapped. Anything else is dropped with a warning.
    3. Merge collisions — if two remapped keys land on the same whitelist
       value, narratives are concatenated with a single space so no signal
       is silently lost.

    Returns a clean dict of {sector_name: narrative} whose keys are all
    whitelist-compliant, or {} if nothing valid remained.
    """
    if not isinstance(sb, dict):
        return {}

    # Phrases that appear in schema instruction text but never in real narratives.
    INSTRUCTION_MARKERS = (
        'only include',
        'do not invent',
        'omit sectors',
        'replace this key',
        'real data for',
        'concrete signal from the articles',
    )

    # Pre-sort whitelist by length desc so longest-prefix match wins
    # (e.g. "Energy & Oil/Gas" matches before any hypothetical "Energy" prefix).
    whitelist_sorted = sorted(INDUSTRY_VERTICALS, key=len, reverse=True)

    clean: dict[str, str] = {}
    skipped: list[str] = []
    remapped: list[tuple[str, str]] = []

    for k, v in sb.items():
        if not isinstance(k, str) or not isinstance(v, str):
            skipped.append(str(k))
            continue

        v_stripped = v.strip()
        v_lower = v_stripped.lower()
        if any(marker in v_lower for marker in INSTRUCTION_MARKERS):
            skipped.append(k)  # schema-echo value — model copied the instruction
            continue
        if len(v_stripped) < 20:
            skipped.append(k)  # too short to be a real narrative
            continue

        # Resolve the key to a whitelist value.
        target_key = None
        if k in INDUSTRY_VERTICALS:
            target_key = k
        else:
            for wl in whitelist_sorted:
                # Match "<whitelist> <more text>" or exact match with
                # trailing whitespace — never a substring in the middle.
                if k == wl or k.startswith(wl + " "):
                    target_key = wl
                    if k != wl:
                        remapped.append((k, wl))
                    break

        if target_key is None:
            skipped.append(k)
            continue

        # Merge narratives if two source keys remap to the same whitelist value.
        if target_key in clean:
            clean[target_key] = (clean[target_key].rstrip() + " " + v_stripped).strip()
        else:
            clean[target_key] = v_stripped

    if skipped:
        print(f"  ⚠ sector_breakdown: dropped {len(skipped)} invalid key(s): {skipped}")
    if remapped:
        pairs = ", ".join(f"{orig!r}→{wl!r}" for orig, wl in remapped)
        print(f"  ↳ sector_breakdown: remapped {len(remapped)} compound key(s): {pairs}")

    return clean


def gemini_generate(system, user_content, temperature=0.3, max_tokens=4096):
    """Call Gemini with a system instruction and user prompt."""
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            response_mime_type="application/json",
        ),
    )
    return (response.text or "").strip()

def fetch_watchlist_signals(cutoff_hours: int = 24) -> tuple[list[dict], list[str]]:
    """
    Fetch recently cached watchlist articles across all tracked identifiers.
    Returns (articles, identifiers) where:
      - articles: list of article dicts with title, summary, identifier, source_type
      - identifiers: list of all distinct identifiers currently in the watchlist table

    Designed to be called during synthesis to inject watchlist context into the brief.
    Always fails gracefully — returns ([], []) on any error so the main pipeline never crashes.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=cutoff_hours)).isoformat()

        # Fetch all distinct identifiers currently tracked by any user
        watchlist_resp = supabase.table("watchlist")\
            .select("identifier")\
            .execute()

        if not watchlist_resp.data:
            print("  ℹ Watchlist empty — no watchlist signals to inject")
            return [], []

        identifiers = list({row["identifier"] for row in watchlist_resp.data if row.get("identifier")})

        if not identifiers:
            return [], []

        # Cap at 50 identifiers to keep the .in_() query manageable
        identifiers = identifiers[:50]

        print(f"  📋 Watchlist: {len(identifiers)} tracked identifiers")

        # Fetch cached articles for those identifiers from the last cutoff_hours
        articles_resp = supabase.table("watchlist_articles")\
            .select("identifier, title, summary, source, source_type, published_at, relevance_score, url")\
            .in_("identifier", identifiers)\
            .gte("fetched_at", cutoff)\
            .order("relevance_score", desc=True)\
            .limit(50)\
            .execute()

        articles = articles_resp.data or []

        if not articles:
            print(f"  ℹ No recent watchlist articles found (cutoff: {cutoff_hours}h)")
            return [], identifiers

        # Deduplicate by title (exact match)
        seen_titles = set()
        deduped = []
        for a in articles:
            title = (a.get("title") or "").strip().lower()
            if title and title not in seen_titles:
                seen_titles.add(title)
                deduped.append(a)

        # Take top 8 by relevance_score
        top_articles = deduped[:8]

        print(f"  ✅ Watchlist signals: {len(top_articles)} articles from {len(identifiers)} identifiers")
        return top_articles, identifiers

    except Exception as e:
        print(f"  ⚠ fetch_watchlist_signals failed (non-fatal): {e}")
        return [], []


def _fetch_aggregate_engagement() -> str:
    """
    Query user_signal_digest to build a short engagement-context block for
    the synthesis prompt. Aggregates across all users to surface what the
    readership collectively cares about most. Soft-fails to "".
    """
    try:
        resp = (
            supabase.table("user_signal_digest")
            .select("top_sectors, top_tickers, engagement_level, event_count")
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return ""

        from collections import defaultdict
        sector_agg: dict[str, float] = defaultdict(float)
        ticker_agg: dict[str, float] = defaultdict(float)
        total_events = 0

        for row in rows:
            total_events += row.get("event_count", 0)

            sectors = row.get("top_sectors") or []
            if isinstance(sectors, str):
                sectors = json.loads(sectors)
            for s in sectors:
                if isinstance(s, dict) and s.get("sector"):
                    sector_agg[s["sector"]] += s.get("score", 0)

            tickers = row.get("top_tickers") or []
            if isinstance(tickers, str):
                tickers = json.loads(tickers)
            for t in tickers:
                if isinstance(t, dict) and t.get("ticker"):
                    ticker_agg[t["ticker"]] += t.get("score", 0)

        if not sector_agg and not ticker_agg:
            return ""

        lines = ["USER ENGAGEMENT SIGNALS (last 30 days):"]
        top_sectors = sorted(sector_agg.items(), key=lambda x: -x[1])[:5]
        if top_sectors:
            sector_list = ", ".join(f"{s} ({round(v, 1)})" for s, v in top_sectors)
            lines.append(f"- Most engaged sectors: {sector_list}")

        top_tickers = sorted(ticker_agg.items(), key=lambda x: -x[1])[:5]
        if top_tickers:
            ticker_list = ", ".join(f"{t} ({round(v, 1)})" for t, v in top_tickers)
            lines.append(f"- Most engaged tickers: {ticker_list}")

        lines.append(f"- Total engagement events: {total_events}")
        lines.append(
            "When these sectors or tickers appear in today's articles, "
            "give them slightly more prominence in your analysis — but never "
            "force irrelevant content or invent information."
        )

        return "\n".join(lines)
    except Exception as e:
        print(f"  ⚠ _fetch_aggregate_engagement failed (non-fatal): {e}")
        return ""


CLAIMS_EXTRACTION_SYSTEM = """You extract gradeable market calls from a morning brief.

A "claim" is a directional statement about a market, sector, index, or ticker that can be verified against end-of-day price action. Examples of gradeable claims:
- "The S&P is likely to close higher on a dovish Fed tone" -> aggregate / SPY / bullish
- "Tech will outperform today on NVDA earnings" -> sector / XLK / bullish
- "Energy faces pressure as crude slides" -> sector / XLE / bearish
- "NVDA will rally on its AI guidance" -> ticker / NVDA / bullish

NOT gradeable: vague commentary, retrospective observations, "watch for X", non-directional context, commentary about the previous day.

For sector claims, pick the appropriate US sector ETF:
- Technology -> XLK
- Energy -> XLE
- Financials -> XLF
- Healthcare -> XLV
- Consumer Discretionary -> XLY
- Consumer Staples -> XLP
- Industrials -> XLI
- Materials -> XLB
- Real Estate -> XLRE
- Utilities -> XLU
- Communication Services -> XLC

For aggregate/broad-market claims, use SPY as target_symbol (or null). For index claims, use the literal ETF (SPY, QQQ, DIA).

Return 3 to 7 claims. If the brief is genuinely non-directional, it is acceptable to return fewer (even zero).

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "claims": [
    {
      "claim_text": "<short sentence stating the directional call>",
      "claim_type": "aggregate" | "sector" | "index" | "ticker",
      "target_symbol": "<ticker or ETF symbol; null only for pure aggregate with no proxy>",
      "expected_direction": "bullish" | "bearish" | "neutral",
      "confidence": <float between 0.0 and 1.0>
    }
  ]
}
"""


def extract_and_persist_claims(
    brief_id: str,
    brief_headline: str,
    brief_summary: str,
    brief_sections: dict,
) -> int:
    """
    Extract gradeable market calls from a morning brief and persist them to
    `morning_brief_calls`. Idempotent: deletes any existing rows for this
    brief_id before inserting so re-runs produce a clean set.

    Returns the number of claims persisted. Fails soft: any error yields 0
    and a logged warning so the caller can safely wrap in a try/except.
    """
    if not brief_id:
        print("  ⚠ extract_and_persist_claims: missing brief_id, skipping")
        return 0

    # Assemble the brief text the model will read.
    sections_text = ""
    if isinstance(brief_sections, dict):
        for key, val in brief_sections.items():
            if isinstance(val, str) and val.strip():
                sections_text += f"\n\n[{key}]\n{val}"

    user_content = (
        f"HEADLINE: {brief_headline}\n\n"
        f"SUMMARY: {brief_summary}\n"
        f"{sections_text}"
    )

    try:
        raw = gemini_generate(
            system=CLAIMS_EXTRACTION_SYSTEM,
            user_content=user_content,
            temperature=0.2,
            max_tokens=1024,
        )
    except Exception as e:
        print(f"  ⚠ claims extraction: Gemini call failed: {e}")
        return 0

    # Strip possible code fences, then parse JSON.
    raw = re.sub(r"^```json|^```|```$", "", raw or "", flags=re.MULTILINE).strip()
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
            except Exception:
                pass

    if not isinstance(parsed, dict):
        print(f"  ⚠ claims extraction: non-JSON response, skipping. raw={raw[:200]!r}")
        return 0

    claims = parsed.get("claims") or []
    if not isinstance(claims, list) or not claims:
        print("  ℹ claims extraction: model returned 0 claims")
        # Still run the idempotent delete so stale data is not left behind.
        try:
            supabase_admin.table("morning_brief_calls").delete().eq("brief_id", brief_id).execute()
        except Exception as e:
            print(f"  ⚠ claims extraction: idempotent delete failed: {e}")
        return 0

    # Validate/normalize each claim before insert.
    allowed_types = {"aggregate", "sector", "index", "ticker"}
    allowed_dirs = {"bullish", "bearish", "neutral"}

    rows = []
    for c in claims:
        if not isinstance(c, dict):
            continue
        claim_text = (c.get("claim_text") or "").strip()
        claim_type = (c.get("claim_type") or "").strip().lower()
        target_symbol = c.get("target_symbol")
        if isinstance(target_symbol, str):
            target_symbol = target_symbol.strip().upper() or None
        else:
            target_symbol = None
        direction = (c.get("expected_direction") or "").strip().lower()

        confidence = c.get("confidence")
        try:
            confidence = float(confidence) if confidence is not None else None
            if confidence is not None:
                confidence = max(0.0, min(1.0, confidence))
        except Exception:
            confidence = None

        if not claim_text or claim_type not in allowed_types or direction not in allowed_dirs:
            continue

        rows.append({
            "brief_id": brief_id,
            "claim_text": claim_text,
            "claim_type": claim_type,
            "target_symbol": target_symbol,
            "expected_direction": direction,
            "confidence": confidence,
        })

    if not rows:
        print("  ⚠ claims extraction: no valid claims after normalization")
        return 0

    # Idempotency: clear any prior rows for this brief_id before inserting.
    try:
        supabase_admin.table("morning_brief_calls").delete().eq("brief_id", brief_id).execute()
    except Exception as e:
        print(f"  ⚠ claims extraction: idempotent delete failed (continuing): {e}")

    try:
        supabase_admin.table("morning_brief_calls").insert(rows).execute()
    except Exception as e:
        print(f"  ⚠ claims extraction: insert failed: {e}")
        return 0

    print(f"  ✅ claims extraction: persisted {len(rows)} claim(s) for brief {brief_id}")
    return len(rows)


def generate_morning_review_for_evening(today_date, sb):
    """Query today's graded morning brief calls and generate an LLM self-reflection.

    Returns a dict shaped like::

        {
          "aggregate_sentence": "...",
          "sector_reflections": [{ "sector": str, "verdict": str, "paragraph": str }],
          "ticker_reflection": { "symbol": str, "verdict": str, "paragraph": str } | None,
        }

    Returns ``None`` if there are no graded calls yet, or if anything fails
    (missing tables, API errors, JSON parse issues). Caller MUST treat this
    as best-effort — an evening wrap must still ship without a review.
    """
    try:
        calls_resp = (
            sb.table("morning_brief_calls")
            .select("*")
            .eq("brief_date", today_date.isoformat())
            .execute()
        )
    except Exception as e:
        print(f"[synthesize] morning_brief_calls lookup failed: {e}")
        return None

    calls = calls_resp.data or []
    if not calls:
        return None

    call_ids = [c["id"] for c in calls]
    try:
        outcomes_resp = (
            sb.table("morning_brief_call_outcomes")
            .select("*")
            .in_("call_id", call_ids)
            .execute()
        )
    except Exception as e:
        print(f"[synthesize] morning_brief_call_outcomes lookup failed: {e}")
        return None

    outcomes_by_call = {o["call_id"]: o for o in (outcomes_resp.data or [])}
    graded = [(c, outcomes_by_call[c["id"]]) for c in calls if c["id"] in outcomes_by_call]
    if not graded:
        return None  # no graded calls yet

    # Aggregate stats
    correct = sum(1 for _, o in graded if o.get("verdict") == "correct")
    wrong = sum(1 for _, o in graded if o.get("verdict") == "wrong")
    partial = sum(1 for _, o in graded if o.get("verdict") == "partial")

    def _fmt_pct(x):
        try:
            return f"{float(x) * 100:+.2f}%"
        except Exception:
            return "n/a"

    summary_block = "\n".join(
        f"- [{o.get('verdict', '?')}] {c.get('claim_text', '')} "
        f"→ {c.get('expected_direction', '?')} expected, "
        f"{o.get('actual_direction', '?')} actual ({_fmt_pct(o.get('actual_pct_change'))})"
        for c, o in graded
    )

    prompt = (
        "Generate a self-reflection for today's evening wrap comparing the morning "
        "brief's market calls to what actually happened.\n\n"
        f"Morning brief calls and outcomes:\n{summary_block}\n\n"
        f"Aggregate: {correct} correct, {wrong} wrong, {partial} partial.\n\n"
        "Produce JSON only:\n"
        "{\n"
        "  \"aggregate_sentence\": \"<1-2 sentence summary — honest, never defensive>\",\n"
        "  \"sector_reflections\": [\n"
        "    { \"sector\": \"<name>\", \"verdict\": \"<correct|wrong|partial>\", \"paragraph\": \"<1 paragraph>\" }\n"
        "  ],\n"
        "  \"ticker_reflection\": { \"symbol\": \"<sym>\", \"verdict\": \"<v>\", \"paragraph\": \"<1 paragraph>\" } | null\n"
        "}\n\n"
        "Rules:\n"
        "- Include sector_reflections only for sector calls with meaningful outcome.\n"
        "- ticker_reflection: only if a high-confidence ticker call was made. Otherwise null.\n"
        "- Total length: 200-400 words.\n"
        "- Tone: confident, honest. \"We were wrong about X because Y\" > vague excuses.\n"
        "- Output JSON only, no prose."
    )

    try:
        resp = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        text = (resp.text or "").strip()
        # Strip code fences if present (```json ... ``` or ``` ... ```)
        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                text = parts[1]
            text = text.removeprefix("json").strip()
        return json.loads(text)
    except Exception as e:
        print(f"[synthesize] morning review generation failed: {e}")
        return None


def run(brief_type="morning"):
    print(f"📝 Synthesizing {brief_type} briefing...")

    # Pull a larger pool from last 24 hours, then diversify to prevent
    # a single deal cluster or company from dominating the briefing.
    # `content` (full body, when scraped by ingest) is now selected so the
    # prompt can pull out deal values like "$60 billion" that only appear in
    # body paragraphs. `published_at` / `ingested_at` are selected so the
    # selector can apply a freshness re-rank on top of relevance_score.
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    resp = supabase.table("articles")\
        .select("title, summary, content, sector, industry_verticals, companies, relevance_score, relevance_reason, published_at, ingested_at")\
        .gte("ingested_at", cutoff)\
        .order("relevance_score", desc=True)\
        .limit(60)\
        .execute()

    articles = resp.data or []
    if not articles:
        resp = supabase.table("articles")\
            .select("title, summary, content, sector, industry_verticals, companies, relevance_score, relevance_reason, published_at, ingested_at")\
            .order("ingested_at", desc=True)\
            .limit(60)\
            .execute()
        articles = resp.data or []

    # Freshness-aware re-rank: an older story only wins the spine if its
    # relevance edge is big enough to overcome its age. Without this, a
    # score-9 story from 22h ago beats a score-8 story from 3h ago even when
    # the brief ships at 6am ET.
    articles = _freshness_rerank(articles)

    spine, floor = _select_articles_for_synthesis(articles)
    print(f"  📰 Synthesis input: {len(spine)} spine + {len(floor)} floor articles "
          f"({len(spine) + len(floor)} total, from pool of up to 60)")

    # ── Watchlist signal injection ──────────────────────────────────────────
    watchlist_articles, watchlist_identifiers = fetch_watchlist_signals(cutoff_hours=24)

    watchlist_text = ""
    if watchlist_articles:
        watchlist_lines = []
        for a in watchlist_articles:
            identifier = a.get("identifier", "")
            title = a.get("title", "")
            summary = (a.get("summary") or "")[:200]
            source = a.get("source", "")
            score = a.get("relevance_score", "")
            line = f"[WATCHLIST: {identifier}] {title}"
            if summary:
                line += f"\n{summary}"
            if source:
                line += f"\nSource: {source}"
            if score:
                line += f" | Relevance: {score}"
            watchlist_lines.append(line)

        watchlist_text = (
            "\n\n--- WATCHLIST SIGNALS (actively tracked by users) ---\n\n"
            + "\n\n".join(watchlist_lines)
        )
        print(f"  📌 Injecting {len(watchlist_articles)} watchlist signals into prompt")
    elif watchlist_identifiers:
        # Identifiers exist but no fresh articles — note the tracked companies only
        watchlist_text = (
            f"\n\n--- TRACKED COMPANIES (no fresh articles today) ---\n"
            f"Users are tracking: {', '.join(watchlist_identifiers[:20])}\n"
            f"Mention these if they appear in the main articles above."
        )
        print(f"  📌 No fresh watchlist articles, but noting {len(watchlist_identifiers)} tracked identifiers")
    # ── End watchlist injection ──────────────────────────────────────────────

    # Spine: prefer scraped full body (content) when available so the model
    # can read dollar figures like "$60 billion" that live only in body
    # paragraphs. Fall back to summary if no body was scraped for that source.
    # Cap at 1200 chars to keep the prompt under token budget while still
    # giving enough room to reach the first 2-3 paragraphs where deal values
    # typically appear.
    def _spine_body(a):
        body = (a.get("content") or "").strip()
        if body and len(body) > 80:
            return body[:1200]
        return (a.get("summary", "") or "")[:300]

    spine_texts = [
        f"[{a.get('sector','')}] {a.get('title','')}\n{_spine_body(a)}"
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in spine
    ]
    # Floor: shortened summary (150 chars) — breadth signals, not lead stories
    floor_texts = [
        f"[{a.get('sector','')}] {a.get('title','')}\n{(a.get('summary','') or '')[:150]}"
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in floor
    ]

    article_text = "\n\n".join(spine_texts)
    if floor_texts:
        article_text += "\n\n--- ADDITIONAL SECTOR SIGNALS ---\n\n" + "\n\n".join(floor_texts)
    if watchlist_text:
        article_text += watchlist_text

    system = MORNING_SYSTEM if brief_type == "morning" else EVENING_SYSTEM

    # --- Evening: lead-story dedup vs morning brief ----------------------------
    # Fetch the morning brief's headline so the evening wrap can prefer a
    # different lead unless the same story is still the dominant market mover
    # at close. Non-fatal — evening still ships without this context.
    if brief_type == "evening":
        try:
            today_start_utc = (
                datetime.now(timezone.utc)
                .replace(hour=0, minute=0, second=0, microsecond=0)
                .isoformat()
            )
            morning_resp = (
                supabase.table("briefings")
                .select("headline, lead_paragraph")
                .eq("briefing_type", "morning")
                .gte("created_at", today_start_utc)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if morning_resp.data:
                m = morning_resp.data[0]
                morning_headline = (m.get("headline") or "").strip()
                morning_lead = (m.get("lead_paragraph") or "").strip()
                if morning_headline:
                    dedup_directive = (
                        "[LEAD-STORY DEDUP — today's morning brief context]\n"
                        f"Morning brief led with: \"{morning_headline}\"\n"
                    )
                    if morning_lead:
                        dedup_directive += f"Morning lead paragraph: {morning_lead[:400]}\n"
                    dedup_directive += (
                        "\nDEDUP RULE: The evening wrap should cover the day's trading action, "
                        "not restate the morning. Prefer a DIFFERENT lead story unless the "
                        "morning's news is genuinely still the dominant market mover at close "
                        "(e.g., Fed decision, major earnings beat that reshaped the tape, index-"
                        "moving geopolitical event). If you must re-lead with the same underlying "
                        "story, reframe the HEADLINE and LEAD_PARAGRAPH to emphasize what "
                        "developed during the trading day — price action, follow-on reactions, "
                        "sector impact — NOT what was announced in the morning.\n\n"
                    )
                    system = dedup_directive + system
                    print(f"  🔄 Injected morning-brief dedup directive (morning led: {morning_headline[:60]}...)")
        except Exception as e:
            print(f"  ⚠ morning-brief dedup lookup failed (non-fatal): {e}")

    # --- Feedback loop: prepend cached brief improvement addendum ----------
    brief_addendum_used = None
    try:
        resp = (
            supabase.table("weekly_digests")
            .select("morning_brief_addendum, evening_brief_addendum")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        if resp.data:
            col = f"{brief_type}_brief_addendum"
            addendum_text = resp.data[0].get(col)
            if addendum_text:
                system = (
                    "[BRIEF IMPROVEMENT DIRECTIVE — incorporate into your analysis]\n"
                    + addendum_text
                    + "\n\n"
                    + system
                )
                brief_addendum_used = {"source": "weekly_digests", "chars": len(addendum_text)}
                print(f"  📎 Injected {len(addendum_text)}-char brief improvement addendum")
    except Exception as e:
        print(f"  ⚠ Brief addendum injection skipped: {e}")

    # --- User engagement signal injection (soft-fail) ---
    engagement_ctx = _fetch_aggregate_engagement()
    if engagement_ctx:
        system = engagement_ctx + "\n\n" + system
        print(f"  📈 Injected {len(engagement_ctx)}-char user engagement context")

    data = None
    raw = ""
    try:
        raw = gemini_generate(
            system=system,
            user_content=f"Today's articles:\n\n{article_text}",
            temperature=0.3,
            max_tokens=4096,
        )
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        try:
            data = json.loads(raw)
        except Exception:
            # tier 2: extract first {...} block
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                try:
                    data = json.loads(match.group())
                except Exception:
                    pass
        if data is None:
            raise ValueError(f"Could not parse Gemini response as JSON. Raw: {raw[:200]}")
    except Exception as e:
        print(f"  ✗ Gemini error: {e} — raw response: {repr(raw[:200])} — falling back to stub briefing")

    if data is None:
        data = {
            "headline": "Market Intelligence Unavailable",
            "summary": "Briefing generation failed. Please check logs.",
            "market_tone": "NEUTRAL",
            "sections": {},
            "top_deals": [],
            "sector_breakdown": {}
        }

    sector_breakdown = _validate_sector_breakdown(data.get("sector_breakdown", {}))
    print(f"  📊 sector_breakdown: {len(sector_breakdown)} sector(s) — {list(sector_breakdown.keys())}")

    # Defensive clamp: when a top_deals entry IS the primary_story, the prompt
    # instructs Gemini to emit exactly "See lead." Some model outputs still
    # append a trailing clause ("See lead. This carve-out signals ..."). Hard-
    # rewrite any one_liner that starts with "see lead" to the literal string
    # so the UI never shows a duplicate retelling of the lead.
    top_deals_list = data.get("top_deals") or []
    if isinstance(top_deals_list, list):
        for deal in top_deals_list:
            if isinstance(deal, dict):
                ol = deal.get("one_liner")
                if isinstance(ol, str) and ol.strip().lower().startswith("see lead"):
                    deal["one_liner"] = "See lead."
        data["top_deals"] = top_deals_list

    # Drop "Undisclosed" / null-value deals before write so the Top Deals
    # section doesn't ship 2-3 placeholder cards per brief. The filter has
    # a See-lead exception (lead-reference deals stay regardless of value)
    # and falls back to the original list if it would empty the section.
    data["top_deals"] = filter_undisclosed_deals(data.get("top_deals") or [])

    # Structured body (new schema): if all three fields are present, synthesize
    # the legacy `summary` as their concatenation for backward compatibility
    # with older consumers. If any field is missing, keep the model's `summary`
    # unchanged.
    lead_paragraph = (data.get("lead_paragraph") or "").strip()
    supporting_context = (data.get("supporting_context") or "").strip()
    what_to_watch_body = (data.get("what_to_watch") or "").strip()
    has_structured_body = bool(lead_paragraph and supporting_context and what_to_watch_body)

    if has_structured_body:
        derived_summary = f"{lead_paragraph}\n\n{supporting_context}\n\n{what_to_watch_body}"
    else:
        derived_summary = data.get("summary", "") or ""

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "briefing_type":    brief_type,
        "headline":         data.get("headline", ""),
        "summary":          derived_summary,
        "market_tone":      data.get("market_tone", "NEUTRAL"),
        "sections":         json.dumps(data.get("sections", {})),
        "top_deals":        json.dumps(data.get("top_deals", [])),
        "sector_breakdown": json.dumps(sector_breakdown),
        "created_at":       now,
    }

    # Insert with optional market_pulse + structured body fields. The new
    # lead_paragraph / supporting_context / what_to_watch columns may not
    # exist yet on older DBs, so we try with them first and fall back to the
    # base row on schema errors — same pattern as market_pulse.
    mp_raw = data.get("market_pulse")
    has_pulse = (
        isinstance(mp_raw, dict)
        and mp_raw.get("sentiment_word")
        and mp_raw.get("narrative")
    )

    extras: dict = {}
    if has_pulse:
        extras["market_pulse"] = json.dumps(mp_raw)
    if has_structured_body:
        extras["lead_paragraph"] = lead_paragraph
        extras["supporting_context"] = supporting_context
        extras["what_to_watch"] = what_to_watch_body

    insert_resp = None
    if extras:
        row_with_extras = {**row, **extras}
        try:
            insert_resp = supabase.table("briefings").insert(row_with_extras).execute()
            if has_pulse:
                print(f"  ✨ market_pulse saved: {mp_raw.get('sentiment_word', '')[:30]}")
            if has_structured_body:
                print(f"  ✨ structured body saved (lead/context/watch)")
        except Exception as ext_err:
            print(f"  ⚠ structured-body insert failed ({ext_err}) — falling back to base row")
            insert_resp = supabase.table("briefings").insert(row).execute()
    else:
        insert_resp = supabase.table("briefings").insert(row).execute()

    brief_id = None
    try:
        inserted_rows = getattr(insert_resp, "data", None) or []
        if inserted_rows and isinstance(inserted_rows[0], dict):
            brief_id = inserted_rows[0].get("id")
    except Exception:
        brief_id = None


    print(f"  ✅ {brief_type.capitalize()} briefing stored")
    print(f"  Headline: {row['headline'][:80]}")

    # --- Self-grading claims extraction (morning brief only, non-fatal) ------
    # Runs as a second, additive LLM call. Any failure is logged and swallowed
    # so the brief still ships.
    if brief_type == "morning":
        try:
            if brief_id:
                extract_and_persist_claims(
                    brief_id=brief_id,
                    brief_headline=data.get("headline", ""),
                    brief_summary=data.get("summary", ""),
                    brief_sections=data.get("sections", {}) or {},
                )
            else:
                print("  ⚠ claims extraction skipped: briefings insert did not return an id")
        except Exception as e:
            print(f"  ⚠ claims extraction failed (non-fatal): {e}")

    # ── Evening wrap: attach self-reflection on morning brief vs market outcomes ──
    # Non-fatal: reflection is additive and must never block the briefing from shipping.
    if brief_type == "evening":
        try:
            review = generate_morning_review_for_evening(date.today(), supabase)
            if review and brief_id:
                supabase.table("briefings").update(
                    {"morning_review": review}
                ).eq("id", brief_id).execute()
                print(f"  🔁 Attached morning_review to evening brief {brief_id}")
            elif review and not brief_id:
                print("  ⚠ Generated morning_review but no brief_id returned from insert")
        except Exception as e:
            print(f"[synthesize] morning review attach failed: {e}")  # non-fatal

    # Return brief text and addendum metadata for downstream consumers
    # (e.g. brief_feedback_loop.score_brief in run.py)
    brief_text = json.dumps(data, indent=2)
    return {"brief_text": brief_text, "brief_addendum_used": brief_addendum_used}

if __name__ == "__main__":
    import sys
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"
    run(brief_type)
