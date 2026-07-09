"""
synthesize.py — BreakingAlpha
Generates a detailed analyst-style morning/evening briefing using Google Gemini.
"""

import os, json, re, uuid, time
from datetime import datetime, timezone, timedelta, date
from supabase import create_client
from google import genai
from google.genai import types

from ingest import INDUSTRY_VERTICALS
from outputs import record_output, record_outputs_batch
from output_constants import BRIEF_PROMPT_VERSION
import market_tape
import temporal_grounding
import macro_calendar
import bea_calendar
from brief_voice_guard import enforce_brief_voice, has_voice_violation
import prose_quality_guard
import overview_grounding
from dataclasses import asdict
try:
    from usage_log import log_gemini_usage
except Exception:  # pragma: no cover - usage logging must never break import
    try:
        from backend.usage_log import log_gemini_usage
    except Exception:
        def log_gemini_usage(*a, **k):
            return

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

# PR1 tape-aware materiality lead ranking (three-state, mirrors RELEVANCE_GRADE_MODE):
#   off    -> the materiality re-rank never runs; selection is exactly as before.
#   shadow -> the re-rank runs and its divergence vs the shipped lead is LOGGED to
#             pipeline_runs.preselect_decision (materiality_* keys); the shipped lead
#             is UNCHANGED (shadow-first). This is prod-neutral: no served brief moves.
#   active -> the materiality pick REPLACES the tape-blind pick as the lead.
# Fails closed to current behavior on any error (no tape -> no-op; any exception ->
# serves the existing lead). DEFAULT 'shadow' during label accrual: it only LOGS the
# divergence. Promote shadow -> active ONLY when the backtest gate in RUN_REPORT_PR1.md
# is met (>= 8-10 ratified days INCLUDING >= 2 genuine B/C days). Set the env var to
# 'off' to disable the shadow computation entirely.
MATERIALITY_RANK_MODE = os.environ.get("MATERIALITY_RANK_MODE", "shadow").strip().lower()
if MATERIALITY_RANK_MODE not in ("off", "shadow", "active"):
    print(f"  [materiality-rank] unknown MATERIALITY_RANK_MODE={MATERIALITY_RANK_MODE!r}, "
          "falling back to 'off' (prod-neutral default)")
    MATERIALITY_RANK_MODE = "off"

# MARKET_PULSE_V2: when true, market_pulse.narrative is produced by a dedicated
# tape-first Gemini call (generate_market_pulse) that overwrites the monolith's
# narrative BEFORE the existing grounding post-check + D13 temporal normalization
# run. DEFAULT OFF: when off, generate_market_pulse is never invoked and behavior
# is byte-identical to today.
MARKET_PULSE_V2 = os.environ.get("MARKET_PULSE_V2", "").strip().lower() in ("1", "true", "yes", "on")

MORNING_SYSTEM = """You are a senior investment banking analyst preparing the daily morning briefing for a capital markets team.

HOUSE VOICE (highest priority, applies to every field; overrides any phrasing primed elsewhere in this prompt): write like a sharp analyst with a view, not a wire feed. (1) Never narrate who is watching, monitoring, observing, gauging, awaiting, or focusing on something, and never substitute 'analysts will focus on X' for an actual view: state the consequence or what is at stake directly. (2) Open market_pulse.narrative with an analytical through-line claim, never with 'the market is / closed [mood word]' and never with an index recap (the index moves may appear later in the body, just not as the opening line). The sentiment_word still carries the mood and still matches the prior-close regime; the opening line of the narrative carries the argument.

WATCHLIST DIRECTIVE:
The articles marked [WATCHLIST] below are from companies and tickers that users are actively tracking. When these companies appear in the news, prioritize them in your analysis:
- If a watchlist company is involved in a deal, it MUST appear in top_deals and deals_and_ma
- If a watchlist company has notable earnings or market moves, it MUST appear in public_markets or sector_spotlight
- Mention watchlist companies by name explicitly — do not bury them in generic sector commentary
- If watchlist signals are weak or off-topic today, it is acceptable to omit them — do not force irrelevant content

This directive applies only when [WATCHLIST] articles are present in the input. If no [WATCHLIST] articles are provided, ignore this directive entirely.

You will receive a list of recent news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your analysis.

FIGURE-TYPING RULE — apply to every financial figure you state: first identify the figure's TYPE from the source article — capital raised, valuation, market cap, revenue, deal size / transaction value, or price target — and describe it with that exact type. NEVER substitute one type for another (do not call a capital raise a "valuation", a deal size a "market cap", or a price target a "valuation"). If the source does not make the type unambiguous, state the figure with no type descriptor rather than guess. Example: a "$75 billion IPO raise at a $1.75 trillion valuation" must be written as a $75B raise and a $1.75T valuation, never as a "$75 billion valuation".

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

SPECULATIVE SINGLE-NAME FRAMING: a story whose ONLY substance is one small or micro-cap company's self-promotional disclosure gets measured, skeptical analyst framing, never a credulous BULLISH read. Treat these as low-verification: (1) a company announcing its OWN crypto, token, AI, or treasury holdings or a 'strategic reserve'; (2) a micro-cap touting its own partnership, pipeline, MOU, or 'inaugural' report; (3) a promotional press-release-only item with no third-party confirmation; (4) a name flagged by a short-seller; (5) a headline-only claim with no corroborating coverage. For these: state plainly WHO claimed WHAT and that it is self-reported and unverified, give the market-impact context (a micro-cap self-disclosure rarely moves the broad tape), and set the top_deals sentiment to NEUTRAL (not BULLISH) unless an independent, named party confirms a priced transaction. Do NOT make one the lead. A confirmed, broadly-reported transaction or a priced deal with a named counterparty is different: it may carry a directional read. This shapes the brief-level framing only; it does not change the per-article sentiment chips.

SPECTATOR / HEDGE VOICE (harvested from real briefs, BANNED in every field). These narrate what someone WILL watch instead of stating the implication, and they are the dominant filler in current output. Do NOT use any of: 'investors will watch', 'investors will be watching', 'investors will monitor', 'investors will closely watch', 'investors should watch', 'market participants will observe', 'market participants will monitor', 'market participants will closely monitor', 'will be a key focus for analysts', 'will be a focus for analysts', 'follow-on analyst commentary', 'awaiting analyst commentary', 'will be key', 'will be a key indicator', 'will be a key factor', 'will be a critical factor', 'will determine if', 'will determine whether', 'will indicate whether', 'to gauge market', 'for indications of', 'for signals on', 'could provide insight', 'remains to be seen', 'it is worth noting', 'marking a significant transaction', 'represents a significant transaction', 'first-order event'. Attribution to analysts is NOT a substitute for a view: never write 'X will be a focus for analysts' in place of stating what X means. (Analytical attribution of a concrete fact, e.g. 'analysts flagged FCF coverage as the swing metric', stays allowed.) PATTERN BAN (catches reworded variants, not just the exact strings above): do not write any sentence whose main clause is the reader or the market watching, monitoring, observing, gauging, awaiting, being keen on, or focusing on something; lead with the consequence instead. Also banned regardless of exact wording: '[subject] will be a key focus' / 'will be the focus' / 'will be a focus', '[X] will indicate [noun]', '[X] could signal broader [noun]', 'the market will observe / monitor / be keen on'. If a sentence can be cut down to its consequence, cut it.

COMMITMENT RULE (positive, the point of this section): every forward line and every per-story line names a concrete driver, mechanism, number, or specific consequence and then states the implication in Signalera's own voice. Do not report that the market will watch something; say what it means and what is at stake. Rewrite example (illustrative, do not reuse this wording): replace 'Investors will watch [Company]'s stock to gauge demand' with 'A soft aftermarket would mark the [$X] block as overpriced and chill the [sector] issuance pipeline'.

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

1. Scan every article and Signal line. Identify articles with a CONFIRMED DOLLAR FIGURE in the headline or body — a specific transaction value like "$60 billion", "$17B", "$25 billion", or "$11.57 billion". A "confirmed dollar figure" means a number attached to a specific transaction, not a company's overall valuation, annual revenue, or unrelated amount.

2. ABSOLUTE RULE — PRICED OVER UNPRICED: If ANY article in the pool has a confirmed dollar figure of $1 billion or more attached to a specific transaction, the primary_story MUST be drawn from among those priced-transaction articles. An article with no confirmed dollar figure CANNOT be the primary_story while a priced-transaction article of $1B+ is available in the pool, regardless of freshness, sector, or narrative interest.

3. Among priced-transaction articles ($1B+): pick the one with the LARGEST confirmed dollar figure. This is the primary_story. If multiple articles describe the same transaction, pick the one with the most reputable source (FT, Bloomberg, Reuters, WSJ, NYT, Economist) and most recent timestamp.

4. FALLBACK when NO article in the pool has a confirmed dollar figure of $1B+: Apply this hierarchy:
   (a) Largest macro or rates event (Fed decision, CPI print, significant credit spread move, major central bank action)
   (b) Major geopolitical event with direct market consequence (war escalation, sanctions announcement, energy disruption)
   (c) Widest sector-moving development (single company earnings beat is NOT sufficient — needs to be a sector-wide signal)

5. Commitment: The entire lead block — `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch` — MUST be about the ONE primary_story you selected. Never stack two stories with 'and', commas, 'while', 'as', or 'amid'. Other important stories go into `sections`, `top_deals`, or `sector_breakdown` — NEVER into the lead block.

6. SELF-CHECK before writing any JSON:
   - Does my primary_story have a confirmed dollar figure of $1B+? If yes, proceed.
   - If no, does the pool have ANY article with a $1B+ confirmed transaction? If yes, STOP — reselect primary_story from that subset. My current choice is invalid.
   - If the pool has no $1B+ priced transaction at all, did I correctly apply the fallback hierarchy? Confirm the pick is a macro/geopolitical/sector event, not an unpriced M&A.

7. Output `primary_story_id` as a short identifier (original headline ~80 chars, or "acquirer + target", or "event + instrument"). The `headline` field below MUST name the same story. If they diverge, rewrite `headline` to match.

FAILURE EXAMPLES you must NOT reproduce:

- BAD: Picking "AIP Acquires Honeywell's Warehouse Business" (no disclosed price) when the pool contains "SpaceX acquires Cursor for $60 billion" (confirmed price).
- BAD: Picking the freshest M&A in the pool when an older M&A with a larger confirmed price is also in the pool.
- BAD: Picking an earnings beat as the lead when a $10B+ M&A transaction is available in the pool.

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
  "what_to_watch": "REQUIRED. 1-3 forward-looking sentences on the primary_story specifically: earnings response, regulatory review timeline, competitive bidding, IPO implications, follow-on reactions, expected commentary from adjacent names. Name a specific company, data release, or speaker and commit to the binary outcome that matters. BANNED phrases: 'investors should monitor', 'watch for', 'bears watching', 'remain cautious'. Do NOT open a sentence with who is watching or focusing: no 'investors will be watching', 'will be a key focus', 'will likely focus on', 'will provide insight', 'could drive', 'will indicate [noun]'. Lead every sentence with the consequence or the stake (BAD: 'Investors will be watching X.' GOOD: 'A miss at X breaks the Y thesis and pressures Z.'). Must NOT be empty. If the corpus cannot support a meaningful forward-looking call, give the single most concrete next-step question a reader should carry into the day rather than pad.",
  "summary": "Optional. If provided, 3-4 sentences with the same rules that each sentence covers ONE story or ONE data point. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight', 'alongside', 'coupled with'. If omitted, it will be synthesized from the three structured fields above.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "market_pulse": {
    "sentiment_word": "One plain-English ADJECTIVE describing the market's psychological posture today. The word MUST grammatically complete the sentence 'Today the market is ___.' as a natural English adjective. MUST come from this exact list (alphabetical; no word is a default and none is preferred): buoyant, cautious, choppy, conflicted, defensive, divided, fragile, guarded, heavy, jittery, mixed, resilient, restrained, split, steady, uneasy. When a PRIOR SESSION CLOSE block is present above, the regime subset there narrows this list and is binding for the prior-close anchor. Pick the word the evidence supports, never a hedge. BANNED: do NOT use any of: crosscurrents, risk-on, risk-off, multifaceted, bifurcated, dichotomous, schizophrenic, paradoxical, asymmetric, nonlinear, numb, or any noun or hyphenated phrase that does not read as an adjective. If you want to convey crosscurrents, pick a genuine-tension adjective such as 'conflicted' or 'choppy' and let the narrative explain the cross-currents. One word. Lower-case. No punctuation.",
    "narrative": "2-3 short paragraphs (separated by \\n\\n) written in an editorial voice. The Market Pulse is the panoramic top-of-day read, NOT a preview of the lead. State the dominant emotional posture of capital markets today, then the two or three concrete catalysts driving that posture. Name specific companies, prints, or policy actions; no vague prose. Read it like a Stratechery opener, not a bank research note. LEAD THESIS (first sentence): open the narrative with ONE sentence stating the session's through-line as an analytical claim drawn from the tape and corpus, weighted forward (what matters today and why, causally and directionally at the market, sector, or macro level). It must be a claim with a reason, not a restatement of the sentiment_word (never 'Today the market is conflicted' with no argument behind it) and NOT a restatement of the index moves or regime ('indices fell and risk-off prevailed' is not a thesis). It asserts what the session turns on or what is at stake: rotation vs broad de-risking, positioning vs fundamentals, a single dominant catalyst, or the forward setup that matters. Do NOT open the narrative with 'The market is / Capital markets are [mood word]' or with an index recap; open with the through-line claim itself. This is ANALYSIS, not advice: interpret what conditions mean and take a directional analytical view ('a rotation into cyclicals, not de-risking', 'the setup favors duration into the print', 'the risk skews to a hawkish surprise'), and frame forward catalysts as scenarios or risks ('a hawkish dot plot would pressure duration'). Do NOT instruct the reader to act (no imperative 'rotate / buy / sell / trim / add / position', no 'you should', no 'we recommend'), do NOT issue a buy / sell / hold call or price target on a named security, and never state a forward outcome as a certainty. IMPERSONAL VOICE: write with no first person anywhere, singular or plural, and never the institutional 'we' (no 'we', 'us', 'our', 'I', 'we see', 'we expect', 'we recommend', 'in our view'); own every claim with a named actor, metric, filing, or event as the subject. Keep any backward-looking claim in the thesis consistent with the prior-close regime above. Gold pattern (reasoning to imitate, not text to copy): 'The session sets up around this afternoon's FOMC decision and the first dot plot of the cycle; the deal flow underneath it is secondary.' When a PRIOR SESSION CLOSE block is present above, your BACKWARD-looking posture (where we closed and the tone heading into the open) MUST match those index moves; your FORWARD-looking setup (what to watch into the session) is free to diverge when overnight catalysts or futures point the other way. MULTIPLICITY RULE: if you chose a sentiment_word that implies multiple forces in tension (mixed, divided, split, conflicted, choppy, uneasy), the body MUST name at least three DISTINCT stories or themes that create that tension, not three angles on the lead. GOOD (a genuine-tension day): 'Strategic dealmaking is back: AIP's carve-out of Honeywell's warehouse business signals private equity's return to industrial tech. But tech sentiment is heavier: Infosys guided below estimates and Tesla's $25B AI commitment is drawing capital allocation scrutiny. Geopolitically, the Iran leadership shift adds an oil-price overhang.' BAD (body only reinforces the lead): 'Capital markets are mixed today, driven by strategic M&A activity. Private equity continues to deploy capital, as seen with AIP's acquisition of Honeywell's warehouse solutions business.'",
    "headlines": "Array of 3-5 short driver chips — each an object with `title` (6-12 word phrase naming one specific story, company, or theme from a DIFFERENT article than the lead where possible) and optional `href` (source URL if available). These are the chips that render at the bottom of the Market Pulse card. When the sentiment_word implies tension (mixed, divided, split, conflicted, choppy, uneasy), at least 3 chips MUST represent distinct stories or themes pulling in different directions — not variants of the same deal or sector. If you cannot produce 3 genuinely distinct drivers from the corpus, omit this field rather than pad with near-duplicates."
  },
  "sections": {
    "deals_and_ma": "2-3 sentences on PATTERNS across multiple deals — consolidation pace, buyer archetypes, valuation compression, sector concentration. Do NOT re-narrate the primary_story here; cite it only as one data point among several. If the only transaction in the corpus is the primary_story, OMIT this section entirely rather than restate the lead.",
    "public_markets": "2-3 sentences on equity market moves, earnings beats/misses, and IPO pipeline. State the directional implication for deal valuations or risk appetite, not just the move. OMIT if no specific market moves or earnings in the articles.",
    "macro_and_rates": "2-3 sentences on rates, Fed signals, or FX moves. State the concrete effect on LBO spreads, deal multiples, or cost of capital — not just that rates moved. OMIT if no concrete rates or macro signal in the articles.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. OMIT THIS KEY ENTIRELY if no geopolitical event materially affected markets today — do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
    "sector_spotlight": "2-3 sentences on the single sector with the most concentrated deal or news activity today. Explain why the cluster is happening now — regulatory, cycle, or competitive pressure. Write the sector name explicitly. OMIT if no clear sector cluster exists OR if the only cluster is the primary_story's sector (which is already covered in the lead).",
    "what_to_watch": "Write 3-4 sentences of continuous prose (no bullets, no numbered list). Each sentence must name a specific company, ticker, Fed speaker, or scheduled data release, state the exact expected catalyst, and commit to the binary outcome that matters (e.g., 'A miss from X would signal demand destruction in Y, pressuring comps Z and W'). Write it as a paragraph a senior analyst would read aloud. BANNED phrases: 'investors should monitor', 'watch for', 'could be impacted', 'may be affected', 'bears watching', 'remain cautious'. Do NOT open a sentence with who is watching or focusing: no 'investors will be watching', 'will be a key focus', 'will likely focus on', 'will provide insight', 'could drive', 'will indicate [noun]'. Lead every sentence with the consequence or the stake (BAD: 'Investors will be watching X.' GOOD: 'A miss at X breaks the Y thesis and pressures Z.')."
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

HOUSE VOICE (highest priority, applies to every field; overrides any phrasing primed elsewhere in this prompt): write like a sharp analyst with a view, not a wire feed. (1) Never narrate who is watching, monitoring, observing, gauging, awaiting, or focusing on something, and never substitute 'analysts will focus on X' for an actual view: state the consequence or what is at stake directly. (2) Open market_pulse.narrative with an analytical through-line claim about what the day MEANT (rotation vs broad de-risking, positioning vs fundamentals, the dominant catalyst), never with 'the market closed [mood word]' and never with an index recap (the index moves may appear later in the body, just not as the opening line). The sentiment_word still carries the mood and still matches the TAPE FACTS regime; the opening line of the narrative carries the argument.

WATCHLIST DIRECTIVE:
The articles marked [WATCHLIST] below are from companies and tickers that users are actively tracking. When these companies appear in the news, prioritize them in your analysis:
- If a watchlist company is involved in a deal, it MUST appear in top_deals and deals_and_ma
- If a watchlist company has notable earnings or market moves, it MUST appear in public_markets or sector_spotlight
- Mention watchlist companies by name explicitly — do not bury them in generic sector commentary
- If watchlist signals are weak or off-topic today, it is acceptable to omit them — do not force irrelevant content

This directive applies only when [WATCHLIST] articles are present in the input. If no [WATCHLIST] articles are provided, ignore this directive entirely.

You will receive today's news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your wrap.

FIGURE-TYPING RULE — apply to every financial figure you state: first identify the figure's TYPE from the source article — capital raised, valuation, market cap, revenue, deal size / transaction value, or price target — and describe it with that exact type. NEVER substitute one type for another (do not call a capital raise a "valuation", a deal size a "market cap", or a price target a "valuation"). If the source does not make the type unambiguous, state the figure with no type descriptor rather than guess. Example: a "$75 billion IPO raise at a $1.75 trillion valuation" must be written as a $75B raise and a $1.75T valuation, never as a "$75 billion valuation".

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

SPECULATIVE SINGLE-NAME FRAMING: a story whose ONLY substance is one small or micro-cap company's self-promotional disclosure gets measured, skeptical analyst framing, never a credulous BULLISH read. Treat these as low-verification: (1) a company announcing its OWN crypto, token, AI, or treasury holdings or a 'strategic reserve'; (2) a micro-cap touting its own partnership, pipeline, MOU, or 'inaugural' report; (3) a promotional press-release-only item with no third-party confirmation; (4) a name flagged by a short-seller; (5) a headline-only claim with no corroborating coverage. For these: state plainly WHO claimed WHAT and that it is self-reported and unverified, give the market-impact context (a micro-cap self-disclosure rarely moves the broad tape), and set the top_deals sentiment to NEUTRAL (not BULLISH) unless an independent, named party confirms a priced transaction. Do NOT make one the lead. A confirmed, broadly-reported transaction or a priced deal with a named counterparty is different: it may carry a directional read. This shapes the brief-level framing only; it does not change the per-article sentiment chips.

SPECTATOR / HEDGE VOICE (harvested from real briefs, BANNED in every field). These narrate what someone WILL watch instead of stating the implication, and they are the dominant filler in current output. Do NOT use any of: 'investors will watch', 'investors will be watching', 'investors will monitor', 'investors will closely watch', 'investors should watch', 'market participants will observe', 'market participants will monitor', 'market participants will closely monitor', 'will be a key focus for analysts', 'will be a focus for analysts', 'follow-on analyst commentary', 'awaiting analyst commentary', 'will be key', 'will be a key indicator', 'will be a key factor', 'will be a critical factor', 'will determine if', 'will determine whether', 'will indicate whether', 'to gauge market', 'for indications of', 'for signals on', 'could provide insight', 'remains to be seen', 'it is worth noting', 'marking a significant transaction', 'represents a significant transaction', 'first-order event'. Attribution to analysts is NOT a substitute for a view: never write 'X will be a focus for analysts' in place of stating what X means. (Analytical attribution of a concrete fact, e.g. 'analysts flagged FCF coverage as the swing metric', stays allowed.) PATTERN BAN (catches reworded variants, not just the exact strings above): do not write any sentence whose main clause is the reader or the market watching, monitoring, observing, gauging, awaiting, being keen on, or focusing on something; lead with the consequence instead. Also banned regardless of exact wording: '[subject] will be a key focus' / 'will be the focus' / 'will be a focus', '[X] will indicate [noun]', '[X] could signal broader [noun]', 'the market will observe / monitor / be keen on'. If a sentence can be cut down to its consequence, cut it.

COMMITMENT RULE (positive, the point of this section): every forward line and every per-story line names a concrete driver, mechanism, number, or specific consequence and then states the implication in Signalera's own voice. Do not report that the market will watch something; say what it means and what is at stake. Rewrite example (illustrative, do not reuse this wording): replace 'Investors will watch [Company]'s stock to gauge demand' with 'A soft aftermarket would mark the [$X] block as overpriced and chill the [sector] issuance pipeline'.

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

1. Scan every article and Signal line. Identify articles with a CONFIRMED DOLLAR FIGURE in the headline or body — a specific transaction value like "$60 billion", "$17B", "$25 billion", or "$11.57 billion". A "confirmed dollar figure" means a number attached to a specific transaction, not a company's overall valuation, annual revenue, or unrelated amount.

2. ABSOLUTE RULE — PRICED OVER UNPRICED: If ANY article in the pool has a confirmed dollar figure of $1 billion or more attached to a specific transaction, the primary_story MUST be drawn from among those priced-transaction articles. An article with no confirmed dollar figure CANNOT be the primary_story while a priced-transaction article of $1B+ is available in the pool, regardless of freshness, sector, or narrative interest.

3. Among priced-transaction articles ($1B+): pick the one with the LARGEST confirmed dollar figure. This is the primary_story. If multiple articles describe the same transaction, pick the one with the most reputable source (FT, Bloomberg, Reuters, WSJ, NYT, Economist) and most recent timestamp.

4. FALLBACK when NO article in the pool has a confirmed dollar figure of $1B+: Apply this hierarchy:
   (a) Largest macro or rates event (Fed decision, CPI print, significant credit spread move, major central bank action)
   (b) Major geopolitical event with direct market consequence (war escalation, sanctions announcement, energy disruption)
   (c) Widest sector-moving development (single company earnings beat is NOT sufficient — needs to be a sector-wide signal)

5. Commitment: The entire lead block — `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch` — MUST be about the ONE primary_story you selected. Never stack two stories with 'and', commas, 'while', 'as', or 'amid'. Other important stories go into `sections`, `top_deals`, or `sector_breakdown` — NEVER into the lead block.

6. SELF-CHECK before writing any JSON:
   - Does my primary_story have a confirmed dollar figure of $1B+? If yes, proceed.
   - If no, does the pool have ANY article with a $1B+ confirmed transaction? If yes, STOP — reselect primary_story from that subset. My current choice is invalid.
   - If the pool has no $1B+ priced transaction at all, did I correctly apply the fallback hierarchy? Confirm the pick is a macro/geopolitical/sector event, not an unpriced M&A.

7. Output `primary_story_id` as a short identifier (original headline ~80 chars, or "acquirer + target", or "event + instrument"). The `headline` field below MUST name the same story. If they diverge, rewrite `headline` to match.

FAILURE EXAMPLES you must NOT reproduce:

- BAD: Picking "AIP Acquires Honeywell's Warehouse Business" (no disclosed price) when the pool contains "SpaceX acquires Cursor for $60 billion" (confirmed price).
- BAD: Picking the freshest M&A in the pool when an older M&A with a larger confirmed price is also in the pool.
- BAD: Picking an earnings beat as the lead when a $10B+ M&A transaction is available in the pool.

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
  "what_to_watch": "REQUIRED. 1-3 forward-looking sentences on the primary_story specifically: earnings response, regulatory review timeline, follow-on reactions, expected tomorrow price action in adjacent names. Name a specific company, data release, or speaker and commit to the binary outcome that matters. BANNED phrases: 'investors should monitor', 'watch for', 'bears watching', 'remain cautious'. Do NOT open a sentence with who is watching or focusing: no 'investors will be watching', 'will be a key focus', 'will likely focus on', 'will provide insight', 'could drive', 'will indicate [noun]'. Lead every sentence with the consequence or the stake (BAD: 'Investors will be watching X.' GOOD: 'A miss at X breaks the Y thesis and pressures Z.'). Must NOT be empty.",
  "summary": "Optional. If provided, 3-4 sentences. Each sentence must cover ONE story or ONE data point — never blend two unrelated topics into a single sentence with 'while', 'as', 'amid', or 'even as'. Every sentence must contain a specific company name, dollar figure, rate level, or index move. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight', 'alongside', 'coupled with'. If omitted, it will be synthesized from the three structured fields above.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "market_pulse": {
    "sentiment_word": "One plain-English ADJECTIVE describing the closing psychological posture of the tape. The word MUST grammatically complete the sentence 'Today the market is ___.' as a natural English adjective. MUST come from this exact list (alphabetical; no word is a default and none is preferred): buoyant, cautious, choppy, conflicted, defensive, divided, fragile, guarded, heavy, jittery, mixed, resilient, restrained, split, steady, uneasy. When TAPE FACTS are present above, the regime subset there narrows this list and is binding. Pick the word the evidence supports, never a hedge. BANNED: do NOT use any of: crosscurrents, risk-on, risk-off, multifaceted, bifurcated, dichotomous, schizophrenic, paradoxical, asymmetric, nonlinear, numb, or any noun or hyphenated phrase that does not read as an adjective. If you want to convey crosscurrents, pick a genuine-tension adjective such as 'conflicted' or 'choppy' and let the narrative explain the cross-currents. One word. Lower-case. No punctuation.",
    "narrative": "2-3 short paragraphs (separated by \\n\\n) written in an editorial voice. The Market Pulse is the panoramic close-of-day read, NOT a preview of the lead. Lead with the dominant emotional posture of the tape at the close, then the two or three concrete drivers: named earnings prints, Fed signal, sector moves. No hedging prose. Read it like a Stratechery close-of-day column, not a bank wrap. LEAD THESIS (first sentence): open the narrative with ONE sentence stating what the day MEANT as an analytical claim drawn from the tape and corpus, weighted backward (the through-line of the session, causally and directionally at the market, sector, or macro level). It must be a claim with a reason, not a restatement of the sentiment_word (never 'Today the market is heavy' with no argument behind it) and NOT a restatement of the index moves or regime ('the market closed heavy with indices broadly negative' is not a thesis). It asserts what the session turned on: rotation vs broad de-risking, positioning vs fundamentals, or the single dominant catalyst that drove the tape. Do NOT open the narrative with 'The market closed [mood word]' or with an index recap; open with the through-line claim itself. This is ANALYSIS, not advice: interpret and take a directional analytical view ('a rotation into cyclicals rather than broad de-risking', 'the selloff was positioning, not fundamentals'), consistent with the TAPE FACTS regime above. Do NOT instruct the reader to act (no imperative 'rotate / buy / sell / trim / add / position', no 'you should', no 'we recommend'), and do NOT issue a buy / sell / hold call or price target on a named security. IMPERSONAL VOICE: write with no first person anywhere, singular or plural, and never the institutional 'we' (no 'we', 'us', 'our', 'I', 'we see', 'we expect', 'we recommend', 'in our view'); own every claim with a named actor, metric, filing, or event as the subject. Gold pattern (reasoning to imitate, not text to copy): 'Tech sold off while the Dow closed at a record, a rotation into cyclicals rather than broad de-risking, with the chip names giving back last week's gains.' When TAPE FACTS are present above, the posture you describe MUST match those index moves. MULTIPLICITY RULE: if you chose a sentiment_word that implies multiple forces in tension (mixed, divided, split, conflicted, choppy, uneasy), the body MUST name at least three DISTINCT stories or themes that create that tension, not three angles on the lead. GOOD (a genuine-tension day): 'Strategic dealmaking is back: AIP's carve-out of Honeywell's warehouse business signals private equity's return to industrial tech. But tech sentiment is heavier: Infosys guided below estimates and Tesla's $25B AI commitment is drawing capital allocation scrutiny. Geopolitically, the Iran leadership shift adds an oil-price overhang.' BAD (body only reinforces the lead): 'Capital markets are mixed today, driven by strategic M&A activity. Private equity continues to deploy capital, as seen with AIP's acquisition of Honeywell's warehouse solutions business.'",
    "headlines": "Array of 3-5 short driver chips — each an object with `title` (6-12 word phrase naming one specific story, company, or theme from a DIFFERENT article than the lead where possible) and optional `href` (source URL if available). These are the chips that render at the bottom of the Market Pulse card. When the sentiment_word implies tension (mixed, divided, split, conflicted, choppy, uneasy), at least 3 chips MUST represent distinct stories or themes pulling in different directions — not variants of the same deal or sector. If you cannot produce 3 genuinely distinct drivers from the corpus, omit this field rather than pad with near-duplicates."
  },
  "sections": {
    "deals_and_ma": "2-3 sentences on PATTERNS across multiple deals — consolidation pace, buyer archetypes, valuation compression, sector concentration. Do NOT re-narrate the primary_story here; cite it only as one data point among several. If the only transaction in the corpus is the primary_story, OMIT this section entirely.",
    "public_markets": "2-3 sentences on how markets closed. Name the key movers and state what the tape is pricing in for tomorrow — not just that stocks went up or down. OMIT if no specific market close data or named movers in the articles.",
    "macro_and_rates": "2-3 sentences on macro and rates. State the concrete implication for deal multiples, credit spreads, or risk appetite into tomorrow. OMIT if no concrete rates or macro signal in the articles.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. OMIT THIS KEY ENTIRELY if nothing geopolitical materially affected markets today — do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
    "tomorrow_setup": "Write 3-4 sentences of continuous prose (no bullets, no numbered list). Each sentence must name a specific company, speaker, or data release, state the exact expected catalyst, and commit to what a beat or miss would signal for the broader market or sector. Write it as a paragraph a senior analyst would read aloud. BANNED phrases: 'investors should monitor', 'watch for', 'could be impacted', 'may be affected', 'bears watching', 'remain cautious'. Do NOT open a sentence with who is watching or focusing: no 'investors will be watching', 'will be a key focus', 'will likely focus on', 'will provide insight', 'could drive', 'will indicate [noun]'. Lead every sentence with the consequence or the stake (BAD: 'Investors will be watching X.' GOOD: 'A miss at X breaks the Y thesis and pressures Z.')."
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
    log_gemini_usage("brief_synthesis", GEMINI_MODEL, response)
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
        log_gemini_usage("evening_review", GEMINI_MODEL, resp)
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


# ── Macro release detection (slice 2, pure logic) ────────────────────────────
_MACRO_MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ],
        start=1,
    )
}


def _macro_period_ordinal(period):
    """Parse a macro period ('Month YYYY' or 'Qn YYYY') to a comparable
    (year, sub) tuple, or None when it cannot be parsed. A given release key
    keeps one frequency, so monthly and quarterly tuples are only ever compared
    within the same key."""
    if not period or not isinstance(period, str):
        return None
    parts = period.strip().split()
    if len(parts) != 2:
        return None
    head, year_s = parts
    try:
        year = int(year_s)
    except ValueError:
        return None
    if head in _MACRO_MONTHS:
        return (year, _MACRO_MONTHS[head])
    if len(head) == 2 and head[0] == "Q" and head[1] in "1234":
        return (year, int(head[1]))
    return None


def detect_fired_releases(previous_periods, current_periods):
    """Pure: keys whose period ADVANCED versus the previous run.

    Fires only when a key is present in BOTH dicts and the current period parses
    to a strictly newer (year, sub) than the previous. Does NOT fire on: a key
    missing from previous (cold start / new release), an unchanged period, a
    period that did not advance, or an unparseable period. Returns a sorted list.
    Detection is on PERIODS only, so a value change without a period change can
    never fire.
    """
    fired = []
    prev = previous_periods or {}
    cur = current_periods or {}
    for key, cur_period in cur.items():
        prev_period = prev.get(key)
        if prev_period is None:
            continue  # cold start / key absent from previous run
        if cur_period == prev_period:
            continue  # unchanged period
        co = _macro_period_ordinal(cur_period)
        po = _macro_period_ordinal(prev_period)
        if co is None or po is None:
            continue  # cannot determine direction -> do not fire
        if co > po:
            fired.append(key)
    return sorted(fired)


# ── Gated macro read (slice 2, prose only; numbers are GIVEN, never generated) ─
def _format_release_for_read(r):
    """One deterministic line per fired release for the read prompt."""
    figs = []
    for f in r.get("figures") or []:
        val = f.get("value")
        if val is None:
            continue
        unit = f.get("unit") or ""
        prior = f.get("prior")
        prior_s = "" if prior is None else f" (prior {prior}{unit})"
        figs.append(f"{f.get('label')} {val}{unit}{prior_s}")
    return f"{r.get('name')} ({r.get('period')}): " + "; ".join(figs)


def _format_tape_for_read(tape):
    if not isinstance(tape, dict):
        return "Market tape unavailable."
    bits = []
    if tape.get("regime"):
        bits.append(f"regime {tape.get('regime')}")
    if tape.get("vix_level") is not None:
        bits.append(f"VIX {tape.get('vix_level')}")
    return ("Market tape: " + ", ".join(bits) + ".") if bits else "Market tape unavailable."


def _generate_macro_read(fired_keys, releases, tape):
    """Gated LLM read for a release day. PROSE ONLY: the model is given the exact
    prints and asked for a short interpretation; no panel number is ever sourced
    from the model output (only the returned 'read' string is used). Returns the
    read string, or None when nothing fired, no fired release matched, or on any
    failure (soft-fail). Makes NO model call when fired_keys is empty.
    """
    if not fired_keys:
        return None
    try:
        fired_set = set(fired_keys)
        fired = [r for r in releases if r.get("key") in fired_set]
        if not fired:
            return None
        releases_block = "\n".join(_format_release_for_read(r) for r in fired)
        tape_block = _format_tape_for_read(tape)
        system = (
            "You are a buy-side macro analyst writing ONE tight paragraph for a "
            "morning brief. You are GIVEN today's exact economic prints below. Do "
            "not invent, change, or add any number; do not restate every figure. In "
            "2 to 3 sentences say what today's release(s) mean for rates, risk "
            "appetite, and positioning, consistent with the market tape. Return "
            'JSON only: {"read": "..."}.'
        )
        user_content = (
            "TODAY'S RELEASES (deterministic, do not alter):\n"
            f"{releases_block}\n\n{tape_block}"
        )
        raw = gemini_generate(
            system=system, user_content=user_content, temperature=0.3, max_tokens=512
        )
        raw = re.sub(r"^```json|^```|```$", "", raw or "", flags=re.MULTILINE).strip()
        data = json.loads(raw)
        if isinstance(data, dict):
            read = (data.get("read") or "").strip()
            return read or None
        return None
    except Exception as e:
        print(f"[synthesize] macro read generation failed (non-fatal): {e}")
        return None


# ── Brief synthesis retry (stub-prevention) ──────────────────────────────────
# A single transient Gemini error or rate limit must NOT silently degrade the
# whole brief to a stub. Incident 2026-06-16 (run #165): one un-retried failure
# stubbed the morning brief, the GitHub job still went green, and the frontend
# (which filters stubs) kept serving the prior day. Retries are bounded and
# backed off; the stub fallback in run() stays as the last resort after every
# attempt fails.
BRIEF_SYNTH_MAX_ATTEMPTS = 3
BRIEF_SYNTH_RETRY_BACKOFF_S = 5


def _parse_brief_json(raw):
    """Parse a Gemini brief response into a dict, or None. Strips code fences,
    tries a whole-string json.loads, then falls back to the first {...} block.
    Pure: no network, no retry, no side effects."""
    raw = re.sub(r"^```json|^```|```$", "", raw or "", flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                return None
    return None


def _generate_brief_json(
    system,
    user_content,
    max_attempts=BRIEF_SYNTH_MAX_ATTEMPTS,
    backoff_s=BRIEF_SYNTH_RETRY_BACKOFF_S,
):
    """Call gemini_generate for the main brief and parse it, retrying on a raised
    error OR an unparseable response. Returns the parsed dict, or None when every
    attempt fails (the caller then writes the stub). Most synthesis stubs were a
    single transient blip, so a bounded retry recovers the brief without a
    re-dispatch."""
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            raw = gemini_generate(
                system=system,
                user_content=user_content,
                temperature=0.3,
                max_tokens=4096,
            )
            data = _parse_brief_json(raw)
            if data is not None:
                if attempt > 1:
                    print(f"  ✓ Brief synthesis recovered on attempt {attempt}/{max_attempts}")
                return data
            last_err = f"unparseable response (raw: {(raw or '')[:200]!r})"
        except Exception as e:
            last_err = str(e)
        print(f"  ⚠ Brief synthesis attempt {attempt}/{max_attempts} failed: {last_err}")
        if attempt < max_attempts and backoff_s:
            time.sleep(backoff_s)
    print(
        f"  ✗ Brief synthesis failed after {max_attempts} attempts "
        f"({last_err}): falling back to stub briefing"
    )
    return None


def _build_morning_tape_directive(tape: dict) -> str:
    """Morning-adapted tape grounding block (prior-session-close framing).

    The morning brief generates pre-open, so market_tape.fetch_tape() returns
    the latest COMPLETED session close plus VIX (the same values the frontend
    RISK-OFF / RISK-ON banner reads pre-open). This block is therefore labeled
    PRIOR SESSION CLOSE, never "today's tape" or "how markets closed": a morning
    brief must not narrate a close that has not happened yet.

    Binding is split (the MORNING_SYSTEM sentiment_word / narrative clauses say
    the same):
      - BACKWARD-bound: sentiment_word, market_tone, and any "where we closed /
        posture into the open" statement must match the prior-close regime.
      - FORWARD-free: what_to_watch and the day's setup may diverge, because
        overnight catalysts and futures can point the other way.

    Reuses the same regime / vocabulary / tone constants as
    market_tape.build_tape_directive (no compute_regime duplication); only the
    framing label and the backward / forward split differ from the evening block.
    """
    quotes = tape["quotes"]
    regime = tape["regime"]
    vocab = market_tape.REGIME_VOCAB[regime]

    index_bits = []
    for sym, label in market_tape.TAPE_SYMBOLS.items():
        if sym == "^VIX":
            continue
        q = quotes.get(sym)
        if q:
            index_bits.append(f"{label}: {q['pct']:+.2f}%")
    vix = quotes["^VIX"]

    lines = [
        "[PRIOR SESSION CLOSE - deterministic latest-completed-session market data]",
        " | ".join(index_bits) if index_bits else "(index data unavailable)",
        f"VIX: {vix['price']:.1f} ({vix['pct']:+.1f}% vs prior close)",
        f"Computed regime at prior close: {regime.upper()}",
        "These figures are the latest completed session close, where the tape "
        "stands heading into today's open. They are NOT today's intraday trading "
        "and NOT a close that has already happened today. Use them to anchor "
        "backward-looking posture only.",
        "",
        "GROUNDING RULES (absolute, supersede any conflicting guidance below):",
        "- BACKWARD-looking (where we closed, the posture heading into the open): "
        "your market_pulse sentiment_word, market_tone, and every backward-looking "
        "market-direction claim MUST be consistent with the prior-close regime "
        "above. Never call the prior close resilient or rallying when the indices "
        "above are broadly negative, or heavy or defensive when they are broadly "
        "positive.",
        f"- sentiment_word MUST be one of exactly: {', '.join(vocab)}. No word "
        "outside this list is valid for the prior-close anchor.",
        f"- market_tone MUST be {market_tape.REGIME_MARKET_TONE[regime]}."
        + (" (MIXED is also acceptable.)" if regime == "neutral" else ""),
        "- FORWARD-looking (what_to_watch and the day's setup): you are FREE to "
        "diverge from the prior-close regime. Overnight catalysts, futures, and "
        "scheduled events can point the other way; make the forward call on its "
        "own evidence and do NOT force it to match where we closed.",
    ]
    return "\n".join(lines) + "\n\n"


def _fetch_prior_brief_lead():
    """PR1 continuity guard (T2): read the immediately-prior brief's headline (any
    type) so the materiality re-rank can decay a lead that already led last brief.
    The current brief is not written until after synthesis, so the most-recent
    briefings row IS the prior brief. Read-only; soft-fail to None so the guard is
    simply skipped when the lookup fails."""
    try:
        resp = (
            supabase.table("briefings")
            .select("headline, briefing_type, created_at")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if resp.data:
            headline = (resp.data[0].get("headline") or "").strip()
            if headline:
                print(f"  🔗 Prior brief lead (continuity): {headline[:70]}")
                return headline
    except Exception as e:
        print(f"  ⚠ prior-brief lead lookup failed (non-fatal): {e}")
    return None


def _maybe_inject_tape_directive(brief_type, system, tape=None):
    """Fetch the latest tape and prepend the surface-appropriate grounding block.

    Returns (system, tape_regime, tape). `tape` is the raw fetched tape dict (or
    None) so the caller can run the overview-subject materiality gate without a
    second fetch. Both morning and evening are grounded:
      - evening uses market_tape.build_tape_directive (close-of-day framing),
      - morning uses _build_morning_tape_directive (prior-session-close framing,
        backward-bound word / tone, forward-free what_to_watch).

    `tape` may be passed in by the caller (PR1 hoists a single fetch to lead-
    selection time so the materiality re-rank and this grounding path share ONE
    fetch); when None it is fetched here exactly as before.

    Soft-fail (identical to the original evening path): on a fetch error or an
    unusable tape, the system is returned UNCHANGED and tape_regime is None, so
    the post-parse enforce_tape_consistency backstop nulls sentiment_word rather
    than shipping a biased default. Never injects a block without a tape.
    """
    if tape is None:
        try:
            tape = market_tape.fetch_tape()
        except Exception as e:
            print(f"  ⚠ tape fetch failed (non-fatal): {e}")
    if not tape:
        print(f"  ⚠ tape unavailable - {brief_type} synthesis runs ungrounded; sentiment_word will be nulled")
        return system, None, None
    directive = (
        market_tape.build_tape_directive(tape)
        if brief_type == "evening"
        else _build_morning_tape_directive(tape)
    )
    print(f"  📊 Injected tape facts (regime: {tape['regime']}, vix: {tape['vix_level']:.1f})")
    return directive + system, tape["regime"], tape


# ── Lead-thesis opener guard ─────────────────────────────────────────────────
# The first sentence of market_pulse.narrative is the most visible line in the
# product, and it reliably regresses to a mood / index recap that the prompt
# alone cannot prevent (experiment fix/thesis-opener-reliability: 0/10 base in
# both modes across C0 / thinking-budget sweep / carrier-decouple; a thinking
# budget did not help and a high budget broke generation). This guard detects a
# recap opener deterministically and does ONE targeted re-ask that rewrites the
# narrative ONLY, leading with a named driver. If the re-ask still recaps (or
# fails), the original narrative is kept and the miss is logged. No loop, no
# stub rewrite. Validated lift on a real corpus: 0/10 -> 10/10 in both modes,
# residual 0; firing cost is at most one extra synthesis call per brief.
_OPENER_MOODS = set()
for _grp in market_tape.REGIME_VOCAB.values():
    _OPENER_MOODS |= set(_grp)
_OPENER_REGIME_WORDS = _OPENER_MOODS | {
    "de-risking", "de risking", "derisking", "risk-off", "risk off", "risk-on",
    "risk on", "defensive posture", "guarded posture", "cautious posture",
    "heavy posture", "risk-off posture",
}
_OPENER_EVENT_NOUNS = (
    "fomc", "fed ", "the fed", "cpi", "ppi", "pce", "payroll", "jobs report",
    "earnings", "guidance", "deal", "merger", "acquisition", "ipo", "offering",
    "buyout", "sanction", "tariff", "opec", "downgrade", "upgrade", "dot plot",
    "rate cut", "rate decision", "stake sale", "share sale", "block trade",
    "approval", "transaction",
)
_OPENER_INDEX_BLOCK = {
    "S&P", "Nasdaq", "Dow", "Russell", "VIX", "Jones", "Composite", "Capital",
    "Markets", "Market", "Today", "The", "Tech", "Wall", "Street", "Stocks",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December", "RISK", "Conversely",
    "Meanwhile", "Despite", "However", "Overall",
}
_OPENER_MKT_START = re.compile(
    r"^\W*(today'?s?\s+)?(the\s+)?(capital\s+)?(markets?|tape|session|trading|broader\s+market|"
    r"broad\s+market|s&p\s?500|nasdaq(\s+composite)?|dow(\s+jones)?|russell\s?2000|indices|"
    r"major\s+indices|stocks|equities|wall\s+street|u\.s\.\s+(stocks|equities|markets))\b", re.I)
_OPENER_INDEX_MOVE = re.compile(
    r"^\W*(today'?s?\s+)?(the\s+)?(s&p\s?500|nasdaq(\s+composite)?|dow(\s+jones)?|russell\s?2000|"
    r"stocks|equities|indices|major\s+indices|markets?)\s+(rose|fell|climbed|dropped|declined|"
    r"advanced|slid|sank|gained|lost|tumbled|rallied|plunged|slipped|jumped|closed|opened|edged|"
    r"ended|finished|sold\s+off|posted|traded)\b", re.I)
_OPENER_MOOD_TOKEN = re.compile(
    r"\b(" + "|".join(re.escape(m) for m in sorted(_OPENER_REGIME_WORDS, key=len, reverse=True)) + r")\b", re.I)


def _opener_first_sentence(narrative):
    p = (narrative or "").strip().split("\n\n")[0].strip()
    parts = re.split(r"(?<=[.!?])\s+", p)
    return parts[0].strip() if parts else p


def _opener_has_named_driver(s):
    sl = s.lower()
    if any(ev in sl for ev in _OPENER_EVENT_NOUNS):
        return True
    if re.search(r"\$\s?\d", s) or re.search(r"\b\d+(\.\d+)?\s?(billion|million|trillion)\b", sl):
        return True
    for t in re.findall(r"\b[A-Z][A-Za-z&.]+\b", s)[1:]:
        if t not in _OPENER_INDEX_BLOCK and len(t) > 1:
            return True
    return False


def _is_opener_recap(first_sentence):
    """True when the opener is a generic market/tape/index recap with no named
    driver, an index-move lead, or a market-subject mood/regime restatement."""
    s = (first_sentence or "").strip()
    if not s:
        return True, "empty"
    if _OPENER_INDEX_MOVE.match(s):
        return True, "index-move lead"
    if _OPENER_MKT_START.match(s):
        if not _opener_has_named_driver(s):
            return True, "market-subject, no named driver"
        if _OPENER_MOOD_TOKEN.search(s[:90]):
            return True, "market-subject + regime word"
    return False, ""


def _regenerate_opener(data, regime, brief_type):
    """ONE targeted re-ask: rewrite market_pulse.narrative so its first sentence
    leads with a named driver. Returns the new narrative string, or None on any
    failure. Thinking stays at 0 (gemini_generate default); this is prose only."""
    mp = data.get("market_pulse") or {}
    bad = _opener_first_sentence(mp.get("narrative"))
    weight = ("Weight the opener FORWARD: what matters today and why."
              if brief_type == "morning"
              else "Weight the opener BACKWARD: what the day MEANT.")
    system = (
        "You rewrite ONE field of a finished market brief. Return JSON only: "
        '{"narrative": "<rewritten narrative, 2-3 short paragraphs separated by \\n\\n>"}. '
        "No other keys, no prose outside the JSON. Zero em-dashes; use hyphens, colons, parens."
    )
    user = (
        f"The market_pulse.narrative opens with a banned mood/regime recap:\n\"{bad}\"\n\n"
        f"Lead story: {data.get('headline','')}\n{data.get('lead_paragraph','')}\n\n"
        f"Prior-close/tape regime: {regime}. The sentiment_word and market_tone already carry the "
        "mood; do NOT restate it.\n\n"
        "Rewrite the narrative so the FIRST sentence is a specific analytical claim about the day's "
        "single most important driver and what it means. RULES for that first sentence:\n"
        "- Start with the named driver (a company, deal, data release, sector move, or catalyst from "
        "the brief), NOT with 'the market / markets / tape / stocks / indices' and NOT with a mood or "
        "posture word.\n"
        "- Make a claim with a reason or through-line (what it means, what it turns on, rotation vs "
        "de-risking, positioning vs fundamentals).\n"
        "- This is analysis, not advice: no imperative act verbs, no buy/sell/hold or price target on "
        "a named security.\n"
        "- FORBIDDEN openings: 'the market is/was/closed/remains/reflected ...', 'capital markets are "
        "...', \"today's tape ...\", '[mood] posture', '[index] fell/rose X%', any sentence whose "
        "subject is the market/tape/indices.\n"
        f"{weight}\n"
        "Keep the rest of the narrative's substance and paragraph count. Return JSON only."
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.3, max_tokens=1024)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get("narrative"), str) and parsed["narrative"].strip():
            return parsed["narrative"].strip()
    except Exception as e:
        print(f"  ⚠ opener guard: re-ask call failed (non-fatal): {e}")
    return None


# ── Section entity validation (D8) ───────────────────────────────────────────
# The single brief generation produces every section in one JSON. A section can
# name an org that is nowhere in the corpus (observed: "Texas Pacific Land"
# hallucinated into a section). Build the authoritative org roster from the
# article corpus (titles + bodies + resolved companies[]) and flag any
# capitalized multi-word org named in a section that is absent from it. A clear
# hallucination (org absent from the corpus entirely) triggers ONE re-ask. Not
# over-engineered: a conservative proper-noun extractor, substring containment.
_ENTITY_STOP = frozenset((
    "The", "This", "That", "These", "Those", "Federal", "Reserve", "Wall",
    "Street", "Street's", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December", "AI", "CEO", "CFO", "IPO",
    "GDP", "CPI", "PCE", "FOMC", "US", "U.S.", "Q1", "Q2", "Q3", "Q4",
))


def _candidate_orgs(text):
    """Conservative proper-noun org extractor: runs of capitalized tokens
    (optionally joined by &/of/and) of length >= 2 words, or a single ALL-CAPS
    ticker-like token of length >= 2. Returns a set of candidate org strings."""
    if not isinstance(text, str) or not text.strip():
        return set()
    out = set()
    # Multi-word capitalized runs, e.g. "Texas Pacific Land", "Goldman Sachs".
    for m in re.finditer(r"\b([A-Z][A-Za-z.&'\-]+(?:\s+(?:of\s+|and\s+|&\s+)?[A-Z][A-Za-z.&'\-]+){1,4})\b", text):
        phrase = m.group(1).strip()
        toks = [t for t in re.split(r"\s+", phrase) if t]
        # Drop runs that are entirely stopwords / sentence-initial noise.
        if all(t in _ENTITY_STOP for t in toks):
            continue
        out.add(phrase)
    return out


# Common first words that, on their own, do NOT support a multi-word org. A bare
# "texas" in the corpus ("West Texas") must NOT vouch for "Texas Pacific Land".
# Geographies, generic descriptors, and high-frequency name heads only.
_ORG_GENERIC_HEADS = frozenset((
    "texas", "new", "american", "america", "united", "national", "global",
    "international", "general", "first", "north", "south", "east", "west",
    "central", "pacific", "atlantic", "european", "european", "asian",
    "western", "eastern", "northern", "southern", "capital", "city", "state",
    "federal", "bank", "group", "holdings", "holding", "partners", "industries",
    "technologies", "systems", "solutions", "financial", "international",
))


def _org_supported(org, corpus_lc, allowed_lc):
    """True when an org candidate is supported. Supported means: the full phrase
    appears in the corpus or resolved-company roster, OR a DISTINCTIVE multi-token
    prefix of the phrase does. A single common first word (a geography or generic
    head like "texas", "new", "national") is NOT sufficient on its own: the old
    head-token fallback deemed "Texas Pacific Land" supported because "texas"
    appears in the corpus ("West Texas"), letting the exact hallucination D8 must
    catch slip through (#422 review fix)."""
    o = org.strip().lower()
    if not o:
        return True
    if o in allowed_lc:
        return True
    if o in corpus_lc:
        return True
    toks = o.split()
    # Single-token org (e.g. "AbbVie"): the whole-string checks above are the only
    # support; no prefix relaxation, so a lone unsupported token stays unsupported.
    if len(toks) < 2:
        return False
    # Multi-word org: accept a distinctive PREFIX match so "AbbVie" / "AbbVie Inc"
    # supports "AbbVie Therapeutics", but require either (a) a >=2-token prefix
    # (the first two words together, distinctive enough), or (b) a single first
    # word that is NOT a generic/geographic head. A common first word like "texas"
    # alone can never vouch for the phrase.
    two = " ".join(toks[:2])
    if two in allowed_lc or two in corpus_lc:
        return True
    head = toks[0]
    if len(head) > 3 and head not in _ORG_GENERIC_HEADS and (
        head in allowed_lc or head in corpus_lc
    ):
        return True
    return False


def _unsupported_orgs_in_sections(sections, corpus_text, allowed_companies):
    """Return {section_key: [unsupported org, ...]} for every section whose prose
    names an org absent from the corpus and the resolved-company roster."""
    corpus_lc = (corpus_text or "").lower()
    allowed_lc = {str(c).strip().lower() for c in (allowed_companies or []) if str(c).strip()}
    flagged = {}
    if not isinstance(sections, dict):
        return flagged
    for key, val in sections.items():
        if not isinstance(val, str) or not val.strip():
            continue
        bad = [o for o in _candidate_orgs(val) if not _org_supported(o, corpus_lc, allowed_lc)]
        if bad:
            flagged[key] = sorted(set(bad))
    return flagged


def _regenerate_sections_entity_safe(sections, flagged, corpus_text, allowed_companies):
    """ONE targeted re-ask: rewrite the flagged sections so they name only orgs
    present in the corpus / resolved companies. Returns a dict of rewritten
    sections, or None on any failure. Prose only; thinking stays at default 0."""
    roster = ", ".join(sorted({str(c).strip() for c in (allowed_companies or []) if str(c).strip()}))
    bad_lines = "\n".join(f"- {k}: {', '.join(v)}" for k, v in flagged.items())
    only = {k: sections[k] for k in flagged if k in sections}
    system = (
        "You correct factual entity errors in a finished market brief. Return JSON "
        'only: {"sections": {"<section name>": "<rewritten text>", ...}}. No other '
        "keys, no prose outside the JSON. Zero em-dashes; use hyphens, colons, parens."
    )
    user = (
        "These sections name organizations that do NOT appear anywhere in today's "
        "source articles and are likely hallucinated:\n"
        f"{bad_lines}\n\n"
        "Rewrite ONLY these sections so every organization named is one that actually "
        "appears in the corpus below or in this resolved-company roster. Drop or "
        "replace any unsupported name; keep the real signal. Do not invent new "
        "companies. Keep each section's length and intent.\n\n"
        f"RESOLVED COMPANIES: {roster}\n\n"
        f"SECTIONS TO FIX (JSON): {json.dumps(only)}\n\n"
        f"SOURCE CORPUS (excerpt):\n{(corpus_text or '')[:6000]}"
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.2, max_tokens=2048)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get("sections"), dict):
            return parsed["sections"]
    except Exception as e:
        print(f"  ⚠ entity guard: re-ask call failed (non-fatal): {e}")
    return None


# ── Corrective entity-fact injection (D7 backend) ────────────────────────────
# Gemini drifts on fast-changing public/private status (it wrote SpaceX as
# private after its 2026-06-12 IPO). Inject an authoritative fact line built from
# EXISTING facts: finnhub_helper.HARD_TICKER_OVERRIDES already pins the canonical
# ticker (spacex -> SPCX), and the small status map below records the few names
# whose public/private status the model gets wrong. v1 needs no migration; the
# companion UNAPPLIED migration (see migrations dir) persists this into the
# entity store for a future read-from-DB version.
_ENTITY_FACT_STATUS = {
    # lowercase canonical name -> (status, exchange)
    "spacex": ("public", "NASDAQ"),
    "berkshire hathaway": ("public", "NYSE"),
}


def _build_entity_fact_block(corpus_companies):
    """Build the [ENTITY FACTS] directive for the companies present in today's
    corpus that have an authoritative pinned fact. Returns "" when none apply.
    Pure; safe import of finnhub_helper (no I/O at import)."""
    try:
        from finnhub_helper import HARD_TICKER_OVERRIDES
    except Exception:
        HARD_TICKER_OVERRIDES = {}
    present = {str(c).strip().lower() for c in (corpus_companies or []) if str(c).strip()}
    lines = []
    for name in sorted(present):
        ticker = HARD_TICKER_OVERRIDES.get(name)
        status = _ENTITY_FACT_STATUS.get(name)
        if not ticker and not status:
            continue
        disp = name.title() if name.islower() else name
        bits = []
        if status:
            st, exch = status
            bits.append(st)
            if ticker:
                bits.append(f"{exch}: {ticker}")
            elif exch:
                bits.append(exch)
        elif ticker:
            bits.append(f"ticker {ticker}")
        lines.append(f"- {disp}: {', '.join(bits)}")
    if not lines:
        return ""
    return (
        "[ENTITY FACTS - authoritative, supersede any conflicting prior belief]\n"
        "Treat these as ground truth for status and ticker; do not describe any of "
        "these as private or pre-IPO:\n"
        + "\n".join(lines)
        + "\n\n"
    )


# ── Overview redundancy guard (D9) ───────────────────────────────────────────
# headline + lead_paragraph + market_pulse.narrative routinely narrate the SAME
# story, so the panoramic overview just restates the lead. Detect a narrative
# whose opening paragraph adds no NET-NEW driver beyond the headline/lead, then
# do ONE re-ask that rewrites the narrative to introduce distinct drivers. The
# opener guard re-anchors to headline+lead; this guard runs after it and pushes
# the other way (breadth, not restatement).
_RED_STOP = frozenset((
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as",
    "at", "by", "is", "are", "its", "it", "after", "amid", "over", "from", "new",
    "today", "market", "markets", "stock", "shares", "billion", "million",
    "deal", "company", "inc", "corp", "this", "that", "into", "than", "but",
))


def _significant_tokens(text):
    toks = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {t for t in toks if t not in _RED_STOP and len(t) > 3}


def _narrative_is_redundant(headline, lead, narrative):
    """True when the narrative's FIRST paragraph adds essentially no net-new
    content beyond headline + lead (Jaccard-style overlap of significant tokens
    above a threshold and no fresh named token)."""
    first = (narrative or "").strip().split("\n\n")[0]
    n_tok = _significant_tokens(first)
    if not n_tok:
        return False
    base = _significant_tokens(headline) | _significant_tokens(lead)
    if not base:
        return False
    fresh = n_tok - base
    overlap = len(n_tok & base) / max(1, len(n_tok))
    # Redundant when the opening paragraph is mostly the lead's vocabulary and
    # brings fewer than two genuinely new significant tokens.
    return overlap >= 0.6 and len(fresh) < 2


def _regenerate_narrative_net_new(data, regime, brief_type):
    """ONE re-ask: rewrite market_pulse.narrative so it adds NET-NEW drivers
    distinct from the headline/lead instead of restating them. Returns the new
    narrative string or None. Prose only."""
    mp = data.get("market_pulse") or {}
    system = (
        "You rewrite ONE field of a finished market brief. Return JSON only: "
        '{"narrative": "<rewritten narrative, 2-3 short paragraphs separated by \\n\\n>"}. '
        "No other keys, no prose outside the JSON. Zero em-dashes; use hyphens, colons, parens."
    )
    user = (
        "The market_pulse.narrative below just restates the lead story. The lead is "
        "already covered in the headline and lead paragraph; the Market Pulse is the "
        "PANORAMIC read and must add DIFFERENT drivers.\n\n"
        f"Headline: {data.get('headline','')}\n"
        f"Lead paragraph: {data.get('lead_paragraph','')}\n"
        f"Regime: {regime}\n\n"
        f"Current narrative:\n{mp.get('narrative','')}\n\n"
        "Rewrite the narrative so it names at least two DISTINCT drivers or themes "
        "beyond the lead story (other deals, sectors, macro, breadth, volatility), and "
        "does NOT re-narrate the lead beyond a single passing mention. Keep the "
        "analytical opener rule: first sentence is a through-line claim led by a named "
        "driver, not 'the market is [mood]' and not an index recap. Keep the paragraph "
        "count. Return JSON only."
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.35, max_tokens=1024)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get("narrative"), str) and parsed["narrative"].strip():
            return parsed["narrative"].strip()
    except Exception as e:
        print(f"  ⚠ redundancy guard: re-ask call failed (non-fatal): {e}")
    return None


def _resolve_lead_ticker(company_name):
    """Best-effort gen-time ticker for a lead company name, or None. Tries the
    deterministic HARD_TICKER_OVERRIDES first (no network), then finnhub search
    (the same gen-time resolver the pipeline already uses) when a key is present.
    Soft-fail: None on anything, which makes the D14 direction check inert."""
    name = (company_name or "").strip()
    if not name:
        return None
    try:
        from finnhub_helper import HARD_TICKER_OVERRIDES
        ov = HARD_TICKER_OVERRIDES.get(name.lower())
        if ov:
            return ov
    except Exception:
        pass
    try:
        from finnhub_helper import search_finnhub_ticker
        return search_finnhub_ticker(name)
    except Exception:
        return None


def _lead_session_move(preselected):
    """D14 + T3: return (session_pct, framing, company_name) for the lead's single
    named company, or (None, None, None) when not a single-name lead, the ticker
    cannot be resolved, or the live quote is unavailable. Uses the EXISTING
    market_tape.fetch_quote (Yahoo, baseline-correct prior close) as the gen-time
    live source: no new dependency. The company_name lets the caller seed the T3
    driver set without a second fetch. Fully soft-fail, never raises out."""
    try:
        cos = preselected.get("companies") or []
        if isinstance(cos, str):
            try:
                cos = json.loads(cos)
            except Exception:
                cos = [cos]
        cos = [str(c).strip() for c in cos if str(c).strip()]
        if not cos or len(cos) > 2:
            return None, None, None
        ticker = _resolve_lead_ticker(cos[0])
        if not ticker:
            return None, None, None
        quote = market_tape.fetch_quote(ticker)
        if not quote or quote.get("pct") is None:
            return None, None, None
        framing_src = " ".join(str(preselected.get(k) or "") for k in ("title", "summary"))
        framing = market_tape.classify_framing(framing_src)
        return float(quote["pct"]), framing, cos[0]
    except Exception:
        return None, None, None


def _pool_name_session_moves(pool, cap=20):
    """Build a {company_name_lower: session_pct} map for the materiality ranker's
    per-name driver tiers. Reuses the EXISTING lead-quote path (_resolve_lead_ticker
    + market_tape.fetch_quote, Yahoo, no new dependency). BOUNDED: walks the pool
    highest-relevance-first, dedups by company name, and stops after `cap` resolved
    quotes so a large coverage pool cannot fan out into one call per article. Pure
    read (no writes); fully soft-fail, never raises out. Returns ({}, 0) on any
    failure or empty pool."""
    moves: dict = {}
    calls = 0
    try:
        def _rel(a):
            try:
                return int(a.get("relevance_score") or 0)
            except (TypeError, ValueError):
                return 0
        seen: set = set()
        for a in sorted(pool or [], key=_rel, reverse=True):
            cos = a.get("companies") or []
            if isinstance(cos, str):
                try:
                    cos = json.loads(cos)
                except Exception:
                    cos = [cos] if cos.strip() else []
            for co in cos:
                nm = str(co or "").strip().lower()
                if not nm or nm in seen:
                    continue
                seen.add(nm)
                ticker = _resolve_lead_ticker(co)
                if not ticker:
                    continue
                try:
                    q = market_tape.fetch_quote(ticker)
                except Exception:
                    q = None
                if q and q.get("pct") is not None:
                    moves[nm] = float(q["pct"])
                    calls += 1
                if calls >= cap:
                    return moves, calls
    except Exception as e:
        print(f"  ⚠ materiality name-moves fetch skipped (non-fatal): {e}")
    return moves, calls


def _resolve_final_lead(data, spine, floor, companies_of_fn):
    """T1: resolve the FINAL chosen overview/lead subject AFTER generation, on
    BOTH the pre-pick and the Gemini self-select path. Returns
    (company_name, companies_list, title, summary) for the single named subject,
    or (None, None, headline, lead) when no single name resolves (caller then
    defaults MARKET-WIDE; never promotes an unvalidated single name).

    Resolution order (P0.2): match the generated headline / primary_story_id back
    to a spine/floor corpus article and take its companies[]; else fall back to
    top_deals[0].company. The corpus match is preferred because it ties the
    subject to a real article roster. Pure over the passed-in corpus + data; the
    live quote is fetched separately by the caller (network)."""
    if not isinstance(data, dict):
        return None, None, "", ""
    headline = (data.get("headline") or "").strip()
    psid = (data.get("primary_story_id") or "").strip()
    lead = (data.get("lead_paragraph") or "").strip()

    def _toks(s):
        return {t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if len(t) > 3}

    hl_toks = _toks(headline) | _toks(psid)
    best = None
    best_overlap = 0
    if hl_toks:
        for a in (spine or []) + (floor or []):
            at = _toks(a.get("title") or "")
            if not at:
                continue
            overlap = len(hl_toks & at)
            if overlap > best_overlap:
                best_overlap = overlap
                best = a
    # Require a non-trivial title overlap so we don't bind to a random article.
    if best is not None and best_overlap >= 2:
        cos = companies_of_fn(best)
        if cos:
            return cos[0], cos, headline or (best.get("title") or ""), lead

    # Fallback: the first top_deals company (the self-select deal-lead case).
    top_deals = data.get("top_deals") or []
    if isinstance(top_deals, list):
        for d in top_deals:
            if isinstance(d, dict):
                co = (d.get("company") or "").strip()
                if co:
                    return co, [co], headline, lead

    return None, None, headline, lead


def _final_lead_session_move(name, title, summary):
    """T1: adapt _lead_session_move to a single NAME from the self-select path.
    Synthesizes the minimal dict _lead_session_move expects and returns
    (session_pct, framing, company_name). Soft-fail to (None, None, None)."""
    if not name:
        return None, None, None
    return _lead_session_move(
        {"companies": [name], "title": title or "", "summary": summary or ""}
    )


def _body_ticker_direction_flags(text, corpus_companies):
    """T4 (scoped to FLAG, not reframe): for named companies in the overview body
    that carry a directional claim, check the live quote and FLAG any whose
    direction contradicts the quote. Returns a list of human-readable flags.
    Soft-fail, never raises; an unresolved ticker or missing quote is skipped.

    Scope decision (see report): this ships FLAG + LOG only. A full body reframe
    is deferred. We only check companies that already appear in the corpus roster
    (so we never invent a name to check) and that carry a clear bullish/bearish
    framing in the body text."""
    flags = []
    if not isinstance(text, str) or not text.strip():
        return flags
    low = text.lower()
    seen = set()
    for co in (corpus_companies or []):
        nm = str(co).strip()
        if not nm or nm.lower() in seen or nm.lower() not in low:
            continue
        seen.add(nm.lower())
        # Localize framing to the sentence(s) mentioning this name.
        sentences = [s for s in re.split(r"[.!?]+", text) if nm.lower() in s.lower()]
        framing = market_tape.classify_framing(" ".join(sentences))
        if framing is None:
            continue
        ticker = _resolve_lead_ticker(nm)
        if not ticker:
            continue
        try:
            quote = market_tape.fetch_quote(ticker)
        except Exception:
            quote = None
        if not quote or quote.get("pct") is None:
            continue
        pct = float(quote["pct"])
        if market_tape.framing_contradicts_session(framing, pct):
            flags.append(f"{nm}: {framing} framing vs {pct:+.1f}% session move")
    return flags


def _retemporalize_field(field_name, text, event_date, brief_date, data):
    """D13 fallback: ONE targeted re-ask when the deterministic in-place rewrite
    would garble the sentence. Rewrite ONE field so its relative-time wording is
    anchored to the brief date. Prose only, narrative/lead only. Returns the new
    string or None on any failure. This is the only path in D13 that calls the
    model, and it runs only on the garble branch (not exercised by the offline
    harness, which asserts the pure normalizer)."""
    phrase = temporal_grounding.relative_phrase(event_date, brief_date)
    if phrase is None:
        when = (
            "The event has NO confirmed date: do NOT write 'today', 'this morning', "
            "or any present-tense relative time; describe it without a relative-time word."
        )
    else:
        when = (
            f"The event happened {phrase}, NOT today (brief date {brief_date.isoformat()}). "
            f"Use '{phrase}' or plain past tense, never 'today' / 'this morning'."
        )
    key = "narrative" if field_name == "narrative" else "field"
    system = (
        "You rewrite ONE field of a finished market brief to fix its relative-time "
        f'wording only. Return JSON only: {{"{key}": "<rewritten text>"}}. No other '
        "keys, no prose outside the JSON. Keep every fact and the paragraph count. "
        "Zero em-dashes; use hyphens, colons, parens."
    )
    user = (
        f"{when}\n\nRewrite ONLY the relative-time wording; change nothing else.\n\n"
        f"TEXT:\n{text}"
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.2, max_tokens=1024)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get(key), str) and parsed[key].strip():
            return parsed[key].strip()
    except Exception as e:
        print(f"  ⚠ temporal guard: re-ask call failed (non-fatal): {e}")
    return None


def _tape_facts_block(tape):
    """T2: render the fetched tape numbers as explicit FACTS for the grounded
    market-wide rewrite. Only the numbers actually present are stated; nothing is
    invented. Returns '' when no tape."""
    if not tape:
        return "No live tape is available; do NOT assert any market direction or index figure."
    quotes = tape.get("quotes") or {}
    bits = []
    for sym, label in (("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^RUT", "Russell 2000")):
        q = quotes.get(sym)
        if q and q.get("pct") is not None:
            try:
                bits.append(f"{label} {float(q['pct']):+.2f}%")
            except (TypeError, ValueError):
                pass
    vix = tape.get("vix_level")
    try:
        if vix is not None:
            bits.append(f"VIX {float(vix):.1f}")
    except (TypeError, ValueError):
        pass
    regime = (tape.get("regime") or "").strip().upper()
    facts = "; ".join(bits) if bits else "(index data unavailable)"
    return f"TAPE FACTS (ground truth): {facts}. Regime: {regime or 'UNKNOWN'}."


def _rewrite_market_wide_grounded(data, tape, corpus_companies, relegated_title,
                                  corpus_text, extra_correction="", lead_is_dominant=False):
    """T1/T2: ONE bounded grounded re-ask that rewrites market_pulse.narrative as
    a MARKET-WIDE read characterized ONLY from the fetched tape numbers. The hero
    (Market Pulse) is ALWAYS a synthesis of the whole tape, run regardless of the
    lead gate (T1). The lead story is woven in as at most a one-line EXAMPLE, never
    the subject, and is never restated verbatim from the lead block.

    When `lead_is_dominant` is True (the gate PASSED: one event genuinely IS the
    market, e.g. a Fed shock), the honest market-wide read may CENTER on that story
    (T4); it is still framed as the market's read, not a single-name writeup, and
    must not duplicate the lead block's sentences. Brevity is explicitly allowed on
    a thin pool. Returns the new narrative string or None on failure. The model
    call is wired here; it is not exercised by the offline harness."""
    roster = ", ".join(sorted({str(c).strip() for c in (corpus_companies or []) if str(c).strip()})[:60])
    facts = _tape_facts_block(tape)
    system = (
        "You rewrite ONE field of a finished market brief: market_pulse.narrative. "
        "Return JSON only: {\"narrative\": \"<rewritten narrative, paragraphs "
        "separated by \\n\\n>\"}. No other keys, no prose outside the JSON. Zero "
        "em-dashes; use hyphens, colons, parens."
    )
    if lead_is_dominant:
        _lead_clause = (
            f"- The lead story (\"{(relegated_title or '')[:160]}\") genuinely dominates "
            "the tape today, so the market-wide read MAY center on it - but as the "
            "MARKET'S read driven by that event, NOT as a single-name writeup. Do NOT "
            "restate the lead block's sentences verbatim; the hero is the broad-tape "
            "synthesis.\n"
        )
    else:
        _lead_clause = (
            f"- The lead story (\"{(relegated_title or '')[:160]}\") may appear as at most "
            "a ONE-LINE example, never as the through-line. Do NOT restate the lead "
            "block verbatim.\n"
        )
    user = (
        "The Market Pulse hero is ALWAYS a MARKET-WIDE synthesis of the whole tape, "
        "NOT a single-name writeup. A single story appears only as an example woven "
        "in.\n\n"
        f"{facts}\n\n"
        "RULES (absolute):\n"
        "- Characterize the market ONLY from the TAPE FACTS above. Do not assert a "
        "direction the tape does not support; if the tape is quiet, say so.\n"
        "- Any company or story you name MUST come from this corpus roster: "
        f"{roster or '(none)'}. Do not introduce any other named entity.\n"
        f"{_lead_clause}"
        "- BREVITY IS ALLOWED: when material is thin, a short overview is correct. Do "
        "NOT pad to a fixed length.\n\n"
        f"{extra_correction}\n\n"
        "CURRENT NARRATIVE:\n"
        + str((data.get("market_pulse") or {}).get("narrative") or "")
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.3, max_tokens=1024)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get("narrative"), str) and parsed["narrative"].strip():
            return parsed["narrative"].strip()
    except Exception as e:
        print(f"  ⚠ market-wide rewrite re-ask failed (non-fatal): {e}")
    return None


def _pulse_macro_strip():
    """MARKET_PULSE_V2: build a compact macro backdrop strip for the dedicated pulse
    call. Reuses the SAME data-layer fetchers the morning macro_panel uses
    (macro_calendar + bea_calendar) and renders only the numbers actually present.
    Numbers never pass through the model here (they are fetched facts). Soft-fail to
    '' so a data-layer miss never blocks the pulse call. Not exercised by the
    offline harness (it hits the data layers)."""
    try:
        releases = macro_calendar.fetch_macro_releases() + bea_calendar.fetch_bea_releases()
    except Exception as e:
        print(f"  ⚠ pulse macro strip fetch failed (non-fatal): {e}")
        return ""
    lines = []
    for r in releases or []:
        try:
            name = getattr(r, "name", "") or ""
            period = getattr(r, "period", "") or ""
            figs = []
            for f in (getattr(r, "figures", None) or [])[:2]:
                val = getattr(f, "value", None)
                if val is None:
                    continue
                unit = getattr(f, "unit", "") or ""
                label = getattr(f, "label", "") or ""
                prior = getattr(f, "prior", None)
                bit = f"{label} {val}{unit}".strip()
                if prior is not None:
                    bit += f" (prior {prior}{unit})"
                figs.append(bit)
            if name and figs:
                lines.append(f"{name} ({period}): " + "; ".join(figs))
        except Exception:
            continue
    return "\n".join(lines)


def _pulse_top_stories(spine, floor, companies_of_fn, limit=5):
    """MARKET_PULSE_V2: reduce the ranked spine (then floor) to the top N stories as
    color for the dedicated pulse call: title + one-liner + sector, no bodies. Pure
    over the passed lists."""
    out = []
    for a in (list(spine or []) + list(floor or [])):
        title = (a.get("title") or "").strip()
        if not title:
            continue
        sector = (a.get("sector") or "").strip()
        one_liner = (a.get("summary") or a.get("relevance_reason") or "").strip()
        one_liner = one_liner[:180]
        cos = companies_of_fn(a) if companies_of_fn else []
        out.append({"title": title, "sector": sector, "one_liner": one_liner, "companies": cos})
        if len(out) >= limit:
            break
    return out


def generate_market_pulse(brief_type, tape, macro, top_stories, prior_ctx=None):
    """MARKET_PULSE_V2: ONE bounded, focused Gemini call that produces
    market_pulse.narrative with the TAPE + MACRO as the SUBJECT and stories only as
    color. This is the dedicated call that fixes the article-dominated monolith
    anchoring the hero on the lead story's sector. Returns the narrative string, or
    None on failure (caller keeps the monolith narrative).

    Inputs:
      brief_type  : "morning" | "evening" (drives claim-scope framing).
      tape        : fetch_tape() dict (indices + VIX + regime).
      macro       : compact macro strip string (may be '').
      top_stories : [{title, sector, one_liner, companies}] as color only.
      prior_ctx   : optional prior-session context string (prior brief lead).

    Contract (stated in the prompt AND enforced by the deterministic post-check in
    overview_grounding.validate_pulse_opening): paragraph 1 is the index-level equity
    read with the macro backdrop woven in; no single company or single sector is the
    SUBJECT of paragraph 1; stories are color after the market read; morning uses
    opened/opening/early-session framing (never a settled whole-day close), evening
    may render a closed full-session verdict; brevity is allowed on thin tape.

    The model call is wired here; it is NOT exercised by the offline harness (which
    tests only the pure post-check). Gemini is never called at import time."""
    facts = _tape_facts_block(tape)
    regime = (tape or {}).get("regime") if isinstance(tape, dict) else None
    vocab = market_tape.REGIME_VOCAB.get((regime or "").strip().lower(), ())
    if brief_type == "evening":
        claim_scope = (
            "CLAIM SCOPE (EVENING, absolute): the session has CLOSED. Render the "
            "settled full-session verdict; closing verbs are correct ('closed up', "
            "'ended the day', 'finished the session'). Paragraph 1 is the close-of-day "
            "index read."
        )
    else:
        claim_scope = (
            "CLAIM SCOPE (MORNING, absolute): the session is IN PROGRESS. Describe the "
            "market as it OPENED and is TRADING in the EARLY SESSION, using "
            "opening/early-session verbs ONLY ('opened higher', 'is trading up', "
            "'early gains', 'up in early trade'). FORBIDDEN: any settled whole-day or "
            "closing verdict ('closed', 'closed up', 'ended the day', 'finished', 'on "
            "the day') - the session has NOT closed yet."
        )
    story_lines = []
    for s in (top_stories or [])[:5]:
        t = (s.get("title") or "").strip()
        if not t:
            continue
        sec = (s.get("sector") or "").strip()
        ol = (s.get("one_liner") or "").strip()
        story_lines.append(f"- [{sec}] {t}" + (f" - {ol}" if ol else ""))
    stories_block = "\n".join(story_lines) if story_lines else "(no ranked stories)"
    macro_block = macro.strip() if isinstance(macro, str) and macro.strip() else "(no fresh macro prints)"
    prior_block = (prior_ctx or "").strip()

    system = (
        "You write ONE field of a daily market brief: market_pulse.narrative, the "
        "hero read of the whole market. Return JSON only: {\"narrative\": \"<1-2 "
        "paragraphs, paragraphs separated by \\n\\n>\"}. No other keys, no prose "
        "outside the JSON. Zero em-dashes; use hyphens, colons, parens.\n\n"
        "You are a sharp analyst with a view, not a wire feed. State the market's "
        "read and what is at stake; never narrate who is 'watching' or 'awaiting'."
    )
    user = (
        "Write the Market Pulse. The SUBJECT is the MARKET (index-level equities + "
        "the macro backdrop), NOT any single company or sector.\n\n"
        f"{claim_scope}\n\n"
        f"{facts}\n\n"
        f"MACRO BACKDROP (fetched facts, do not invent):\n{macro_block}\n\n"
        f"RANKED STORIES (COLOR ONLY - examples woven in AFTER the market read, never "
        f"the subject):\n{stories_block}\n\n"
        + (f"PRIOR SESSION CONTEXT: {prior_block}\n\n" if prior_block else "")
        + "RULES (absolute):\n"
        "- PARAGRAPH 1 is the index-level equity read: S&P / Nasdaq / breadth / VIX "
        "with the macro backdrop woven in. NO single company and NO single sector may "
        "be the SUBJECT of paragraph 1.\n"
        "- A sector trend MAY be mentioned, but the pulse must NEVER read as a single-"
        "sector overview. Any story named is at most a one-line EXAMPLE after the "
        "market read.\n"
        "- Characterize direction ONLY from the TAPE FACTS above. If the tape is "
        "quiet, say so. Do not assert a move the tape does not support.\n"
        "- ENTITY FIDELITY: name every company EXACTLY as written in the RANKED "
        "STORIES above (correct name and capitalization). Do NOT invent, abbreviate, "
        "or malform a name (no constructions like 'The Unum'). Name ONLY organizations "
        "that appear in the stories or tape above; name no others.\n"
        f"- The mood must be consistent with the regime "
        f"({(regime or 'unknown').upper()}"
        + (f"; e.g. words like {', '.join(vocab[:4])}" if vocab else "")
        + ").\n"
        "- Obey the CLAIM SCOPE stated at the top exactly.\n"
        "- BREVITY IS ALLOWED: on a thin tape a short read is correct. Do NOT pad."
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.3, max_tokens=1024)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get("narrative"), str) and parsed["narrative"].strip():
            return parsed["narrative"].strip()
    except Exception as e:
        print(f"  ⚠ MARKET_PULSE_V2 dedicated call failed (non-fatal): {e}")
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
    # Use a 48-hour window for published_at to allow late-breaking
    # articles that were genuinely published within ~2 days. RSS feeds
    # sometimes republish older content with new ingest timestamps —
    # filtering on both published_at AND ingested_at prevents stale items
    # (sometimes 100+ days old) from being chosen as "Top Stories".
    publish_cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    # `url`, `source`, and `deal_type` are required by lead_preselect.py —
    # url joins to deal_flow.source_url, source feeds the tier tiebreaker,
    # and deal_type drives the macro/geopolitical fallback hierarchy.
    resp = supabase.table("articles")\
        .select("title, summary, content, url, source, sector, industry_verticals, companies, deal_type, relevance_score, relevance_reason, published_at, ingested_at")\
        .gte("ingested_at", cutoff)\
        .gte("published_at", publish_cutoff)\
        .order("relevance_score", desc=True)\
        .limit(60)\
        .execute()

    articles = resp.data or []
    if not articles:
        # Fallback: if the 48h published_at filter excludes everything (rare),
        # widen to 7 days but still respect freshness — never go fully unbounded.
        wide_publish_cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        resp = supabase.table("articles")\
            .select("title, summary, content, url, source, sector, industry_verticals, companies, deal_type, relevance_score, relevance_reason, published_at, ingested_at")\
            .gte("published_at", wide_publish_cutoff)\
            .order("ingested_at", desc=True)\
            .limit(60)\
            .execute()
        articles = resp.data or []

    # Freshness-aware re-rank: an older story only wins the spine if its
    # relevance edge is big enough to overcome its age. Without this, a
    # score-9 story from 22h ago beats a score-8 story from 3h ago even when
    # the brief ships at 6am ET.
    articles = _freshness_rerank(articles)

    # --- Path B: deterministic primary_story pre-pick (lead_preselect) ---
    # Filters the corpus to confirmed $1B+ deals via deal_flow, ranks by
    # size/freshness/source, and falls back through macro → geopolitical
    # → sector when no qualifying priced transaction exists. If this
    # returns an article, we hoist it into spine slot 0 and inject a
    # directive telling Gemini "narrate this, do not re-rank". If it
    # returns None, Gemini's in-prompt PRIMARY STORY SELECTION block
    # (PR #128) runs as fallback — behavior matches pre-Path-B exactly.
    # impact_ranking is now the LIVE lead path: it ranks by MARKET IMPACT
    # (distinct-source coverage breadth + recency + tier-1 / recent-event boost +
    # confirmed mega-deal) over the broad point-in-time pool, fixing the deal-size
    # blind spot that led 2026-06-18 with Eightco over the hawkish Fed. It FALLS
    # BACK to lead_preselect's deal-size pick, and then to Gemini's in-prompt
    # selection, when it returns no confident cluster, so the lead is never empty.
    # The chosen lead is hoisted into spine slot 0 with a narrate-this directive.
    preselected = None
    preselect_directive = None
    lead_source = "gemini"
    # PR1: the tape fetched once here (shadow/active only) is threaded into the
    # grounding path below so the whole brief makes exactly ONE fetch_tape() call.
    _materiality_tape = None
    _now = datetime.now(timezone.utc)
    _pool = None
    # Materiality shadow pick title; captured in the block below and compared
    # post-generation against the real served headline. Initialized here (outside
    # the lead-selection try) so it is always defined at the shipped-lead capture.
    _materiality_shadow_title = None
    try:
        from lead_preselect import preselect_primary_story, build_preselect_directive

        # Deal-size pick (kept as fallback + telemetry).
        deal_pick = None
        try:
            deal_pick = preselect_primary_story(articles, brief_type)
        except Exception as e:
            print(f"  ⚠ deal-size pre-selector failed: {e}")

        # Impact pick over the broad coverage pool.
        impact_pick = None
        try:
            import impact_ranking
            _pool = impact_ranking.fetch_coverage_pool(supabase, _now)
            _impact = (
                impact_ranking.compute_lead(
                    _pool, _now, mega_deal_urls=impact_ranking._mega_deal_urls(supabase, _now)
                )
                if _pool else None
            )
            if _impact and _impact.get("article"):
                impact_pick = dict(_impact["article"])
                impact_pick["_preselect_reason"] = f"impact_rank:{_impact['cluster_key']}"
                impact_pick["_impact_score"] = _impact["score"]
                impact_pick["_impact_breadth"] = _impact["breadth"]
                impact_pick["_impact_cluster"] = _impact["cluster_key"]
        except Exception as e:
            print(f"  ⚠ impact lead failed (falling back to deal-size pick): {e}")
            impact_pick = None

        preselected = impact_pick or deal_pick
        lead_source = "impact" if impact_pick else ("deal_preselect" if deal_pick else "gemini")

        # PR1: tape-aware materiality re-rank (shadow-first, behind MATERIALITY_RANK_MODE).
        # It shares the ONE tape fetch with the grounding path below (threaded via
        # _materiality_tape). SHADOW logs what it WOULD pick vs the shipped lead and
        # leaves `preselected` unchanged; ACTIVE replaces it BEFORE the hoist +
        # directive build. Selection-only: the #431 gate, the #436 always-market-wide
        # hero, and the grounding post-check are untouched. Fails closed on any error.
        if MATERIALITY_RANK_MODE != "off" and brief_type in ("morning", "evening"):
            try:
                import impact_ranking as _ir
                try:
                    _materiality_tape = market_tape.fetch_tape()
                except Exception as _te:
                    print(f"  ⚠ materiality tape fetch failed (non-fatal): {_te}")
                    _materiality_tape = None
                _prior_lead = _fetch_prior_brief_lead()
                # Per-name session moves for the pool's top candidate names, so the
                # driver tiers (tape-driver bonus / mover-contradicts-tape penalty)
                # can actually fire. Bounded + deduped (reuses the lead-quote path).
                _name_moves, _name_move_calls = _pool_name_session_moves(_pool) if _pool else ({}, 0)
                if _name_moves:
                    print(f"  🧪 [materiality] fetched {_name_move_calls} name session moves for driver tiers")
                _mat = _ir.compute_materiality_lead(
                    _pool, _now, tape=_materiality_tape,
                    name_session_pct=_name_moves,
                    prior_lead_title=_prior_lead,
                    mega_deal_urls=_ir._mega_deal_urls(supabase, _now),
                ) if _pool else None
                if _mat and _mat.get("article"):
                    _mat_title = str(_mat["article"].get("title") or "")[:200]
                    _materiality_shadow_title = _mat_title
                    _prepick_title = str((preselected or {}).get("title") or "")[:200]
                    print(f"  🧪 [materiality:{MATERIALITY_RANK_MODE}] would lead "
                          f"{_mat['cluster_key']}: {_mat_title[:70]} (pre-pick: {_prepick_title[:50]})")
                    try:
                        import lead_preselect as _lp2
                        _lp2._LAST_DECISION_LOG.update({
                            "materiality_mode": MATERIALITY_RANK_MODE,
                            "materiality_lead_title": _mat_title,
                            "materiality_cluster": _mat["cluster_key"],
                            "materiality_base_cluster": _mat.get("base_cluster_key"),
                            "materiality_score": _mat.get("score"),
                            "materiality_base_score": _mat.get("base_score"),
                            "materiality_delta": _mat.get("materiality_delta"),
                            "materiality_continuity_delta": _mat.get("continuity_delta"),
                            "materiality_reasons": _mat.get("materiality_reasons"),
                            "materiality_prior_lead": _prior_lead,
                            "materiality_name_move_count": _name_move_calls,
                            # materiality_diverged_from_shipped + shipped_lead are
                            # set POST-generation vs the real served headline below.
                        })
                    except Exception:
                        pass
                    if MATERIALITY_RANK_MODE == "active":
                        preselected = dict(_mat["article"])
                        preselected["_preselect_reason"] = f"materiality:{_mat['cluster_key']}"
                        preselected["_impact_score"] = _mat.get("score")
                        preselected["_impact_breadth"] = _mat.get("breadth")
                        preselected["_impact_cluster"] = _mat["cluster_key"]
                        lead_source = "materiality"
                        print(f"  ✅ [materiality:active] lead replaced -> {_mat['cluster_key']}")
            except Exception as _me:
                print(f"  ⚠ materiality re-rank skipped (non-fatal, keeping shipped lead): {_me}")

        if preselected:
            # Hoist into slot 0 so the selector/prompt see it first.
            _url = (preselected.get("url") or "").strip()
            articles = [preselected] + [
                a for a in articles if (a.get("url") or "").strip() != _url
            ]
            preselect_directive = build_preselect_directive(preselected)
            print(
                f"  🎯 Lead [{lead_source}] ({preselected.get('_preselect_reason')}): "
                f"{(preselected.get('title') or '')[:80]}"
            )
        else:
            print("  🎯 No deterministic lead (Gemini will select)")

        # Telemetry: which path won + both candidates, into the run decision log.
        try:
            import lead_preselect as _lp
            _lp._LAST_DECISION_LOG.update({
                "lead_source": lead_source,
                "impact_lead_title": (impact_pick.get("title") if impact_pick else None),
                "impact_lead_cluster": (impact_pick.get("_impact_cluster") if impact_pick else None),
                "impact_lead_score": (impact_pick.get("_impact_score") if impact_pick else None),
                "deal_lead_title": (deal_pick.get("title") if deal_pick else None),
            })
        except Exception:
            pass
    except Exception as e:
        print(f"  ⚠ Lead selection failed (Gemini will select): {e}")
        preselected = None
        preselect_directive = None

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

    def _companies_of(a):
        c = a.get("companies") or []
        if isinstance(c, str):
            try:
                c = json.loads(c)
            except Exception:
                c = [c] if c.strip() else []
        return [str(x).strip() for x in c if str(x).strip()]

    # D8: pass the RESOLVED companies[] into section generation. Without them the
    # model only saw title/body/signal and hallucinated org names (e.g. "Texas
    # Pacific Land"). The Entities line is the authoritative roster for each
    # article; the post-gen entity check below validates every named org against
    # this corpus + resolved companies.
    def _entities_line(a):
        cos = _companies_of(a)
        return ("\nEntities: " + ", ".join(cos)) if cos else ""

    spine_texts = [
        f"[{a.get('sector','')}] {a.get('title','')}\n{_spine_body(a)}"
        + _entities_line(a)
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in spine
    ]
    # Floor: shortened summary (150 chars) — breadth signals, not lead stories
    floor_texts = [
        f"[{a.get('sector','')}] {a.get('title','')}\n{(a.get('summary','') or '')[:150]}"
        + _entities_line(a)
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in floor
    ]

    article_text = "\n\n".join(spine_texts)
    if floor_texts:
        article_text += "\n\n--- ADDITIONAL SECTOR SIGNALS ---\n\n" + "\n\n".join(floor_texts)
    if watchlist_text:
        article_text += watchlist_text

    system = MORNING_SYSTEM if brief_type == "morning" else EVENING_SYSTEM

    # Path B: if the deterministic pre-selector picked a lead, prepend its
    # directive so Gemini narrates (doesn't re-rank). The in-prompt PRIMARY
    # STORY SELECTION block inside MORNING_SYSTEM/EVENING_SYSTEM remains
    # intact as defense-in-depth for days when the pre-selector returns
    # None (see lead_preselect.py docstring and SPEC_path_b §6).
    if preselect_directive:
        system = preselect_directive + "\n\n" + system

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

    # --- Deterministic tape grounding (morning + evening) ------------------
    # Fetch index + VIX quotes (baseline-correct prior close via
    # market_tape.parse_yahoo_daily) and compute the regime with the shared
    # ladder that also drives the frontend banner (src/lib/market-regime.ts).
    # EVENING: close-of-day framing; the directive binds the whole market_pulse
    # narrative, the sentiment_word vocabulary, and market_tone to those numbers.
    # MORNING: the brief generates pre-open, so fetch_tape returns the latest
    # completed session close (the same values the banner reads pre-open). The
    # prior-session-close directive binds sentiment_word, market_tone, and the
    # BACKWARD-looking posture to that regime while leaving the FORWARD call
    # (what_to_watch, the day's setup) free to diverge on overnight catalysts, so
    # the morning hero stops writing "risk-on surge" under a RISK-OFF banner.
    # Soft-fail (both surfaces): with no tape, synthesis runs ungrounded and the
    # post-parse backstop below nulls sentiment_word instead of shipping an
    # unverifiable word. Never defaults to a biased word.
    tape_regime = None
    tape_obj = None
    if brief_type in ("morning", "evening"):
        system, tape_regime, tape_obj = _maybe_inject_tape_directive(
            brief_type, system, tape=_materiality_tape)

    # --- Overview-subject materiality gate (D2+D3) -------------------------------
    # Break the inheritance where the market_pulse overview subject = the pre-picked
    # lead. The default overview is a market-wide synthesis chosen independently from
    # the fresh tape. A single-name OR pure-deal/fundraise lead may become the
    # overview SUBJECT only if it clears the conservative materiality gate (material
    # tape move AND story is the tape's cited driver AND its EVENT-level cluster has
    # dominant cross-source breadth). Otherwise it is relegated to a MENTION. The
    # decision rides the existing system-prompt prepend path; no route file is edited.
    # _pregen_gate captures the pre-pick gate decision so the post-generation
    # final-lead gate (T1) does NOT re-relegate a pre-pick story that already
    # PASSED the full gate (with real breadth) just because breadth cannot be
    # recomputed post-gen. None when no pre-pick gate ran (the self-select path).
    _pregen_gate = None
    if brief_type in ("morning", "evening") and preselected:
        try:
            _ps_companies = preselected.get("companies") or []
            if isinstance(_ps_companies, str):
                try:
                    _ps_companies = json.loads(_ps_companies)
                except Exception:
                    _ps_companies = [_ps_companies]
            _ps_deal_type = (preselected.get("deal_type") or "").strip().lower()
            _pure_deal_types = {
                "m&a", "mergers & acquisitions", "lbo", "ipo", "funding",
                "fundraising", "debt financing", "minority stake", "asset sale",
                "ipo & capital markets",
            }
            _is_pure_deal = _ps_deal_type in _pure_deal_types
            _is_single_name = bool(_ps_companies) and len(_ps_companies) <= 2
            _is_single_or_deal = _is_single_name or _is_pure_deal
            # Distinct-source breadth of the pick's EVENT-level cluster (post-D1).
            _breadth = (preselected.get("_impact_breadth") or {})
            _distinct_sources = int(_breadth.get("distinct_sources") or 0)
            # D14: resolve the single-name lead's CURRENT-SESSION move and framing
            # so the gate can reject stale-direction framing (bullish lead vs a
            # ticker that is materially DOWN today). Soft-fail to (None, None, None),
            # which leaves the gate's behavior identical to before.
            _lead_pct, _lead_framing, _lead_name = (None, None, None)
            if _is_single_name:
                _lead_pct, _lead_framing, _lead_name = _lead_session_move(preselected)
            # T3 driver-set v1: build tape_driver_names from gen-time per-name moves.
            # The tape fetch surfaces only indices + VIX, so the candidate set is the
            # resolved lead company whose live session move we already fetched above
            # (no second network call). build_tape_driver_names keeps only materially
            # large movers (|move| > DRIVER_MIN_ABS_PCT, top DRIVER_TOP_K). Empty set
            # when no quote / no material mover -> the gate falls back to market-wide
            # exactly as before (fail-safe; never promotes on magnitude alone, the
            # gate still also requires a material tape and dominant breadth).
            _driver_names = None
            if _lead_name and _lead_pct is not None:
                _drivers = market_tape.build_tape_driver_names({_lead_name: _lead_pct})
                _driver_names = _drivers or None
            _gate = market_tape.overview_subject_gate(
                story_companies=_ps_companies,
                is_single_name_or_deal=_is_single_or_deal,
                cluster_distinct_sources=_distinct_sources,
                tape=tape_obj,
                tape_driver_names=_driver_names,
                subject_session_pct=_lead_pct,
                subject_framing=_lead_framing,
            )
            _pregen_gate = _gate
            system = market_tape.build_overview_subject_directive(
                _gate, story_title=(preselected.get("title") or "")
            ) + system
            # T5 overlap enforcement: when the gate relegated the lead (it is not
            # the day's dominant driver), force 'The Close' overview and the lead
            # block onto distinct subjects so the evening surfaces do not both
            # resolve to the same stale lead. Materiality-gated, deterministic,
            # rides the existing prepend path. No-op when the lead IS the dominant
            # driver (gate passed) or for a market-wide story.
            _overlap_directive = market_tape.build_overlap_enforcement_directive(_gate)
            if _overlap_directive:
                system = _overlap_directive + system
                print("  🔗 Overlap enforcement: lead relegated; narrative must take a distinct subject")
            if _gate.get("direction_contradiction"):
                print(f"  ⚖ live-quote reconciliation: lead is {_lead_framing} but ticker "
                      f"{_lead_pct:+.1f}% today; instructing reframe")
            print(f"  🧭 Overview subject gate: {_gate['subject']} ({'; '.join(_gate['reasons'])})")
            try:
                import lead_preselect as _lp
                _lp._LAST_DECISION_LOG.update({
                    "overview_subject": _gate["subject"],
                    "overview_gate_passed": _gate["passed"],
                    "overview_gate_checks": _gate["checks"],
                })
            except Exception:
                pass
        except Exception as e:
            print(f"  ⚠ overview-subject gate skipped (non-fatal): {e}")

    # --- Temporal grounding directive (D13) -------------------------------------
    # Anchor relative-time words to the brief date. The articles schema has no
    # distinct event timestamp (P0.1), so the lead's event_date is derived from
    # its published_at converted to ET; NULL published_at => UNKNOWN, which forbids
    # any "today" claim. This is the prompt-side first line of defense; the
    # deterministic post-parse normalizer below is the backstop. Soft-fail.
    brief_date_et = temporal_grounding.brief_date_et()
    lead_event_date = None
    if preselected:
        try:
            lead_event_date = temporal_grounding.event_date_et(
                preselected.get("published_at")
            )
            system = temporal_grounding.build_temporal_directive(
                brief_date_et, lead_event_date,
                lead_title=(preselected.get("title") or ""),
            ) + system
            _ed = lead_event_date.isoformat() if lead_event_date else "UNKNOWN"
            print(f"  🕒 Temporal anchor: brief={brief_date_et.isoformat()} lead_event={_ed}")
        except Exception as e:
            print(f"  ⚠ temporal grounding directive skipped (non-fatal): {e}")

    # --- Market-holiday / weekend awareness (market_calendar.py, soft-fail) ------
    # On a full-day US equity closure, the tape above is the LAST completed session
    # close (fetch_tape returns the prior close when there is no live session). We
    # reuse that prior-session-close framing as-is and add a directive that states
    # the closure and pins the numbers to the prior close in the PAST tense, so the
    # brief never implies live trading. News sections still generate. The closure
    # is also stamped onto market_pulse (no migration) for the render hero.
    market_closed = False
    holiday_name = None
    last_trading_session = None
    try:
        import market_calendar
        _et_today = (datetime.now(timezone.utc) - timedelta(hours=5)).date()
        _mstat = market_calendar.market_status(_et_today)
        market_closed = bool(_mstat.get("market_closed"))
        holiday_name = _mstat.get("holiday_name")
        last_trading_session = _mstat.get("last_trading_session")
        if market_closed:
            _label = holiday_name or "a market holiday"
            system = (
                "[MARKET CLOSED TODAY - deterministic US trading calendar]\n"
                f"US equity markets are CLOSED today for {_label}; there is no live "
                "session. The index and VIX figures above are the LAST COMPLETED SESSION "
                f"close ({last_trading_session}), NOT today's trading. State the closure "
                "plainly near the top, and frame every market-level number in the PAST "
                "tense as that prior close; do not imply live or intraday movement today. "
                "Keep producing every news section (deals, earnings, sectors, catalysts) "
                "as usual: corporate and macro news still matters on a closed day.\n\n"
            ) + system
            print(f"  📅 Market CLOSED today ({_label}); injected closed-day directive")
    except Exception as e:
        print(f"  ⚠ market-calendar check skipped (non-fatal): {e}")

    # --- Scheduled-catalyst injection (deterministic floor + live FRED actuals).
    # The static floor (FOMC + dot plot, CPI / PCE / NFP) is the guaranteed
    # schedule; the live layer enriches with reported values and soft-fails to the
    # floor (see event_calendar.py). Values are framed as reported market data,
    # never a Signalera prediction. Stashed for the render strip, which rides in
    # macro_panel.catalysts (no new column, no migration).
    catalyst_list = []
    _catalyst_block = ""
    try:
        import event_calendar
        _cat_asof = (datetime.now(timezone.utc) - timedelta(hours=5)).date()
        catalyst_list = event_calendar.get_catalysts(_cat_asof, brief_type)
        if catalyst_list:
            _catalyst_block = event_calendar.build_catalyst_block(catalyst_list, _cat_asof, brief_type)
            print(f"  🗓 Prepared {len(catalyst_list)} scheduled catalyst(s)")
    except Exception as e:
        print(f"  ⚠ catalyst prep skipped (non-fatal): {e}")

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

    # Prepend the scheduled-catalyst block OUTERMOST (highest attention) so an
    # imminent FOMC / key print is the first directive the model reads. The render
    # strip is the deterministic visibility guarantee; this is best-effort narrative
    # surfacing.
    if _catalyst_block:
        system = _catalyst_block + system
        print(f"  🗓 Injected scheduled-catalyst block ({len(catalyst_list)} event(s), outermost)")

    # --- Corrective entity-fact injection (D7 backend) --------------------------
    # Pin authoritative status/ticker for fast-changing names (e.g. SpaceX is
    # public, NASDAQ: SPCX after the 2026-06-12 IPO) so the model stops describing
    # them as private. Built from existing facts (HARD_TICKER_OVERRIDES); no DB
    # read, no migration required for v1. Soft-fail.
    try:
        _corpus_companies = []
        for a in (spine + floor):
            _corpus_companies.extend(_companies_of(a))
        _entity_fact_block = _build_entity_fact_block(_corpus_companies)
        if _entity_fact_block:
            system = _entity_fact_block + system
            print(f"  🏷 Injected entity-fact block ({_entity_fact_block.count(chr(10) + '- ')} fact line(s))")
    except Exception as e:
        print(f"  ⚠ entity-fact injection skipped (non-fatal): {e}")

    # Bounded retry: a single transient model error or rate limit no longer
    # stubs the whole brief (see _generate_brief_json). Returns None only after
    # every attempt fails, which the stub fallback below then handles.
    data = _generate_brief_json(system, f"Today's articles:\n\n{article_text}")

    # Post-parse tape-consistency backstop (morning + evening). With a known
    # regime, an out-of-subset sentiment_word is overridden to the regime
    # default and an inconsistent market_tone is corrected; with no regime
    # (tape fetch failed), sentiment_word is forced to None. enforce only
    # rewrites market_tone and market_pulse.sentiment_word, never what_to_watch,
    # so the morning FORWARD call stays free. Runs before the stub fallback so a
    # failed parse never reaches enforcement.
    if data is not None and brief_type in ("morning", "evening"):
        try:
            tape_warnings = market_tape.enforce_tape_consistency(data, tape_regime)
            for w in tape_warnings:
                print(f"  ⚠ tape consistency: {w}")
        except Exception as e:
            print(f"  ⚠ tape consistency enforcement failed (non-fatal): {e}")

    # Stub = synthesis exhausted every retry. The brief did NOT generate; the
    # frontend filters this headline and serves the prior day. run() returns the
    # flag so run.py can surface the run as failed instead of green-washing it.
    brief_is_stub = data is None
    if data is None:
        data = {
            "headline": "Market Intelligence Unavailable",
            "summary": "Briefing generation failed. Please check logs.",
            "market_tone": "NEUTRAL",
            "sections": {},
            "top_deals": [],
            "sector_breakdown": {}
        }

    # --- Gate on the FINAL chosen lead (T1+T2+T3+T4, morning + evening) ----------
    # #430 ran the overview-subject gate ONLY on the pre-pick path (inside the
    # pre-generation `if preselected:` block). When the deterministic pre-pick
    # returned None, Gemini self-selected the lead in-prompt and the gate, D14, and
    # T5 were all bypassed: the overview rode a single Gemini-chosen name with no
    # check. This block re-runs the gate on the FINAL chosen subject regardless of
    # how it was chosen, and when the gate relegates a single name it FORCES a
    # grounded market-wide rewrite + deterministic post-check. Fail-safe: an
    # unresolvable lead name defaults MARKET-WIDE (never promotes an unvalidated
    # single name). Soft-fail; never blocks the response.
    if not brief_is_stub and brief_type in ("morning", "evening"):
        try:
            _final_corpus_companies = []
            for a in (spine + floor):
                _final_corpus_companies.extend(_companies_of(a))

            # If the PRE-PICK gate already ran with real breadth and PASSED (the
            # lead is genuinely the dominant driver), honor it: do not re-relegate
            # post-gen where breadth cannot be recomputed. Only re-evaluate when
            # there was no pre-pick gate (Gemini self-select) OR the pre-pick gate
            # already relegated (in which case the directive was injected pre-gen,
            # and this post-check confirms + grounds the final narrative).
            _pregen_passed = bool(_pregen_gate and _pregen_gate.get("passed"))

            _lead_name, _lead_cos, _lead_title, _lead_summary = _resolve_final_lead(
                data, spine, floor, _companies_of
            )
            if _pregen_passed:
                _final_gate = _pregen_gate
            elif _lead_name:
                _f_pct, _f_framing, _f_name = _final_lead_session_move(
                    _lead_name, _lead_title, _lead_summary
                )
                _f_drivers = None
                if _f_name and _f_pct is not None:
                    _f_drivers = market_tape.build_tape_driver_names({_f_name: _f_pct}) or None
                _final_gate = market_tape.overview_subject_gate(
                    story_companies=_lead_cos,
                    is_single_name_or_deal=True,  # a single resolved name IS single-name
                    cluster_distinct_sources=0,   # post-gen we cannot recompute breadth; conservative
                    # KNOWN LIMITATION (decision b, confirmed by Noah): on the
                    # self-select path the gate may only RELEGATE to market-wide,
                    # never affirmatively promote a single name, because event-level
                    # breadth is not recomputable post-generation. This is intended
                    # conservative behavior; affirmative single-name promotion on this
                    # path is deferred to the v2 modes build (needs a gen-time breadth
                    # signal). cluster_distinct_sources=0 here is by design, not a bug.
                    tape=tape_obj,
                    tape_driver_names=_f_drivers,
                    subject_session_pct=_f_pct,
                    subject_framing=_f_framing,
                )
            else:
                # Fail-safe: no single name resolved -> treat as relegated (market-wide).
                _final_gate = {"subject": "market_wide", "passed": False,
                               "reasons": ["final lead name unresolvable; defaulting market-wide"],
                               "checks": {}}

            print(f"  🧭 Final-lead gate: {_final_gate['subject']} "
                  f"({'; '.join(_final_gate.get('reasons') or [])})")

            # T1 (decouple Market Pulse): the hero is ALWAYS a market-wide synthesis
            # of the whole tape, regardless of the lead gate decision. Previously the
            # grounded rewrite ran ONLY on the relegate branch
            # (`if subject == "market_wide"`), so a gate-PASS single name was left
            # owning the hero (the Jun 29 Rocket Lab/Iridium $8B bug). We now run the
            # grounded market-wide rewrite + grounding post-check on the hero on BOTH
            # branches. When the gate PASSED (the lead genuinely dominates the tape),
            # the rewrite MAY center the market-wide read on that event (T4) but never
            # as a single-name writeup; when relegated, the lead is at most a one-line
            # example. The lead block (headline/lead_paragraph/supporting_context/
            # what_to_watch) is NEVER read or written here - only the hero.
            _lead_is_dominant = (_final_gate.get("subject") != "market_wide")
            _mp = data.get("market_pulse")

            # MARKET_PULSE_V2 (default OFF): produce market_pulse.narrative from a
            # dedicated tape-first call and OVERWRITE the monolith narrative HERE,
            # BEFORE the existing grounded rewrite + post-check + (later) D13 temporal
            # normalization run. Those all still run on the new narrative. When the
            # flag is OFF this block is skipped entirely and behavior is byte-identical
            # to today (generate_market_pulse is never invoked). Soft-fail: on a miss
            # the monolith narrative is kept and the existing chain runs on it.
            # True only when a validate_pulse_opening-PASSING V2 narrative is wired in;
            # gates skipping the lead-anchoring rewrite downstream.
            _pulse_v2_ok = False
            if MARKET_PULSE_V2 and isinstance(_mp, dict):
                try:
                    _pulse_stories = _pulse_top_stories(spine, floor, _companies_of)
                    _pulse_macro = _pulse_macro_strip()
                    _prior_ctx = _fetch_prior_brief_lead()
                    _v2 = generate_market_pulse(
                        brief_type, tape_obj, _pulse_macro, _pulse_stories, prior_ctx=_prior_ctx
                    )
                    if _v2:
                        # Deterministic subject-check: opening must be the index-level
                        # market read, not a single company/sector, with brief-type
                        # claim scope. ONE bounded re-ask, then the minimal grounded
                        # fallback (never ship a sector-as-market hero).
                        _pc = overview_grounding.validate_pulse_opening(
                            _v2, _final_corpus_companies, brief_type
                        )
                        _pulse_v2_ok = _pc["ok"]
                        if not _pc["ok"]:
                            for _pr in _pc["reasons"]:
                                print(f"  ⚠ MARKET_PULSE_V2 opening violation: {_pr}")
                            _v2r = generate_market_pulse(
                                brief_type, tape_obj, _pulse_macro, _pulse_stories,
                                prior_ctx=_prior_ctx,
                            )
                            _pc2 = (
                                overview_grounding.validate_pulse_opening(
                                    _v2r, _final_corpus_companies, brief_type
                                )
                                if _v2r else {"ok": False}
                            )
                            if _v2r and _pc2["ok"]:
                                _v2 = _v2r
                                _pulse_v2_ok = True
                                print("  [MARKET_PULSE_V2] re-ask resolved opening violation")
                            else:
                                _v2 = overview_grounding.build_minimal_overview(
                                    tape_obj, (_lead_title or data.get("headline") or "")
                                )
                                _pulse_v2_ok = False
                                print("  [MARKET_PULSE_V2] re-ask still violating; using minimal grounded template")
                        _mp["narrative"] = _v2
                        print("  ✨ MARKET_PULSE_V2: dedicated tape-first pulse narrative wired in")
                except Exception as e:
                    print(f"  ⚠ MARKET_PULSE_V2 wire-in skipped (non-fatal): {e}")

            if isinstance(_mp, dict) and isinstance(_mp.get("narrative"), str) and _mp["narrative"].strip():
                # T3 post-check on the CURRENT narrative; rewrite + re-check.
                _best_title = _lead_title or (data.get("headline") or "")
                if MARKET_PULSE_V2 and _pulse_v2_ok:
                    # The V2 tape-first pulse already passed validate_pulse_opening. Do
                    # NOT run the lead-anchoring market-wide rewrite (it clobbers the
                    # tape-first hero back into a single-story/sector read). Ground it
                    # against the pulse's OWN inputs (tape + macro + stories), NOT the
                    # article corpus, so legitimate macro/geography/gov vocabulary is
                    # not false-flagged. ONE bounded re-ask, then the minimal fallback.
                    _candidate = _mp["narrative"]
                    _vres = overview_grounding.validate_pulse_grounding(
                        _candidate, tape_obj, _pulse_macro, _pulse_stories
                    )
                    if not _vres["ok"]:
                        for _r in _vres["reasons"]:
                            print(f"  ⚠ pulse grounding violation (V2): {_r}")
                        _v2re = generate_market_pulse(
                            brief_type, tape_obj, _pulse_macro, _pulse_stories,
                            prior_ctx=_prior_ctx,
                        )
                        _reok = bool(
                            _v2re
                            and overview_grounding.validate_pulse_opening(
                                _v2re, _final_corpus_companies, brief_type)["ok"]
                            and overview_grounding.validate_pulse_grounding(
                                _v2re, tape_obj, _pulse_macro, _pulse_stories)["ok"]
                        )
                        if _reok:
                            _candidate = _v2re
                            print("  [pulse grounding] re-ask resolved violations")
                        else:
                            _candidate = overview_grounding.build_minimal_overview(
                                tape_obj, _best_title
                            )
                            print("  [pulse grounding] re-ask still violating; using minimal grounded template")
                    else:
                        print("  [final-lead gate] V2 tape-first pulse kept (rewrite skipped)")
                else:
                    _new = _rewrite_market_wide_grounded(
                        data, tape_obj, _final_corpus_companies, _best_title, article_text,
                        lead_is_dominant=_lead_is_dominant,
                    )
                    _candidate = _new if _new else _mp["narrative"]
                    _vres = overview_grounding.validate_overview(
                        _candidate, article_text, _final_corpus_companies, tape_obj
                    )
                    if not _vres["ok"]:
                        for _r in _vres["reasons"]:
                            print(f"  ⚠ grounding post-check violation: {_r}")
                        # ONE bounded re-ask naming the violation.
                        _correction = "FIX THESE GROUNDING VIOLATIONS: " + "; ".join(_vres["reasons"])
                        _reasked = _rewrite_market_wide_grounded(
                            data, tape_obj, _final_corpus_companies, _best_title,
                            article_text, extra_correction=_correction,
                            lead_is_dominant=_lead_is_dominant,
                        )
                        if _reasked:
                            _rcheck = overview_grounding.validate_overview(
                                _reasked, article_text, _final_corpus_companies, tape_obj
                            )
                            if _rcheck["ok"]:
                                _candidate = _reasked
                                print("  [grounding post-check] re-ask resolved all violations")
                            else:
                                _candidate = overview_grounding.build_minimal_overview(
                                    tape_obj, _best_title
                                )
                                print("  [grounding post-check] re-ask still violating; using minimal grounded template")
                        else:
                            _candidate = overview_grounding.build_minimal_overview(
                                tape_obj, _best_title
                            )
                            print("  [grounding post-check] re-ask failed; using minimal grounded template")
                    elif _new:
                        print(f"  [final-lead gate] grounded market-wide hero "
                              f"(lead {'centers' if _lead_is_dominant else 'as example'})")
                _mp["narrative"] = _candidate

            # T4 (scoped to FLAG + LOG): body-ticker direction contradictions.
            try:
                _mp2 = data.get("market_pulse")
                _narr = _mp2.get("narrative") if isinstance(_mp2, dict) else None
                if isinstance(_narr, str) and _narr.strip():
                    # SCOPE (decision a, confirmed by Noah): body-ticker
                    # stale-direction is FLAGGED and LOGGED only, not reframed.
                    # Revisit promoting this to a full reframe after observing real
                    # log frequency in production. Full body reframe is deferred.
                    _body_flags = _body_ticker_direction_flags(_narr, _final_corpus_companies)
                    for _bf in _body_flags:
                        print(f"  ⚖ body-ticker direction flag (T4, not reframed): {_bf}")
            except Exception as e:
                print(f"  ⚠ body-ticker direction check skipped (non-fatal): {e}")
        except Exception as e:
            print(f"  ⚠ final-lead gate skipped (non-fatal): {e}")

    # Temporal grounding normalizer (D13, morning + evening, non-fatal). The prompt
    # directive above is not trusted alone: a fresh-published article narrating a
    # prior-session event copies its "today" onto the brief (the Micron case).
    # Deterministically rewrite relative-time tokens in lead_paragraph and
    # market_pulse.narrative so they anchor to the brief date, NOT to the article's
    # publication day. event_date == brief_date keeps "today"; one day prior ->
    # "yesterday"; same week -> weekday; older -> "last week"; UNKNOWN -> strip the
    # relative-time clause. If an in-place rewrite would garble the sentence, fall
    # back to ONE targeted re-ask (prose only). Pure normalizer lives in
    # temporal_grounding.py (the offline-harness target).
    if not brief_is_stub and brief_type in ("morning", "evening"):
        try:
            # Headline anchors to the SAME lead event_date (it names the same
            # primary_story). The evening "Today's Story" card renders headline +
            # lead block, so a stale "today" in the headline must be rewritten too.
            # Same normalizer, same one-shot garble re-ask as the body fields.
            hl_text = data.get("headline")
            if isinstance(hl_text, str) and hl_text.strip():
                new_hl, changed_hl, garbled_hl = temporal_grounding.normalize_relative_time(
                    hl_text, lead_event_date, brief_date_et
                )
                if garbled_hl:
                    reasked_hl = _retemporalize_field(
                        "headline", hl_text, lead_event_date, brief_date_et, data
                    )
                    if reasked_hl:
                        data["headline"] = reasked_hl
                        print("  [temporal guard] re-ask rewrote headline relative time")
                    elif changed_hl:
                        data["headline"] = new_hl
                        print("  [temporal guard] normalized headline (re-ask failed; used inline edit)")
                elif changed_hl:
                    data["headline"] = new_hl
                    print("  [temporal guard] normalized headline relative time")

            lp_text = data.get("lead_paragraph")
            if isinstance(lp_text, str) and lp_text.strip():
                new_lp, changed, garbled = temporal_grounding.normalize_relative_time(
                    lp_text, lead_event_date, brief_date_et
                )
                if garbled:
                    reasked = _retemporalize_field(
                        "lead_paragraph", lp_text, lead_event_date, brief_date_et, data
                    )
                    if reasked:
                        data["lead_paragraph"] = reasked
                        print("  [temporal guard] re-ask rewrote lead_paragraph relative time")
                    elif changed:
                        data["lead_paragraph"] = new_lp
                        print("  [temporal guard] normalized lead_paragraph (re-ask failed; used inline edit)")
                elif changed:
                    data["lead_paragraph"] = new_lp
                    print("  [temporal guard] normalized lead_paragraph relative time")

            mpn = data.get("market_pulse")
            if isinstance(mpn, dict) and isinstance(mpn.get("narrative"), str) and mpn["narrative"].strip():
                new_n, changed_n, garbled_n = temporal_grounding.normalize_relative_time(
                    mpn["narrative"], lead_event_date, brief_date_et
                )
                if garbled_n:
                    reasked_n = _retemporalize_field(
                        "narrative", mpn["narrative"], lead_event_date, brief_date_et, data
                    )
                    if reasked_n:
                        mpn["narrative"] = reasked_n
                        print("  [temporal guard] re-ask rewrote narrative relative time")
                    elif changed_n:
                        mpn["narrative"] = new_n
                        print("  [temporal guard] normalized narrative (re-ask failed; used inline edit)")
                elif changed_n:
                    mpn["narrative"] = new_n
                    print("  [temporal guard] normalized narrative relative time")

            # T4 evening coverage: the evening "Today's Story" card renders
            # supporting_context and what_to_watch alongside lead_paragraph
            # (src/app/evening-wrap/page.tsx leadCards). A stale "today" leaking
            # into those two fields bypassed D13. Normalize them too, inline-only
            # (no re-ask, to avoid extra model calls on secondary lead fields). On
            # a garble the inline edit is skipped, leaving the original untouched.
            for _fld in ("supporting_context", "what_to_watch"):
                _txt = data.get(_fld)
                if isinstance(_txt, str) and _txt.strip():
                    _new, _chg, _garb = temporal_grounding.normalize_relative_time(
                        _txt, lead_event_date, brief_date_et
                    )
                    if _chg and not _garb:
                        data[_fld] = _new
                        print(f"  [temporal guard] normalized {_fld} relative time")
        except Exception as e:
            print(f"  ⚠ temporal guard error (non-fatal): {e}")

    # Lead-thesis opener guard (morning + evening, non-fatal). The narrative's
    # opening sentence is the most visible line in the product and reliably
    # regresses to a mood / index recap. Detect it and do ONE targeted re-ask
    # that rewrites the narrative only, leading with a named driver; keep the
    # original and log if the re-ask still recaps or fails. See helper block.
    if not brief_is_stub:
        try:
            mp = data.get("market_pulse")
            if isinstance(mp, dict) and isinstance(mp.get("narrative"), str) and mp["narrative"].strip():
                fs = _opener_first_sentence(mp["narrative"])
                recap, why = _is_opener_recap(fs)
                if recap:
                    new_narr = _regenerate_opener(data, tape_regime, brief_type)
                    if new_narr and not _is_opener_recap(_opener_first_sentence(new_narr))[0]:
                        mp["narrative"] = new_narr
                        print("  [opener guard] re-ask replaced a recap opener with a named-driver lead")
                    elif new_narr:
                        print(f"  ⚠ opener guard: re-ask still recap ({why}); keeping original opener")
                    else:
                        print(f"  ⚠ opener guard: re-ask failed ({why}); keeping original opener")
                # D9 overview-redundancy guard: run AFTER the opener guard so the
                # opener is already named-driver-led, then push for net-new drivers
                # vs headline/lead. ONE re-ask; keep original if it stays redundant.
                if isinstance(mp.get("narrative"), str) and mp["narrative"].strip():
                    if _narrative_is_redundant(
                        data.get("headline", ""), data.get("lead_paragraph", ""), mp["narrative"]
                    ):
                        new_n = _regenerate_narrative_net_new(data, tape_regime, brief_type)
                        if new_n and not _narrative_is_redundant(
                            data.get("headline", ""), data.get("lead_paragraph", ""), new_n
                        ):
                            mp["narrative"] = new_n
                            print("  [redundancy guard] rewrote narrative to add net-new drivers")
                        elif new_n:
                            print("  ⚠ redundancy guard: re-ask still restates lead; keeping original")
                        else:
                            print("  ⚠ redundancy guard: re-ask failed; keeping original narrative")
        except Exception as e:
            print(f"  ⚠ opener guard error (non-fatal): {e}")

    # Voice compliance guard (morning + evening, non-fatal). Port of the Company
    # Intel guard (PR #389): market_pulse.narrative is the highest-distribution
    # surface and can drift to institutional first person or reader-directed
    # recommendations. Deterministic detect -> one bounded re-ask -> fail-closed
    # fallback that is provably recommendation-free (first person may remain).
    # Only the narrative string is touched; never blocks the response.
    if not brief_is_stub:
        try:
            vp = data.get("market_pulse")
            if isinstance(vp, dict) and isinstance(vp.get("narrative"), str) and vp["narrative"].strip():
                if has_voice_violation(vp["narrative"]):
                    def _voice_regenerate(correction):
                        sysmsg = (
                            "You rewrite ONE field of a finished market brief for compliance. "
                            "Return JSON only: {\"narrative\": \"<rewritten narrative, same paragraph "
                            "count, paragraphs separated by \\n\\n>\"}. No other keys, no prose "
                            "outside the JSON. Zero em-dashes."
                        )
                        usermsg = (
                            "Rewrite this market_pulse.narrative to comply, changing ONLY the wording "
                            "needed. Keep every fact and the paragraph count.\n\n"
                            f"{correction}\n\nNARRATIVE:\n{vp['narrative']}"
                        )
                        try:
                            raw = gemini_generate(
                                system=sysmsg, user_content=usermsg, temperature=0.2, max_tokens=1024
                            )
                            parsed = _parse_brief_json(raw)
                            if parsed and isinstance(parsed.get("narrative"), str) and parsed["narrative"].strip():
                                return parsed["narrative"].strip()
                        except Exception as e:
                            print(f"  ⚠ voice guard: re-ask failed (non-fatal): {e}")
                        return None

                    vres = enforce_brief_voice(vp["narrative"], _voice_regenerate, max_reasks=1)
                    if vres.memo != vp["narrative"]:
                        vp["narrative"] = vres.memo
                        print("  [voice guard] rewrote narrative for impersonal/informational-only compliance")
                    if vres.still_violating:
                        print("  ⚠ voice guard: residual first person after fallback (recommendations removed)")
        except Exception as e:
            print(f"  ⚠ voice guard error (non-fatal): {e}")

    # Prose quality guard (D15, morning + evening, non-fatal). The voice guard
    # above covers first-person / recommendations, not grammar. The brief shipped
    # "stock surge ... underscores" (a noun phrase wired into a verb slot).
    # Deterministically detect a tight set of garbled constructions in
    # lead_paragraph + market_pulse.narrative; on a hit run ONE targeted re-ask
    # that fixes only the grammar. This is not a general grammar engine; the
    # detector lives in prose_quality_guard.py (pure, unit-testable).
    if not brief_is_stub and brief_type in ("morning", "evening"):
        try:
            def _prose_regenerate(field_label, text, reasons):
                sysmsg = (
                    "You fix the grammar of ONE field of a finished market brief. "
                    "Return JSON only: {\"text\": \"<rewritten text, same paragraph "
                    "count, paragraphs separated by \\n\\n>\"}. No other keys, no "
                    "prose outside the JSON. Zero em-dashes; use hyphens, colons, parens."
                )
                usermsg = (
                    prose_quality_guard.build_prose_correction(reasons)
                    + f"\n{field_label.upper()}:\n{text}"
                )
                try:
                    raw = gemini_generate(
                        system=sysmsg, user_content=usermsg, temperature=0.2, max_tokens=1024
                    )
                    parsed = _parse_brief_json(raw)
                    if parsed and isinstance(parsed.get("text"), str) and parsed["text"].strip():
                        return parsed["text"].strip()
                except Exception as e:
                    print(f"  ⚠ prose guard: re-ask failed (non-fatal): {e}")
                return None

            lp_text = data.get("lead_paragraph")
            if isinstance(lp_text, str) and lp_text.strip():
                lp_reasons = prose_quality_guard.detect_garbled_prose(lp_text)
                if lp_reasons:
                    fixed = _prose_regenerate("lead_paragraph", lp_text, lp_reasons)
                    if fixed and not prose_quality_guard.has_garbled_prose(fixed):
                        data["lead_paragraph"] = fixed
                        print("  [prose guard] rewrote garbled lead_paragraph")
                    else:
                        print(f"  ⚠ prose guard: lead_paragraph still garbled or re-ask failed "
                              f"({len(lp_reasons)} issue(s)); keeping original")

            mpp = data.get("market_pulse")
            if isinstance(mpp, dict) and isinstance(mpp.get("narrative"), str) and mpp["narrative"].strip():
                n_reasons = prose_quality_guard.detect_garbled_prose(mpp["narrative"])
                if n_reasons:
                    fixed_n = _prose_regenerate("narrative", mpp["narrative"], n_reasons)
                    if fixed_n and not prose_quality_guard.has_garbled_prose(fixed_n):
                        mpp["narrative"] = fixed_n
                        print("  [prose guard] rewrote garbled narrative")
                    else:
                        print(f"  ⚠ prose guard: narrative still garbled or re-ask failed "
                              f"({len(n_reasons)} issue(s)); keeping original")
        except Exception as e:
            print(f"  ⚠ prose guard error (non-fatal): {e}")

    # Section entity validation (D8, morning + evening, non-fatal). Every org
    # named in a section must appear in the section's source corpus or the
    # resolved-company roster; a clear hallucination (org absent from the corpus
    # entirely) triggers ONE re-ask of just the flagged sections. Unsupported
    # orgs are always logged. Never blocks the response.
    if not brief_is_stub:
        try:
            _allowed_companies = []
            for a in (spine + floor):
                _allowed_companies.extend(_companies_of(a))
            _sections = data.get("sections")
            flagged = _unsupported_orgs_in_sections(_sections, article_text, _allowed_companies)
            if flagged:
                print(f"  ⚠ entity guard: unsupported orgs by section: {flagged}")
                fixed = _regenerate_sections_entity_safe(
                    _sections, flagged, article_text, _allowed_companies
                )
                if isinstance(fixed, dict):
                    merged = dict(_sections)
                    for k, v in fixed.items():
                        if k in merged and isinstance(v, str) and v.strip():
                            merged[k] = v
                    still = _unsupported_orgs_in_sections(merged, article_text, _allowed_companies)
                    data["sections"] = merged
                    if still:
                        print(f"  ⚠ entity guard: residual unsupported orgs after re-ask: {still}")
                    else:
                        print("  [entity guard] re-ask resolved all unsupported orgs")
                else:
                    print("  ⚠ entity guard: re-ask failed; keeping original sections (orgs logged)")
        except Exception as e:
            print(f"  ⚠ entity guard error (non-fatal): {e}")

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

    # Stamp the market-closed state onto market_pulse (no migration; rides the
    # existing market_pulse JSON the hero already reads) so the render can show a
    # closed-day note instead of a present-tense "Today the market is ..." hero.
    # The prompt directive that asks the model to state the closure is best-effort,
    # so we ALSO deterministically prepend a closure note to the narrative when the
    # model did not mention it: the closure is then guaranteed in the brief text.
    if market_closed and isinstance(data.get("market_pulse"), dict):
        mp = data["market_pulse"]
        mp["market_closed"] = True
        mp["holiday_name"] = holiday_name
        mp["last_trading_session"] = last_trading_session
        narr = mp.get("narrative")
        if isinstance(narr, str) and not any(
            w in narr.lower() for w in ("closed", "holiday", "juneteenth", "no trading", "not trading")
        ):
            _label = holiday_name or "a market holiday"
            mp["narrative"] = (
                f"US equity markets are closed today for {_label}; the market figures "
                f"here reflect the prior session close ({last_trading_session})."
                + "\n\n" + narr
            )

    # Materiality shadow: record the REAL served lead (the final headline) and
    # recompute divergence against it, not against the pre-generation pick. This is
    # the metric that answers "would materiality have led differently than what
    # actually shipped." Shadow-only: nothing here changes the served brief.
    if _materiality_shadow_title:
        try:
            import lead_preselect as _lp_ship
            _shipped_lead = str(data.get("headline") or "")[:200]
            _lp_ship._LAST_DECISION_LOG.update({
                "shipped_lead": _shipped_lead,
                "materiality_diverged_from_shipped":
                    _materiality_shadow_title[:80].lower() != _shipped_lead[:80].lower(),
            })
        except Exception as _se:
            print(f"  ⚠ shipped-lead capture skipped (non-fatal): {_se}")

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
    # Narrative is the gate. sentiment_word may legitimately be None when the
    # evening tape was unavailable (the clients render a no-verdict hero);
    # dropping the whole pulse block would silently lose the narrative too.
    has_pulse = isinstance(mp_raw, dict) and mp_raw.get("narrative")

    extras: dict = {}
    if has_pulse:
        extras["market_pulse"] = json.dumps(mp_raw)
    if has_structured_body:
        extras["lead_paragraph"] = lead_paragraph
        extras["supporting_context"] = supporting_context
        extras["what_to_watch"] = what_to_watch_body
    psid = (data.get("primary_story_id") or "").strip()
    if psid:
        extras["primary_story_id"] = psid[:200]

    # Persist the gen-time tape snapshot (v2 Gate 1 prerequisite). The new
    # market_tape column is nullable and may not exist until the migration is
    # applied, so it is the OUTERMOST insert attempt: if the column is missing the
    # insert ladder falls back to the extras row (market_pulse / body are NOT
    # lost) and then to the base row. We serialize the already-computed tape_obj;
    # no recompute, no re-fetch. None when no tape (weekend / thin) -> not written.
    _tape_snapshot = market_tape.serialize_tape_snapshot(tape_obj, as_of=now)

    insert_resp = None
    if extras:
        row_with_extras = {**row, **extras}
        # Ordered insert candidates: with-tape (best), extras-only (existing
        # behavior, preserves market_pulse if the tape column is absent), base.
        # market_tape is a JSONB column, so pass the native dict (NOT json.dumps):
        # a json-string would be stored as a jsonb string scalar and `->`/`->>`
        # could not key into it. The dict is stored as a queryable jsonb object.
        _candidates = []
        if _tape_snapshot is not None:
            _candidates.append({**row_with_extras, "market_tape": _tape_snapshot})
        _candidates.append(row_with_extras)
        _candidates.append(row)
        _last_err = None
        for _cand in _candidates:
            try:
                insert_resp = supabase.table("briefings").insert(_cand).execute()
                if "market_tape" in _cand:
                    print(f"  ✨ market_tape saved: regime={_tape_snapshot.get('regime')} vix={_tape_snapshot.get('vix_level')}")
                if has_pulse and "market_pulse" in _cand:
                    print(f"  ✨ market_pulse saved: {(mp_raw.get('sentiment_word') or '(no word)')[:30]}")
                if has_structured_body and "lead_paragraph" in _cand:
                    print(f"  ✨ structured body saved (lead/context/watch)")
                _last_err = None
                break
            except Exception as ext_err:
                _last_err = ext_err
                print(f"  ⚠ insert attempt failed ({ext_err}) - trying a smaller row")
        if insert_resp is None and _last_err is not None:
            raise _last_err
    elif _tape_snapshot is not None:
        try:
            insert_resp = supabase.table("briefings").insert(
                {**row, "market_tape": _tape_snapshot}
            ).execute()
        except Exception as ext_err:
            print(f"  ⚠ market_tape insert failed ({ext_err}) - falling back to base row")
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

    # (The former post-generation SHADOW comparison block is removed: impact_ranking
    # is now the live lead path above, with lead_source telemetry recorded there.)

    # ── Record output for universal feedback table ──
    try:
        record_output(
            supabase,
            output_type='brief',
            content={
                'briefing_type': brief_type,
                'headline': data.get('headline', ''),
                'summary_excerpt': (data.get('summary') or '')[:500],
                'market_tone': data.get('market_tone'),
                'briefing_id': str(brief_id) if brief_id else None,
            },
            generation_context={
                'model': GEMINI_MODEL,
                'prompt_version': BRIEF_PROMPT_VERSION,
                'spine_count': len(spine),
                'floor_count': len(floor),
            },
            source_table='briefings',
            source_id=brief_id,
        )
    except Exception as e:
        print(f"  ⚠ outputs record_output(brief) failed (non-fatal): {e}")

    # ── Record one brief_section output per non-empty section ──
    # Sections are LLM-generated narrative buckets (deals_and_ma, public_markets, etc.).
    # Each gets a stable section_key AND a per-render UUID for addressability in outputs.
    try:
        sections_dict = data.get("sections", {}) or {}
        if isinstance(sections_dict, dict) and sections_dict and brief_id:
            section_rows = []
            for section_key, section_text in sections_dict.items():
                if not section_text or not isinstance(section_text, str):
                    continue
                section_rows.append({
                    'output_type': 'brief_section',
                    'content': {
                        'section_key': section_key,
                        'section_render_id': str(uuid.uuid4()),
                        'briefing_id': str(brief_id),
                        'briefing_type': brief_type,
                        'section_text_excerpt': section_text[:500],
                        'section_text_length': len(section_text),
                    },
                    'generation_context': {
                        'model': GEMINI_MODEL,
                        'prompt_version': BRIEF_PROMPT_VERSION,
                        'briefing_id': str(brief_id),
                        'briefing_type': brief_type,
                    },
                    'source_table': 'briefings',
                    'source_id': brief_id,
                })
            if section_rows:
                record_outputs_batch(supabase, section_rows)
                print(f"  📝 Recorded {len(section_rows)} brief_section outputs for briefing {brief_id}")
    except Exception as e:
        print(f"  ⚠ brief_section recording failed (non-fatal): {e}")

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

    # ── Morning brief: attach the deterministic macro panel (slice 1: numbers) ──
    # Numbers come straight from the BLS + BEA data layers and NEVER pass through
    # Gemini. Written as its OWN brief_id update (not the shared extras insert) so a
    # missing macro_panel column (migration not yet applied) degrades ONLY this field
    # and never regresses market_pulse via the base-row fallback. Fully soft-fail:
    # empty data layers skip the write; a schema/undefined-column error is caught and
    # logged. The pipeline never breaks from this code, and it is safe to ship before
    # the migration is applied.
    if brief_type == "morning" and brief_id:
        try:
            releases = [
                asdict(r)
                for r in (macro_calendar.fetch_macro_releases() + bea_calendar.fetch_bea_releases())
            ]
            if releases:
                periods = {r["key"]: r["period"] for r in releases}
                # Detection: compare against the PREVIOUS morning brief's periods,
                # i.e. the row BEFORE this run. The current run's row already exists
                # (brief_id was inserted earlier), so exclude it with neq("id",
                # brief_id) and take the most recent remaining morning row. Cold
                # start (no prior row) fires nothing.
                previous_periods = {}
                prev_resp = (
                    supabase.table("briefings")
                    .select("macro_panel")
                    .eq("briefing_type", "morning")
                    .neq("id", brief_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                if prev_resp.data:
                    prev_mp = prev_resp.data[0].get("macro_panel") or {}
                    if isinstance(prev_mp, dict):
                        previous_periods = prev_mp.get("periods") or {}
                fired_today = detect_fired_releases(previous_periods, periods)
                macro_panel = {
                    "releases": releases,
                    "periods": periods,
                    "fired_today": fired_today,
                }
                # Gated read: only on a release day. The tape block above is
                # evening-only, so fetch the morning tape here (soft-fail), then
                # generate ONE prose read grounded on the fired prints + tape.
                # Prose only: panel numbers always come from `releases`, never the
                # model. A read or tape failure leaves the panel intact, no read.
                if fired_today:
                    tape = None
                    try:
                        tape = market_tape.fetch_tape()
                    except Exception as te:
                        print(f"  ⚠ macro read: morning tape fetch failed (non-fatal): {te}")
                    read_text = _generate_macro_read(fired_today, releases, tape)
                    if read_text:
                        macro_panel["read"] = read_text
                supabase.table("briefings").update(
                    {"macro_panel": macro_panel}
                ).eq("id", brief_id).execute()
                print(
                    f"  📊 Attached macro_panel ({len(releases)} releases, "
                    f"fired={fired_today}) to morning brief {brief_id}"
                )
            else:
                print("  ⚠ macro_panel skipped: data layers returned no releases")
        except Exception as e:
            print(f"[synthesize] macro_panel attach failed (non-fatal): {e}")

    # --- Attach scheduled catalysts to the render strip (both modes, soft-fail).
    # Rides inside the existing macro_panel JSONB column: briefing/route.ts uses
    # select("*") and spreads ...raw, so this reaches the frontend with no new
    # column and no migration. Merges into any macro_panel written above so the
    # morning releases are preserved.
    if brief_id and not brief_is_stub and catalyst_list:
        try:
            import event_calendar
            _cat_payload = event_calendar.to_render_payload(catalyst_list, _cat_asof)
            existing = {}
            try:
                _r = (
                    supabase.table("briefings").select("macro_panel")
                    .eq("id", brief_id).limit(1).execute()
                )
                if _r.data and isinstance(_r.data[0].get("macro_panel"), dict):
                    existing = _r.data[0]["macro_panel"]
            except Exception:
                existing = {}
            merged = {**existing, "catalysts": _cat_payload}
            supabase.table("briefings").update(
                {"macro_panel": merged}
            ).eq("id", brief_id).execute()
            print(f"  🗓 Attached {len(_cat_payload)} catalyst(s) to {brief_type} brief {brief_id}")
        except Exception as e:
            print(f"[synthesize] catalyst attach failed (non-fatal): {e}")

    # Return brief text and addendum metadata for downstream consumers
    # (e.g. brief_feedback_loop.score_brief in run.py)
    brief_text = json.dumps(data, indent=2)
    return {
        "brief_text": brief_text,
        "brief_addendum_used": brief_addendum_used,
        "stub": brief_is_stub,
    }

if __name__ == "__main__":
    import sys
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"
    run(brief_type)
