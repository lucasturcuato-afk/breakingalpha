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
try:
    from call_horizons import resolve_on_for
except Exception:  # pragma: no cover - path differs between runner and tests
    from backend.call_horizons import resolve_on_for
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
from models import GEMINI_MODEL

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

# UNIFIED_LEAD: when on, the lead is ONE deterministic argmax over the unified
# candidate set (macro / impact clusters AND the qualified Filter A/A2 deal, which
# is already a scored cluster) on the named-weight rubric in impact_ranking
# (compute_unified_lead: materiality / session_fit / confirmation / breadth). When
# off (DEFAULT), the lead path is BYTE-IDENTICAL to today's `impact_pick or deal_pick`
# precedence. This is orthogonal to MATERIALITY_RANK_MODE and does NOT flip it.
# Read exactly like MATERIALITY_RANK_MODE so the surfaces stay symmetric.
UNIFIED_LEAD = os.environ.get("UNIFIED_LEAD", "off").strip().lower()
if UNIFIED_LEAD not in ("off", "on"):
    print(f"  [unified-lead] unknown UNIFIED_LEAD={UNIFIED_LEAD!r}, "
          "falling back to 'off' (prod-neutral default)")
    UNIFIED_LEAD = "off"

# MARKET_PULSE_V2: when true, market_pulse.narrative is produced by a dedicated
# tape-first Gemini call (generate_market_pulse) that overwrites the monolith's
# narrative BEFORE the existing grounding post-check + D13 temporal normalization
# run. DEFAULT OFF: when off, generate_market_pulse is never invoked and behavior
# is byte-identical to today.
MARKET_PULSE_V2 = os.environ.get("MARKET_PULSE_V2", "").strip().lower() in ("1", "true", "yes", "on")

# LEAD_V2: when true, the Today's Lead block (lead_paragraph + supporting_context,
# and the headline when its figure guard leaves it in scope) is produced by a
# dedicated focused Gemini call (generate_lead_v2) that OVERWRITES the monolith's
# lead fields AFTER parse, mirroring the MARKET_PULSE_V2 generate-then-overwrite
# pattern. The dedicated call carries the pulse's proven rules: REAL WHY (the
# driver is an external force, never the move restating itself), MACRO RECENCY
# (a release that dropped TODAY IS the catalyst, stated with its value, never
# "await"), FIGURE FIDELITY (figures only if in the inputs), and observational /
# compliant framing (no advice). DEFAULT OFF: when off, generate_lead_v2 is never
# invoked and behavior is byte-identical to today.
LEAD_V2 = os.environ.get("LEAD_V2", "").strip().lower() in ("1", "true", "yes", "on")

# Move 1 personalization: additive, shared, zero-Gemini persist of the selected
# story set onto the briefing row (three-state, mirrors MATERIALITY_RANK_MODE):
#   off    -> story_items is neither built nor written. Prod-neutral: the served
#             brief is byte-identical to before. This is the DEFAULT.
#   shadow -> story_items is built from the already-selected spine/floor and
#             persisted on the row. Nothing reads it yet; it is accrual only.
#   active -> same persist as shadow (the read-side re-rank consumes it in a
#             later, separate change). Persist behavior is identical to shadow.
# The persist reads only in-memory data synthesize already computed; it never
# re-queries the corpus, never changes prose / lead / selection, and fails open
# (any error -> story_items simply not written, brief unaffected).
PERSONALIZATION_MODE = os.environ.get("PERSONALIZATION_MODE", "off").strip().lower()
if PERSONALIZATION_MODE not in ("off", "shadow", "active"):
    print(f"  [personalization] unknown PERSONALIZATION_MODE={PERSONALIZATION_MODE!r}, "
          "falling back to 'off' (prod-neutral default)")
    PERSONALIZATION_MODE = "off"

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
    "deals_and_ma": "2-3 sentences on PATTERNS across multiple deals: consolidation pace, buyer archetypes, valuation compression, sector concentration. Do NOT re-narrate the primary_story here; cite it only as one data point among several. If the only transaction in the corpus is the primary_story, OMIT this section entirely rather than restate the lead.",
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
    "deals_and_ma": "2-3 sentences on PATTERNS across multiple deals: consolidation pace, buyer archetypes, valuation compression, sector concentration. Do NOT re-narrate the primary_story here; cite it only as one data point among several. If the only transaction in the corpus is the primary_story, OMIT this section entirely. ROUTING: any named acquisition, merger, stake purchase, LBO, or IPO belongs HERE (or in top_deals), even when the target sits in a foreign country; a cross-border M&A transaction is a DEAL, never geopolitics.",
    "public_markets": "2-3 sentences on how markets closed. Name the key movers and state what the tape is pricing in for tomorrow — not just that stocks went up or down. OMIT if no specific market close data or named movers in the articles.",
    "macro_and_rates": "2-3 sentences on macro and rates. State the concrete implication for deal multiples, credit spreads, or risk appetite into tomorrow. OMIT if no concrete rates or macro signal in the articles. ROUTING (strict): this section is ONLY for rates, Fed or central-bank action, inflation prints (CPI/PPI/PCE), jobs or payrolls, GDP, FX, and credit spreads. A court ruling, lawsuit, verdict, damages award, regulatory fine, or any single-company legal or corporate event is NOT macro; do NOT place it here. Route corporate legal or regulatory items to public_markets or deals_and_ma, or omit them.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. Geopolitics means cross-border CONFLICT, war, sanctions, trade or tariff policy, energy-supply disruption, or state-level action, NOT a company buying a foreign asset (that is deals_and_ma). OMIT THIS KEY ENTIRELY if nothing geopolitical materially affected markets today; do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
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


def _resolve_tickers_for_names(names):
    """Best-effort name -> ticker map via one batched companies SELECT.

    Move 1 read-side personalization matches a user's watchlist_tickers against
    each story's entities. Articles carry entity NAMES only, so resolve them to
    tickers ONCE here at generation time and persist the tickers, killing the
    read-time matching sub-build. Zero Gemini.

    Fails open: any error, or an unresolvable name, yields no ticker for that
    name. It NEVER raises and NEVER blocks the persist or the brief.
    """
    out = {}
    clean = sorted({(n or "").strip() for n in names if isinstance(n, str) and n.strip()})
    if not clean:
        return out
    try:
        resp = (
            supabase.table("companies")
            .select("name, ticker")
            .in_("name", clean)
            .execute()
        )
        for r in resp.data or []:
            nm = (r.get("name") or "").strip()
            tk = (r.get("ticker") or "").strip()
            if nm and tk:
                out[nm] = tk
    except Exception as e:
        print(f"  [personalization] ticker resolve failed (continuing, no tickers): {e}")
        return {}
    return out


def _build_story_items(spine, floor):
    """Assemble the additive story_items payload from the ALREADY-SELECTED set.

    Reads only in-memory article dicts produced by _select_articles_for_synthesis.
    Does not re-query the corpus, re-rank, or alter selection. Returns a list of
    dicts (native jsonb) or None if there is nothing to persist. Fails open: any
    error yields None and the brief is unaffected.
    """
    try:
        def _companies(a):
            c = a.get("companies") or []
            if isinstance(c, str):
                try:
                    c = json.loads(c)
                except Exception:
                    c = []
            return [x for x in c if isinstance(x, str) and x.strip()]

        rows = []
        # bucket records where the story sat in the selection (spine = primary
        # editorial depth, floor = per-sector breadth); the LLM's section
        # assignment is not known at selection time, so bucket is the honest key.
        for bucket, arts in (("spine", spine or []), ("floor", floor or [])):
            for a in arts:
                rows.append({"_a": a, "bucket": bucket, "companies": _companies(a)})

        if not rows:
            return None

        all_names = {n for r in rows for n in r["companies"]}
        ticker_map = _resolve_tickers_for_names(all_names)

        items = []
        for r in rows:
            a = r["_a"]
            companies = r["companies"]
            tickers = sorted({ticker_map[n] for n in companies if n in ticker_map})
            items.append({
                "url":                a.get("url"),
                "bucket":             r["bucket"],
                "relevance_score":    a.get("relevance_score"),
                "sector":             a.get("sector"),
                "industry_verticals": a.get("industry_verticals") or [],
                "companies":          companies,
                "primary_company":    companies[0] if companies else None,
                "tickers":            tickers,
            })
        return items or None
    except Exception as e:
        print(f"  [personalization] story_items build failed (continuing, not persisted): {e}")
        return None


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


# ── Evening section routing / cross-section dedup (deterministic post-check) ──
# Sections are LLM-assigned via the EVENING_SYSTEM schema; there is no other
# router. Two failure modes were observed on the 2026-07-17 evening wrap and
# nowhere else in the trailing 10 wraps, so this stays a minimal backstop, not a
# re-architecture:
#   1. A non-macro subject (a court ruling on mutual-fund damages) routed into
#      macro_and_rates, which must be rates / Fed / inflation / jobs / FX only.
#   2. The same story (ConocoPhillips buying 42% of BP's Kirkuk business, a
#      corporate M&A stake) both HEADLINED geopolitics AND reappeared in
#      public_markets, a cross-section duplicate, and a misroute (a foreign
#      M&A transaction is a deal, not geopolitics).
# Both are handled deterministically here so a prompt regression cannot re-ship
# them. Pure: no network, no Gemini. Returns (cleaned_sections, notes).

# Tokens that legitimately make a sentence "macro & rates". Word-boundary matched.
_MACRO_TOKENS = (
    "rate", "rates", "fed", "federal reserve", "fomc", "cpi", "ppi", "pce",
    "inflation", "deflation", "yield", "yields", "treasury", "treasuries",
    "basis point", "basis points", "bps", "jobs", "payroll", "payrolls",
    "unemployment", "nonfarm", "fx", "currency", "dollar index", "spread",
    "spreads", "monetary", "central bank", "ecb", "boj", "boe", "rate cut",
    "rate hike", "gdp", "jobless", "wholesale", "wage", "wages",
)

# Subjects that are NEVER macro & rates on their own: a court ruling, a lawsuit,
# a verdict, a damages award. If macro_and_rates is dominated by one of these and
# carries no macro token, it is a misroute.
_LEGAL_RULING_TOKENS = (
    "court", "lawsuit", "verdict", "damages", "ruling", "litigation",
    "tribunal", "plaintiff", "defendant", "class action", "jury", "judge",
    "superior court", "appeal", "appeals",
)


def _has_token(text_lc: str, tokens) -> bool:
    """True if any token appears on word boundaries in the lower-cased text."""
    for t in tokens:
        if re.search(r"\b" + re.escape(t) + r"\b", text_lc):
            return True
    return False


def _dominant_anchor(text: str) -> str | None:
    """Extract the dominant proper-noun anchor of a section blob: the first
    multi-word Capitalized run (a company / institution name). Used to detect the
    same story headlining two sections. Deliberately simple and conservative:
    it only fires on a clear shared proper-noun anchor, never on common words."""
    if not isinstance(text, str) or not text.strip():
        return None
    # Grab Capitalized-word runs of length >= 1, drop the leading sentence word
    # only when it is a bare single common opener. We keep multi-token runs.
    runs = re.findall(r"\b([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+)*)", text)
    for r in runs:
        toks = r.split()
        # A distinctive anchor is a multi-token proper name, or a single long
        # non-generic proper noun (e.g. "ConocoPhillips").
        if len(toks) >= 2:
            return r
        if len(toks) == 1 and len(r) > 6 and r not in ("Strategic", "Meanwhile", "Separately", "Growth"):
            return r
    return None


def _evening_section_routing_fixup(sections):
    """Deterministic evening section post-check. Returns (cleaned, notes).

    Fix 1 (misroute): drop macro_and_rates when it is a legal / court ruling with
    no macro token; that content is not macro and belongs nowhere in the rates
    lane. Dropping is safe: an omitted section is the schema's own no-signal path.

    Fix 2 (cross-section dedup + geopolitics misroute): if the SAME dominant
    proper-noun anchor headlines geopolitics AND also appears in another section,
    the story anchors the MORE SPECIFIC section and is removed from geopolitics.
    Specificity order (most → least): deals_and_ma, public_markets, macro_and_rates,
    geopolitics. A corporate M&A stake sitting in geopolitics is the classic
    misroute; when its anchor also appears in public_markets/deals it is dropped
    from geopolitics so it headlines exactly one section."""
    if not isinstance(sections, dict):
        return sections, []
    cleaned = dict(sections)
    notes = []

    # Fix 1: macro_and_rates must be genuinely macro.
    macro = cleaned.get("macro_and_rates")
    if isinstance(macro, str) and macro.strip():
        macro_lc = macro.lower()
        if not _has_token(macro_lc, _MACRO_TOKENS) and _has_token(macro_lc, _LEGAL_RULING_TOKENS):
            del cleaned["macro_and_rates"]
            notes.append(
                "dropped macro_and_rates (legal/court ruling with no macro token, misroute)"
            )

    # Fix 2: cross-section dedup, anchored on geopolitics (the observed misroute
    # target). Specificity: a story that also lives in a more specific section is
    # removed from geopolitics.
    more_specific = ("deals_and_ma", "public_markets", "macro_and_rates")
    geo = cleaned.get("geopolitics")
    if isinstance(geo, str) and geo.strip():
        anchor = _dominant_anchor(geo)
        if anchor:
            anchor_lc = anchor.lower()
            for other in more_specific:
                other_txt = cleaned.get(other)
                if (
                    isinstance(other_txt, str)
                    and other_txt.strip()
                    and other != "geopolitics"
                    and re.search(r"\b" + re.escape(anchor_lc) + r"\b", other_txt.lower())
                ):
                    del cleaned["geopolitics"]
                    notes.append(
                        f"dropped geopolitics (anchor {anchor!r} already headlines "
                        f"more-specific section {other!r}, cross-section duplicate/misroute)"
                    )
                    break

    return cleaned, notes


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

For every claim also classify HOW LONG the claim needs to play out. Judge the claim's own language, not your preference. Be honest: forcing a multi-week thesis into a single session grades it on noise, and calling a same-day move a multi-week view delays a verdict everyone already knows.
- "session"   the claim is about today's trading. Reactions to an overnight headline, an earnings print, a data release, a Fed tone. Words like today, this session, at the open, on the print.
- "week"      the claim needs a few sessions to resolve. A move that builds over the week, a trend continuing, positioning unwinding.
- "multiweek" the claim is a thesis, not a trade. A re-rating, a cycle turning, a structural shift, guidance playing out over a quarter.
When genuinely ambiguous, choose "session". Do not choose a longer horizon to make a claim look more serious.

Respond ONLY with valid JSON in this exact schema, no preamble, no markdown fences:
{
  "claims": [
    {
      "claim_text": "<short sentence stating the directional call>",
      "claim_type": "aggregate" | "sector" | "index" | "ticker",
      "target_symbol": "<ticker or ETF symbol; null only for pure aggregate with no proxy>",
      "expected_direction": "bullish" | "bearish" | "neutral",
      "horizon_type": "session" | "week" | "multiweek",
      "confidence": <float between 0.0 and 1.0>
    }
  ]
}
"""


def _lead_match_index(claim_texts: list[str], shipped_lead: str) -> int | None:
    """Contract C2 join: pick the ONE claim that corresponds to the SHIPPED lead so
    the brief's lead is joinable to its later grade. Deterministic token-overlap:
    the claim whose text shares the most content words with the shipped lead
    headline wins, gated by a minimum overlap so a weak match marks nothing. Pure;
    returns the winning index or None. At most one claim is ever flagged."""
    if not shipped_lead or not claim_texts:
        return None
    _stop = {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "as", "at",
        "by", "is", "are", "will", "with", "from", "its", "it", "be", "amid",
        "after", "over", "into", "this", "that", "day", "today", "us", "vs",
    }

    def _toks(s: str) -> set:
        return {w for w in re.findall(r"[a-z0-9$]+", (s or "").lower())
                if w not in _stop and len(w) > 1}

    lead_tok = _toks(shipped_lead)
    if not lead_tok:
        return None
    best_i, best_overlap = None, 0
    for i, ct in enumerate(claim_texts):
        ov = len(_toks(ct) & lead_tok)
        if ov > best_overlap:
            best_i, best_overlap = i, ov
    # Require at least 2 shared content words so an incidental single-word overlap
    # (e.g. "market") does not falsely tag a non-lead claim.
    return best_i if best_overlap >= 2 else None


def extract_and_persist_claims(
    brief_id: str,
    brief_headline: str,
    brief_summary: str,
    brief_sections: dict,
    shipped_lead_title: str | None = None,
) -> int:
    """
    Extract gradeable market calls from a morning brief and persist them to
    `morning_brief_calls`. Idempotent: deletes any existing rows for this
    brief_id before inserting so re-runs produce a clean set.

    Contract C2: when `shipped_lead_title` is given, the ONE claim that matches the
    SHIPPED lead (deterministic token overlap, see `_lead_match_index`) is written
    with is_lead=true; every other claim is is_lead=false. This makes a brief's lead
    joinable to its later grade. Defaults to the brief headline when no explicit lead
    title is supplied.

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

    # Single anchor for both brief_date and resolve_on on every row in this run.
    _claims_brief_date = date.today().isoformat()

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
            # brief_date is written explicitly rather than left to the column
            # default (CURRENT_DATE) so it and resolve_on derive from the SAME
            # anchor. A one-day drift between the DB clock and the runner clock
            # would otherwise make a "session" call resolve the following day.
            "brief_date": _claims_brief_date,
            "claim_text": claim_text,
            "claim_type": claim_type,
            "target_symbol": target_symbol,
            "expected_direction": direction,
            # Fixed map (backend/call_horizons.py): session +0, week +7,
            # multiweek +21 calendar days. Missing or unrecognized falls back
            # to session, i.e. exactly today's behavior.
            "resolve_on": resolve_on_for(_claims_brief_date, c.get("horizon_type")),
            "confidence": confidence,
            "is_lead": False,
        })

    if not rows:
        print("  ⚠ claims extraction: no valid claims after normalization")
        return 0

    # Contract C2: mark the ONE claim that matches the shipped lead as is_lead=true.
    # Join against the shipped lead title (falls back to the brief headline). At most
    # one row is flagged; a weak overlap flags nothing (see _lead_match_index).
    _lead_ref = (shipped_lead_title or brief_headline or "").strip()
    _lead_idx = _lead_match_index([r["claim_text"] for r in rows], _lead_ref)
    if _lead_idx is not None:
        rows[_lead_idx]["is_lead"] = True
        print(f"  🎯 claims extraction: is_lead=true on claim "
              f"{_lead_idx + 1}/{len(rows)}: {rows[_lead_idx]['claim_text'][:70]!r}")
    else:
        print("  ℹ claims extraction: no claim matched the shipped lead (is_lead all false)")

    # Idempotency: clear any prior rows for this brief_id before inserting.
    try:
        supabase_admin.table("morning_brief_calls").delete().eq("brief_id", brief_id).execute()
    except Exception as e:
        print(f"  ⚠ claims extraction: idempotent delete failed (continuing): {e}")

    # Insert with the full row first. is_lead ships behind migration 0013 and
    # resolve_on behind 0014; either may be unapplied on a given DB, so fall
    # back to the columns that definitely exist (never lose the claims) rather
    # than failing the whole insert. A call inserted without resolve_on simply
    # stays out of the due-scan, which is the correct fail-closed behavior.
    _OPTIONAL_COLS = ("is_lead", "resolve_on")
    try:
        supabase_admin.table("morning_brief_calls").insert(rows).execute()
    except Exception as e:
        print(f"  ⚠ claims extraction: full insert failed ({e}); retrying without "
              f"{'/'.join(_OPTIONAL_COLS)} (migration 0013/0014 may be unapplied)")
        try:
            _rows_base = [
                {k: v for k, v in r.items() if k not in _OPTIONAL_COLS} for r in rows
            ]
            supabase_admin.table("morning_brief_calls").insert(_rows_base).execute()
        except Exception as e2:
            print(f"  ⚠ claims extraction: insert failed: {e2}")
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


def _et_session_date(dt_utc):
    """Map a UTC datetime to its ET trading-session calendar date (identity of the
    session a brief belongs to). An evening brief generated at ~02:xx UTC belongs
    to the PRIOR ET calendar day, so the raw UTC date is wrong for session
    matching; ET is the exchange's day. Pure; falls back to the UTC date if the
    tz database is unavailable so it can never raise."""
    if dt_utc is None:
        return None
    try:
        from zoneinfo import ZoneInfo
        if dt_utc.tzinfo is None:
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
        return dt_utc.astimezone(ZoneInfo("America/New_York")).date()
    except Exception:
        try:
            return dt_utc.date()
        except Exception:
            return None


def _parse_iso_utc(s):
    """Parse an ISO8601 timestamp (with or without trailing Z / offset) to an
    aware UTC datetime. Returns None on anything unparseable. Pure, never raises."""
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _fetch_prior_session_tape(current_session_date):
    """Read the persisted market_tape snapshot from the most recent briefing whose
    ET trading-session date is DISTINCT from the current run's session date, so the
    direct freeze detector compares against a genuinely PRIOR session (Friday for a
    Monday brief, not Sunday, and not "yesterday" blindly). A morning brief and the
    evening brief of the same session share a session date and must NOT be compared
    against each other (they are the same session; identical levels are expected).

    Selection: the session date is derived from the snapshot's own `as_of` when
    present (it equals the row's created_at), else from created_at. The first row
    (most recent by created_at) whose session date differs from
    `current_session_date` wins. Returns the market_tape dict or None.

    Read-only, soft-fail to None: the first brief, a missing column, or any query
    error means no prior tape and therefore no detection - which is fine, a freeze
    can only be detected against a prior session. Never raises."""
    if current_session_date is None:
        return None
    try:
        resp = (
            supabase.table("briefings")
            .select("created_at, market_tape")
            .not_.is_("market_tape", "null")
            .order("created_at", desc=True)
            .limit(8)
            .execute()
        )
    except Exception as e:
        print(f"  ⚠ prior-session tape lookup failed (non-fatal): {e}")
        return None
    for row in (resp.data or []):
        snap = row.get("market_tape")
        if not isinstance(snap, dict):
            continue
        as_of = _parse_iso_utc(snap.get("as_of")) or _parse_iso_utc(row.get("created_at"))
        sess = _et_session_date(as_of)
        if sess is None or sess == current_session_date:
            continue
        print(f"  🧊 Prior-session tape for freeze check: session={sess} (current={current_session_date})")
        return snap
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
            # enrich=True so rates / oil / sector-ETF facts reach BOTH the pulse
            # prose and the persisted snapshot on the fallback path (this fetch
            # runs only when MATERIALITY_RANK_MODE=off; the shadow/active path
            # hoists an enrich=True fetch upstream). Merged #463 prose is dead
            # without an enriched tape reaching this caller.
            #
            # FREEZE DETECTOR WIRING (#467): same prior-distinct-session read as the
            # materiality path, so the fallback brief is also freeze-checked. Flag,
            # never fail; first-brief / no-prior returns None -> no detection.
            _prior_tape = _fetch_prior_session_tape(
                _et_session_date(datetime.now(timezone.utc))
            )
            tape = market_tape.fetch_tape(enrich=True, prior_session_tape=_prior_tape)
            _fs = (tape or {}).get("frozen_suspect") or []
            if _fs:
                print(f"  🧊🚨 FROZEN-SUSPECT indices {_fs}: fetched level is identical to "
                      f"the prior session's persisted level to the penny - the index panel may "
                      f"be echoing a stale close. Carried on tape['frozen_suspect'] and persisted "
                      f"on the snapshot; brief NOT blocked (data alarm only).")
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


# ── L3: preselect-time lead ticker + anchor-name capture (TICKERSCOPE) ──────────
# Additive telemetry persisted on preselect_decision. Deterministic, no external
# API: HARD_TICKER_OVERRIDES first (pure), else a SINGLE exact case-insensitive
# companies-table match with a non-null non-empty ticker, else None. Distinct from
# _resolve_lead_ticker on purpose: that one network-falls-back to Finnhub, which we
# must NOT do here. NULL-safe; any exception returns None so the brief still ships.

def _resolve_preselect_ticker(company_name):
    """Resolve a lead anchor name to a ticker for telemetry, WITHOUT any external
    API. Rule: HARD_TICKER_OVERRIDES exact lowercased-name hit -> else a single
    exact case-insensitive companies-table row with a non-null non-empty ticker ->
    else None. Never raises."""
    name = (company_name or "").strip()
    if not name:
        return None
    # (1) Deterministic override table (pure, no network).
    try:
        from finnhub_helper import HARD_TICKER_OVERRIDES
        ov = HARD_TICKER_OVERRIDES.get(name.lower())
        if ov:
            return ov
    except Exception:
        pass
    # (2) Single exact case-insensitive companies-table match with a real ticker.
    #     .ilike with no wildcard is an exact, case-insensitive equality. We require
    #     EXACTLY one matching row so an ambiguous name resolves to None.
    try:
        resp = (supabase.table("companies")
                .select("name, ticker")
                .ilike("name", name)
                .limit(2)
                .execute())
        rows = resp.data or []
        if len(rows) == 1:
            tk = (rows[0].get("ticker") or "").strip()
            if tk:
                return tk
    except Exception:
        pass
    return None


def _preselect_anchor_name(preselected):
    """The anchor company name for the shipped lead, per deal type: acquirer for
    M&A (fall back to the company when acquirer is null); the company for
    offering/earnings; else parse from the co:<name> cluster key, else the lead
    article's companies[0]. Returns None when nothing resolves. Never raises."""
    if not preselected:
        return None
    try:
        reason = str(preselected.get("_preselect_reason") or "")
        deal_type = str(preselected.get("_preselect_deal_type") or "").strip().lower()
        acquirer = (preselected.get("_preselect_acquirer") or "").strip()

        # M&A: acquirer anchors the deal; fall back to the named company.
        if "m&a" in deal_type or deal_type in ("lbo", "takeover", "merger"):
            if acquirer:
                return acquirer

        # co:<name>:<sub> cluster fallback -> parse the company name from the key.
        # _impact_cluster looks like "co:micron:stock" / "co:planet fitness:ma".
        cluster = str(preselected.get("_impact_cluster") or "")
        if cluster.startswith("co:"):
            parts = cluster.split(":", 2)
            if len(parts) >= 2 and parts[1].strip():
                return parts[1].strip()

        # Company from the lead article's companies list (offering / earnings / etc.).
        cos = preselected.get("companies") or []
        if isinstance(cos, str):
            try:
                cos = json.loads(cos)
            except Exception:
                cos = [cos]
        cos = [str(c).strip() for c in (cos or []) if str(c).strip()]
        if cos:
            return cos[0]

        # Last resort for a deal pick with only an acquirer.
        if acquirer:
            return acquirer
    except Exception:
        return None
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


# Additive tape fields the dedicated pulse consumes when Agent A exposes them
# (rates / oil / sector leaders + laggards / breadth). These are OPTIONAL: they
# may be absent from the tape entirely (parallel work not landed, or a thin
# session). Every accessor degrades SILENTLY to nothing when its field is
# missing. NOTHING here is invented: a field renders ONLY when a real value is
# present. Read-side stable: unknown key shapes are tolerated (dict-or-scalar).
def _tape_has_breadth_field(tape):
    """True ONLY when the tape carries a REAL breadth field (advancers/decliners,
    advance-decline, or an explicit breadth value). Used by the deterministic
    breadth-claim guard: a narrative may assert breadth ONLY when this is True.
    Absent field -> False -> any breadth assertion is a violation. Pure."""
    if not isinstance(tape, dict):
        return False
    for k in ("breadth", "advancers", "decliners", "advance_decline",
              "adv_dec", "advance_decline_ratio"):
        v = tape.get(k)
        if v is None:
            continue
        # A dict breadth blob counts only if it holds at least one non-null value.
        if isinstance(v, dict):
            if any(sv is not None for sv in v.values()):
                return True
        else:
            return True
    return False


def _fmt_signed_pct(pct):
    try:
        return f"{float(pct):+.2f}%"
    except (TypeError, ValueError):
        return None


def _enrichment_view(tape):
    """KEY ALIGNMENT (#461 <-> #463): market_tape.fetch_enrichment emits the
    additive fields NESTED under tape['enrichment'] with its OWN key names
    (rates.teny_level / teny_bps_change, oil.wti_level / wti_pct,
    sector_leadership.leaders / laggards, breadth / breadth_available). The
    tolerant accessors below were written against a flat, differently-named shape
    that #461 never emitted, so without this shim the enrichment silently never
    renders. This flattens #461's actual emitted keys into the flat aliases the
    accessors expect, WITHOUT dropping the tolerant fallbacks. Pure; a tape with
    no 'enrichment' block passes through unchanged (older/flat shapes still work).
    """
    if not isinstance(tape, dict):
        return tape
    enr = tape.get("enrichment")
    if not isinstance(enr, dict):
        return tape
    view = dict(tape)
    rates = enr.get("rates") if isinstance(enr.get("rates"), dict) else {}
    # Flat aliases the rates accessor already scans for.
    if rates.get("teny_level") is not None:
        view["us10y_level"] = rates.get("teny_level")
    if rates.get("teny_bps_change") is not None:
        view["us10y_bps"] = rates.get("teny_bps_change")
    oil = enr.get("oil") if isinstance(enr.get("oil"), dict) else {}
    if oil.get("wti_level") is not None or oil.get("wti_pct") is not None:
        # The oil accessor reads a {level, pct} dict under key 'wti' / 'oil'.
        view["wti"] = {"level": oil.get("wti_level"), "pct": oil.get("wti_pct")}
    sl = enr.get("sector_leadership") if isinstance(enr.get("sector_leadership"), dict) else {}
    if sl.get("leaders"):
        view["sector_leaders"] = sl.get("leaders")
    if sl.get("laggards"):
        view["sector_laggards"] = sl.get("laggards")
    # Breadth: #461 emits breadth=None / breadth_available=False (never sourced),
    # so the flat 'breadth' key stays falsy and the breadth guard remains correct.
    if enr.get("breadth") is not None:
        view["breadth"] = enr.get("breadth")
    return view


def _pulse_extra_tape_block(tape):
    """MARKET_PULSE_V2: render the ADDITIVE tape fields the pulse should spend space
    on when they exist: 10Y level + bps move, oil, sector leaders/laggards, and a
    REAL breadth field. Returns '' when none are present (the pulse then simply
    omits them; it must never invent a field). Every value is passed through only
    when actually present. Pure; tolerant of dict-or-scalar field shapes."""
    if not isinstance(tape, dict):
        return ""
    tape = _enrichment_view(tape)
    lines = []

    # Rates: 10Y level + bps move. Accept a few shapes A might expose.
    rates = tape.get("rates") if isinstance(tape.get("rates"), dict) else tape
    ten_level = None
    for k in ("us10y_level", "ten_year_level", "10y_level", "tnx_level", "us10y", "ten_year"):
        v = rates.get(k) if isinstance(rates, dict) else None
        if v is not None:
            ten_level = v
            break
    ten_bps = None
    for k in ("us10y_bps", "ten_year_bps", "10y_bps", "tnx_bps", "us10y_change_bps"):
        v = rates.get(k) if isinstance(rates, dict) else None
        if v is not None:
            ten_bps = v
            break
    if ten_level is not None:
        try:
            bit = f"10Y Treasury {float(ten_level):.2f}%"
            if ten_bps is not None:
                bit += f" ({float(ten_bps):+.0f} bps on the session)"
            lines.append(bit)
        except (TypeError, ValueError):
            pass

    # Oil: WTI or Brent, level and optional pct.
    for okey, olabel in (("wti", "WTI crude"), ("oil", "crude"), ("brent", "Brent crude")):
        ov = tape.get(okey)
        if ov is None:
            continue
        try:
            if isinstance(ov, dict):
                lvl = ov.get("level") if ov.get("level") is not None else ov.get("price")
                pct = _fmt_signed_pct(ov.get("pct"))
                if lvl is None and pct is None:
                    continue
                bit = f"{olabel}"
                if lvl is not None:
                    bit += f" ${float(lvl):.2f}"
                if pct is not None:
                    bit += f" ({pct})"
                lines.append(bit)
            else:
                lines.append(f"{olabel} ${float(ov):.2f}")
            break
        except (TypeError, ValueError):
            continue

    # Sector leadership: leaders + laggards. Accept list-of-dict or list-of-str.
    def _sector_bits(val):
        out = []
        for s in (val or [])[:3]:
            if isinstance(s, dict):
                name = (s.get("name") or s.get("sector") or s.get("label") or "").strip()
                pct = _fmt_signed_pct(s.get("pct"))
                if name:
                    out.append(f"{name} {pct}" if pct else name)
            else:
                nm = str(s or "").strip()
                if nm:
                    out.append(nm)
        return out

    leaders = _sector_bits(tape.get("sector_leaders") or tape.get("leaders"))
    laggards = _sector_bits(tape.get("sector_laggards") or tape.get("laggards"))
    # ATTRIBUTION (#461): these are sector-ETF DAY MOVES (a leadership PROXY), NOT
    # constituent breadth. An XLK gain can ride ONE megacap. The label makes the
    # source explicit so the prose attributes to the ETF ('tech ETFs led') and
    # never asserts sector-wide breadth. The prompt rule + guard enforce this.
    if leaders:
        lines.append("Sector-ETF leaders (ETF day move, a leadership proxy NOT breadth): " + ", ".join(leaders))
    if laggards:
        lines.append("Sector-ETF laggards (ETF day move, a leadership proxy NOT breadth): " + ", ".join(laggards))

    # Breadth: only when a REAL field is present (guarded above).
    if _tape_has_breadth_field(tape):
        b = tape.get("breadth")
        if isinstance(b, dict):
            adv = b.get("advancers")
            dec = b.get("decliners")
            if adv is not None and dec is not None:
                lines.append(f"Breadth: {adv} advancers vs {dec} decliners")
            elif b.get("summary"):
                lines.append(f"Breadth: {str(b.get('summary')).strip()}")
        elif isinstance(b, str) and b.strip():
            lines.append(f"Breadth: {b.strip()}")
        else:
            adv = tape.get("advancers")
            dec = tape.get("decliners")
            if adv is not None and dec is not None:
                lines.append(f"Breadth: {adv} advancers vs {dec} decliners")

    return "\n".join(lines)


def _narrative_carries_enrichment(narrative, tape, today_catalyst=None):
    """Observability (decision-log `enrichment_in_shipped`): True when the SHIPPED
    narrative actually surfaces the tape's #461 enrichment (rates 10Y / oil-WTI /
    a named sector-ETF mover) or the day's released macro catalyst. Deterministic,
    text-level, and pure: it inspects the shipped STRING, not the intent, so a
    rising fallback rate that silently drops enrichment stays visible on the DB.
    Conservative: it looks for concrete markers the enrichment renderers emit
    (a bps/yield/WTI/crude token, a 10Y level, or a sector-ETF leader/laggard name
    present on the tape). Returns False on a bare index-only recap."""
    if not isinstance(narrative, str) or not narrative.strip():
        return False
    low = narrative.lower()
    # Rates markers.
    if any(m in low for m in ("10-year", "10y", "treasury yield", " bps", "basis point")):
        return True
    # Oil markers.
    if any(m in low for m in ("wti", "crude", "brent")):
        return True
    # Sector-ETF leader/laggard names actually present on the tape.
    t = _enrichment_view(tape) if isinstance(tape, dict) else {}
    for key in ("sector_leaders", "sector_laggards", "leaders", "laggards"):
        for s in (t.get(key) or []):
            nm = ""
            if isinstance(s, dict):
                nm = (s.get("sector") or s.get("name") or s.get("label") or "").strip()
            else:
                nm = str(s or "").strip()
            if nm and nm.lower() in low:
                return True
    # Released macro catalyst by name.
    if isinstance(today_catalyst, dict):
        nm = (today_catalyst.get("name") or "").strip()
        if nm and nm.lower() in low:
            return True
    return False


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


# Typical BLS/BEA publication timing per release, used to ESTIMATE a release date
# from the data period (the sources carry no publication date). Employment prints
# on the first Friday of the following month; CPI/PPI mid-following-month; PCE/GDP
# late-following-month. Good enough for a today / recent / dated gradient.
_MACRO_RELEASE_DAY = {
    "nonfarm_payrolls": "first_friday", "unemployment": "first_friday",
    "cpi": 12, "core_cpi": 12, "ppi": 13, "pce": 27, "gdp": 28,
}
_MACRO_MONTHS = {m.lower(): i for i, m in enumerate(
    ["", "January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}


def _macro_period_month(period):
    """Parse a release period into (year, data-period-END month). Handles monthly
    ('June 2026') and quarterly ('Q2 2026'). None if unparseable."""
    toks = (period or "").strip().split()
    if not toks:
        return None
    try:
        year = int(toks[-1])
    except ValueError:
        return None
    head = toks[0].lower()
    if head.startswith("q") and len(head) >= 2 and head[1].isdigit():
        q = int(head[1])
        return (year, q * 3) if 1 <= q <= 4 else None
    mo = _MACRO_MONTHS.get(head)
    return (year, mo) if mo else None


def _macro_release_recency(key, period, today):
    """Age a release against the brief date using the AUTHORITATIVE published
    release date from the event_calendar BLS/BEA schedule tables (single source of
    truth), NOT the old 12th-of-month estimator. When the key has an authoritative
    table entry, the returned date is EXACT (is_estimate False), so release-day
    detection is precise: a print whose authoritative date == today tags RELEASED
    TODAY. When no authoritative date exists (PPI, GDP, or a reference month not yet
    in the table) we fall back to the schedule estimator so the strip still shows a
    dated/backdrop tag, but flagged is_estimate True and NEVER treated as today's
    catalyst. Returns (release_date, days_old, is_estimate) or None."""
    try:
        import event_calendar
        auth = event_calendar.authoritative_release_date(key, period)
    except Exception:
        auth = None
    if auth is not None:
        return auth, (today - auth).days, False
    # Fallback: schedule estimator (dated/backdrop only, never release-day).
    parsed = _macro_period_month(period)
    if not parsed:
        return None
    py, pm = parsed
    rm, ry = (pm + 1, py) if pm < 12 else (1, py + 1)
    rule = _MACRO_RELEASE_DAY.get(key, 15)
    if rule == "first_friday":
        d = date(ry, rm, 1)
        while d.weekday() != 4:  # Friday
            d += timedelta(days=1)
    else:
        d = date(ry, rm, int(rule))
    return d, (today - d).days, True


def _pulse_macro_strip():
    """MARKET_PULSE_V2: build a compact macro backdrop strip for the dedicated pulse
    call. Reuses the SAME data-layer fetchers the morning macro_panel uses
    (macro_calendar + bea_calendar) and renders only the numbers actually present.
    Each line is TAGGED with its release recency (RELEASED TODAY / recent backdrop /
    dated), sourced from the AUTHORITATIVE event_calendar BLS/BEA release dates (not
    a 12th-of-month estimate), so the pulse can frame catalyst-vs-backdrop precisely.
    When a print's authoritative release date is today, a leading TODAY'S CATALYST
    callout naming its value is prepended so the number is unmissable in the prompt.
    Returns (strip_text, is_release_day). Soft-fail to ('', False). Not exercised by
    the offline harness (it hits the data layers)."""
    try:
        releases = macro_calendar.fetch_macro_releases() + bea_calendar.fetch_bea_releases()
    except Exception as e:
        print(f"  ⚠ pulse macro strip fetch failed (non-fatal): {e}")
        return "", False
    today = datetime.now(timezone.utc).date()
    lines = []
    catalyst_lines = []
    release_today = False
    for r in releases or []:
        try:
            name = getattr(r, "name", "") or ""
            period = getattr(r, "period", "") or ""
            key = getattr(r, "key", "") or ""
            figs = []
            for f in (getattr(r, "figures", None) or [])[:2]:
                # Shared basis-labeled formatter: every macro percentage carries
                # its m/m|y/y|q/q basis so the strip never reads as an unlabeled
                # number that contradicts the lead. "-0.4% m/m", "+3.5% y/y".
                bit = macro_calendar.format_figure(f)
                if not bit:
                    continue
                prior = getattr(f, "prior", None)
                unit = getattr(f, "unit", "") or ""
                if prior is not None:
                    bit += f" (prior {macro_calendar._fmt(prior, unit)})"
                figs.append(bit)
            if not (name and figs):
                continue
            rec = _macro_release_recency(key, period, today)
            if rec is not None:
                rel_date, age, is_est = rec
                # Release-day is TRUE only on an AUTHORITATIVE date == today. The
                # estimator (is_est) can be a day or two off, so it never triggers
                # today's-catalyst framing; it only dates the backdrop.
                approx = "~" if is_est else ""
                if age == 0 and not is_est:
                    tag = f"RELEASED TODAY ({rel_date.isoformat()}), the day's catalyst"
                    release_today = True
                    catalyst_lines.append(
                        f"TODAY'S CATALYST - {name} ({period}) RELEASED TODAY "
                        f"({rel_date.isoformat()}): " + "; ".join(figs)
                    )
                elif age < 0 or age <= 10:
                    when = f"{age} days ago" if age > 0 else "just released"
                    tag = f"released {approx}{rel_date.isoformat()}, {when}: recent BACKDROP, NOT today's news"
                else:
                    tag = f"released {approx}{rel_date.isoformat()}, {age} days ago: DATED, context only"
            else:
                tag = "release date unknown: treat as backdrop"
            lines.append(f"{name} ({period}; {tag}): " + "; ".join(figs))
        except Exception:
            continue
    # Lead the strip with any release-day catalyst callout so the day's print (and
    # its VALUE) is the first thing the model sees, not buried mid-list.
    return "\n".join(catalyst_lines + lines), release_today


def _macro_figure_yoy_mom(figures):
    """Pull the headline y/y and m/m figure VALUES (with units) out of a release's
    figure list by label. Returns (y_o_y, m_o_m) as {'value','unit','prior'} dicts
    or None each. Pure; tolerant of missing figures."""
    y_o_y = None
    m_o_m = None
    for f in figures or []:
        label = (getattr(f, "label", "") or "").lower()
        val = getattr(f, "value", None)
        if val is None:
            continue
        entry = {
            "value": val,
            "unit": getattr(f, "unit", "") or "",
            "prior": getattr(f, "prior", None),
        }
        if "y/y" in label and y_o_y is None:
            y_o_y = entry
        elif "m/m" in label and m_o_m is None:
            m_o_m = entry
    return y_o_y, m_o_m


def released_macro_context():
    """Canonical released-macro accessor for synthesis (pulse + lead + fallback).
    Returns {"releases": [ {name, period, value, unit, prior, release_date (ISO),
             is_release_day (bool), y_o_y, m_o_m} ... ],
             "today_catalyst": <the release-day print dict or None>,
             "strip": "<human strip text with recency tags>"}.
    is_release_day is TRUE only when release_date == today's ET date, sourced from
    the AUTHORITATIVE event_calendar dates, not the hardcoded 12th-of-month
    estimator. Fetched FACTS only; empty/None when nothing released. Never raises."""
    empty = {"releases": [], "today_catalyst": None, "strip": "", "is_release_day": False}
    try:
        strip, _strip_release_today = _pulse_macro_strip()
    except Exception:
        strip = ""
        _strip_release_today = False
    try:
        import event_calendar
        releases = macro_calendar.fetch_macro_releases() + bea_calendar.fetch_bea_releases()
    except Exception as e:
        print(f"  ⚠ released_macro_context fetch failed (non-fatal): {e}")
        return {"releases": [], "today_catalyst": None, "strip": strip, "is_release_day": False}
    today = datetime.now(timezone.utc).date()
    out = []
    today_catalyst = None
    for r in releases or []:
        try:
            name = getattr(r, "name", "") or ""
            period = getattr(r, "period", "") or ""
            key = getattr(r, "key", "") or ""
            figures = getattr(r, "figures", None) or []
            if not name:
                continue
            y_o_y, m_o_m = _macro_figure_yoy_mom(figures)
            # Headline value: prefer y/y (the framed number), else the first figure.
            headline = y_o_y or m_o_m
            if headline is None:
                for f in figures:
                    if getattr(f, "value", None) is not None:
                        headline = {
                            "value": getattr(f, "value", None),
                            "unit": getattr(f, "unit", "") or "",
                            "prior": getattr(f, "prior", None),
                        }
                        break
            if headline is None:
                continue
            auth = event_calendar.authoritative_release_date(key, period)
            release_date = auth.isoformat() if auth is not None else None
            is_release_day = bool(auth is not None and auth == today)
            entry = {
                "name": name,
                "period": period,
                "key": key,
                "value": headline.get("value"),
                "unit": headline.get("unit"),
                "prior": headline.get("prior"),
                "release_date": release_date,
                "is_release_day": is_release_day,
                "y_o_y": y_o_y,
                "m_o_m": m_o_m,
            }
            out.append(entry)
            if is_release_day and today_catalyst is None:
                today_catalyst = entry
        except Exception:
            continue
    # ONE authoritative release-day flag for the WHOLE brief. Both consumers (the
    # market pulse and the LEAD_V2 lead) read THIS single scalar, so they cannot
    # disagree on whether a macro print is fresh-today vs backdrop. It is TRUE only
    # when a release with an authoritative date == today's ET date exists
    # (today_catalyst set). The strip's own release-day derivation (_pulse_macro_strip)
    # is folded in with OR only as a defensive belt-and-braces; if the two ever
    # diverge we log it so the transit-drop is visible, then trust the strict
    # authoritative catalyst (an estimate-only strip tag must NEVER promote to fresh).
    is_release_day_flag = today_catalyst is not None
    if bool(_strip_release_today) != is_release_day_flag:
        print(
            "  ⚠ release-day flag divergence: strip="
            f"{bool(_strip_release_today)} vs catalyst={is_release_day_flag}; "
            "using authoritative catalyst flag"
        )
    if not out:
        return {"releases": [], "today_catalyst": None, "strip": strip, "is_release_day": False}
    return {
        "releases": out,
        "today_catalyst": today_catalyst,
        "strip": strip,
        "is_release_day": is_release_day_flag,
    }


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


def generate_market_pulse(brief_type, tape, macro, top_stories, prior_ctx=None,
                          macro_is_release_day=False):
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
    extra_tape = _pulse_extra_tape_block(tape)
    has_breadth = _tape_has_breadth_field(tape)
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
    if macro_is_release_day:
        macro_framing = (
            "MACRO FRAMING: a major economic release dropped TODAY (tagged 'RELEASED "
            "TODAY' in the strip). It IS the day's catalyst - lead paragraph 1 with it "
            "and the market's reaction to it, tied to the tape."
        )
    else:
        macro_framing = (
            "MACRO FRAMING (NO release today, be COMPACT): NO major economic release "
            "dropped today. State that plainly as a CLAUSE in sentence one (the honest "
            "why: 'with no fresh catalyst on the tape'), then MOVE ON. Do NOT recite the "
            "standing macro figures: the backdrop earns at most a single short clause "
            "('last week's soft-landing jobs read still underpins sentiment'), NEVER a "
            "roll-call of prints (payrolls, unemployment, CPI, PCE). Those figures moved "
            "nobody today; naming four of them buries the real story. Never say investors "
            "are digesting, reacting to, or awaiting a dated print today. On a no-catalyst "
            "day the SECTOR read and rates/oil ARE the story - spend the space there."
        )
    extra_block = (
        f"ADDITIONAL TAPE (rates / oil / sector leadership / breadth - fetched facts, "
        f"do not invent):\n{extra_tape}\n\n"
    ) if extra_tape.strip() else ""
    if has_breadth:
        breadth_rule = (
            "- BREADTH: a REAL breadth field is present in ADDITIONAL TAPE above. You "
            "MAY describe breadth, but ONLY as the field states it (advancers vs "
            "decliners / the given breadth read). Do not overstate it.\n"
        )
    else:
        breadth_rule = (
            "- BREADTH IS FORBIDDEN: NO breadth field is present in the inputs. You have "
            "NO advance/decline data. Therefore you must NEVER assert market breadth in "
            "any form - not 'resilient breadth', not 'broad participation', not "
            "'broad-based', not 'narrow breadth'. If the index spread is informative, "
            "describe ONLY what is observable: large-cap gains vs small-cap lag, and call "
            "a megacap-led, small-cap-lagging tape NARROW LEADERSHIP (never 'resilient'). "
            "NEVER resolve an ambiguous spread toward reassurance. A red Russell against "
            "green megacaps is narrow leadership and small-cap underperformance, full "
            "stop - it is NOT evidence of resilient breadth.\n"
        )

    system = (
        "You write ONE field of a daily market brief: market_pulse.narrative, the "
        "hero read of the whole market. Return JSON only: {\"narrative\": \"<3-4 "
        "short paragraphs (fewer on a thin tape), separated by \\n\\n>\"}. No other "
        "keys, no prose outside the JSON. Zero em-dashes; use hyphens, colons, parens.\n\n"
        "You are ONE sharp markets analyst explaining the day to a smart person who "
        "is NOT in the market every day (the Buffett 'sisters' test). Write like a "
        "wire wrap (AP / Bloomberg markets desk), not an AI summary: plain words, "
        "short sentences, concrete named forces. Every sentence carries a fact or a "
        "named force; if a sentence does neither, cut it. State the read and what it "
        "turns on; never narrate who is 'watching' or 'awaiting'."
    )
    user = (
        "Write the Market Pulse. The SUBJECT is the MARKET (index-level equities + "
        "the macro backdrop), NOT any single company or sector.\n\n"
        f"{claim_scope}\n\n"
        f"{facts}\n\n"
        f"MACRO BACKDROP (fetched facts, do not invent; each print tagged with its "
        f"release recency):\n{macro_block}\n\n"
        f"{extra_block}"
        f"{macro_framing}\n\n"
        f"RANKED STORIES (COLOR ONLY - examples woven in AFTER the market read, never "
        f"the subject):\n{stories_block}\n\n"
        + (f"PRIOR SESSION CONTEXT: {prior_block}\n\n" if prior_block else "")
        + "RULES (absolute):\n"
        "- LEVER 1 - LEAD WITH THE WHY IN SENTENCE ONE: the first sentence pairs the "
        "market move WITH its driver AND the indices, together. Model it on the wire "
        "standard: 'US stocks rose as pressure on tech eased, with the Nasdaq up 1.1% "
        "and the S&P 500 up 0.4%.' That is direction + why + indices in ONE sentence. "
        "FORBIDDEN: stating the move and letting its cause arrive two or more sentences "
        "later. The SUBJECT stays the market (index-level equities), never a single "
        "company or single sector.\n"
        "- REAL WHY, NOT TAUTOLOGY: the driver in sentence one must be something OTHER "
        "than the price action itself - a named catalyst, a sector move, a rates / oil / "
        "breadth / credit force. If NO real external driver is present in the inputs, say "
        "so honestly ('drifted higher in quiet trading with no dominant catalyst; last "
        "week's soft-landing jobs read still underpins sentiment'). BANNED as causes "
        "because they merely restate the move: 'as risk-on sentiment drove "
        "participation', 'on positive momentum', 'amid investor optimism', 'as buyers "
        "stepped in'. Do NOT manufacture a driver; an honest no-catalyst line beats a "
        "fake why.\n"
        "- MACRO BASIS IS MANDATORY: any macro percentage you cite (CPI, PPI, PCE, "
        "GDP) MUST state its BASIS - m/m (month-over-month) or y/y (year-over-year). "
        "The strip labels every figure; carry that label through. A bare 'CPI 3.5%' or "
        "'inflation fell 0.4%' is FORBIDDEN - it is ambiguous and can read as "
        "contradicting the other basis. Cite the figure exactly as the strip states "
        "it: '-0.4% m/m', '+3.5% y/y'.\n"
        "- LEVER 2 - NAME THE FORCE, KILL THE HEDGE: name the concrete force doing the "
        "work (the catalyst, the macro print, yields, breadth, the sector leading or "
        "lagging). BANNED filler, never write these: 'could signal a shift in how "
        "investors assess ...', 'underscores the broader trend', 'highlights how ...', "
        "'reflecting a ... mood', 'suggesting continued ...', 'amid ongoing ...'. If a "
        "sentence names no concrete force or fact, delete it.\n"
        "- LEVER 3 - READ THE INTERNALS (from the index spread, NOT breadth): when the "
        "index spread is informative, interpret it in ONE clause grounded in the tape "
        "numbers above: small-caps (Russell) out front = small-caps leading; megacaps "
        "(Nasdaq/S&P) green with a RED or flat Russell = NARROW leadership carried by "
        "large caps while small-caps lag; Dow lagging = cyclicals/value soft. Say what "
        "the spread MEANS; do not just list three numbers. The index spread is NOT a "
        "breadth reading - do not translate it into any breadth claim.\n"
        + breadth_rule +
        "- LEVER 3b - SECTOR LEADERSHIP IS THE STORY ON A QUIET DAY: when ADDITIONAL "
        "TAPE gives sector leaders/laggards, make the sector read a real beat, not an "
        "afterthought: name who led and who lagged and, in one clause, what that "
        "rotation means. On a no-catalyst day this sector read carries the pulse. When "
        "rates (10Y level + bps) or oil are present, work them in as concrete forces "
        "(duration, energy). Omit any of these silently if its field is absent - never "
        "invent a level or a mover.\n"
        "- LEVER 3c - SECTOR IS AN ETF-MOVE PROXY, NEVER SECTOR-WIDE BREADTH: the "
        "sector figures are SECTOR-ETF DAY MOVES, a leadership PROXY. An ETF gain can "
        "ride one megacap, so you have NO evidence the whole sector participated. "
        "ATTRIBUTE ONCE, THEN SPEAK NATURALLY: name the ETF proxy a SINGLE time to "
        "carry the attribution, then read the rotation in plain words - do NOT tag "
        "every sector with 'ETFs' (that reads like a data field narrated aloud). "
        "PREFERRED shape: 'Energy ETFs led (+0.45%) while health care lagged (-1.14%)' "
        "- one 'ETFs', the rest of the coordinated clause is honest because the ETF "
        "attribution governs it. Also fine: 'the technology ETF (XLK) outperformed', "
        "'sector ETFs point to tech leadership'. FORBIDDEN (a real breadth claim the "
        "proxy cannot support, banned even alongside an 'ETFs' mention): any sentence "
        "asserting the sector's CONSTITUENTS moved as a group - never 'energy stocks "
        "broadly rallied', 'tech names broadly rose', 'broad tech strength', "
        "'financials rallied across the board', 'sector-wide participation'. The tell "
        "is a breadth word ('broadly', 'stocks', 'names', 'across the board', "
        "'sector-wide', 'participation'): if it is present you have made a breadth "
        "claim. Keep the read to the ETF's day move; never upgrade a proxy into "
        "breadth.\n"
        "- LEVER 4 - VOICE: plain, short, one analyst. No jargon for sport, no throat-"
        "clearing, no AI hedging. Shape: 3-4 short paragraphs - (1) tape + why (with the "
        "no-catalyst clause when there is none), (2) internals + rates/oil + SECTOR "
        "leadership, (3) the day's corporate stories RANKED (see LEVER 5), (4) a brief "
        "FORWARD LOOK. Tight; do not pad.\n"
        "- LEVER 5 - RANK THE CORPORATE STORIES, DO NOT LIST THEM: the stories paragraph "
        "is EDITED, not a laundry list. Rank by materiality: a first-of-its-kind or "
        "largest-ever move (e.g. a record foreign US listing) outranks a micro-cap "
        "raise; a multi-billion transaction outranks an $875M one. Give the TOP one or "
        "two a real beat AND a 'so what' (why an investor should care), then compress "
        "the tail to a clause or drop it. Do NOT give equal weight to a landmark deal "
        "and a micro-cap disclosure.\n"
        "- LEVER 6 - CLOSE WITH A FORWARD LOOK: end with one short sentence on what is on "
        "deck next session (an earnings print, a scheduled release, a pending decision) "
        "drawn ONLY from the stories/macro above. If nothing concrete is on deck, say so "
        "in one honest clause; do not fabricate a catalyst.\n"
        "- A sector trend MAY be mentioned, but the pulse must NEVER read as a single-"
        "sector overview. Any story named is at most a one-line EXAMPLE after the "
        "market read.\n"
        "- Characterize direction ONLY from the TAPE FACTS above. If the tape is "
        "quiet, say so plainly. Do not assert a move the tape does not support.\n"
        "- ENTITY FIDELITY: name every company EXACTLY as written in the RANKED "
        "STORIES above (correct name and capitalization). Do NOT invent, abbreviate, "
        "or malform a name (no constructions like 'The Unum'). Name ONLY organizations "
        "that appear in the stories or tape above; name no others.\n"
        "- FIGURE FIDELITY: state a specific figure (dollar amount, percent, count, "
        "date, magnitude) ONLY if that exact figure appears in the STORY input or the "
        "TAPE / MACRO data above. Index moves, VIX, and macro values from the tape/strip "
        "are sourced and fine. Otherwise stay QUALITATIVE ('Micron is boosting US "
        "spending', not 'Micron will invest $3 billion'). When unsure of any number, "
        "drop it: a qualitative claim is never wrong; a fabricated figure is.\n"
        f"- The mood must be consistent with the regime "
        f"({(regime or 'unknown').upper()}"
        + (f"; e.g. words like {', '.join(vocab[:4])}" if vocab else "")
        + "), but SHOW it through the facts, do not name the mood as a label.\n"
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


# Deterministic anti-tautology guard for the LEAD_V2 lead (pure, offline-testable).
# The monolith's lead routinely restates the move as its own cause ("The mixed
# futures performance reflects investor caution ahead of ...", "on mixed
# sentiment"). A REAL WHY names an external force; a tautology names the move
# itself. We flag a tight set of self-referential cause constructions so the
# dedicated call's output can be re-asked when it regresses. Conservative: only
# clear move-restating-itself phrasings are flagged, never legitimate drivers.
_LEAD_TAUTOLOGY_PATTERNS = (
    r"reflect(?:s|ing|ed)?\s+(?:investor|market)\s+caution\s+ahead\s+of",
    r"reflect(?:s|ing|ed)?\s+(?:investor|market)\s+(?:optimism|pessimism|"
    r"uncertainty|nervousness|sentiment|mood|appetite|confidence)\b",
    r"\bon\s+mixed\s+sentiment\b",
    r"\bamid\s+(?:investor|market)\s+(?:caution|optimism|uncertainty|nervousness)\b",
    r"\bas\s+risk-?on\s+sentiment\s+(?:drove|fueled|lifted)",
    r"\bon\s+positive\s+momentum\b",
    r"\bamid\s+(?:ongoing|continued)\s+(?:optimism|caution|uncertainty)\b",
    r"\bas\s+(?:buyers|sellers)\s+stepped\s+in\b",
    r"\bdriven\s+by\s+(?:risk-?on|risk-?off|bullish|bearish)\s+sentiment\b",
)


def _lead_tautology_violation(text):
    """Return the list of self-referential 'the move is its own cause' phrases
    found in the lead text, or [] when clean. Pure; no network. Used to gate the
    LEAD_V2 output with ONE bounded re-ask when the real-why regresses."""
    if not isinstance(text, str) or not text.strip():
        return []
    hits = []
    low = text.lower()
    for pat in _LEAD_TAUTOLOGY_PATTERNS:
        m = re.search(pat, low)
        if m:
            hits.append(m.group(0))
    return hits


def _catalyst_figures(catalyst):
    """Best-effort figure list for a today_catalyst entry, so the shared
    labeled-figure formatter can render it. Prefers an explicit `figures` list;
    otherwise reconstructs one from the released_macro_context `m_o_m` / `y_o_y`
    sub-dicts (which carry value/unit/prior but no label) by re-attaching the
    basis label. Returns a list of figure dicts the formatter understands."""
    if not isinstance(catalyst, dict):
        return []
    figs = catalyst.get("figures")
    if isinstance(figs, list) and figs:
        return figs
    out = []
    for basis_label, sub in (("m/m", catalyst.get("m_o_m")), ("y/y", catalyst.get("y_o_y"))):
        if isinstance(sub, dict) and sub.get("value") is not None:
            out.append({
                "label": basis_label,
                "value": sub.get("value"),
                "unit": sub.get("unit") or "%",
                "prior": sub.get("prior"),
            })
    if out:
        return out
    # Last resort: a single flat headline value (unit only, basis unknown).
    if catalyst.get("value") is not None:
        return [{
            "label": "",
            "value": catalyst.get("value"),
            "unit": catalyst.get("unit") or "%",
            "prior": catalyst.get("prior"),
        }]
    return []


def _format_catalyst_line(catalyst):
    """A today's-catalyst entry as one BASIS-labeled prose line for the lead
    prompt, e.g. 'June CPI: -0.4% m/m, +3.5% y/y'. Tolerates a bare string or a
    value-less entry. Never raises."""
    if isinstance(catalyst, str):
        return catalyst.strip() or "(today's release)"
    if not isinstance(catalyst, dict):
        return "(today's release)"
    figs = _catalyst_figures(catalyst)
    line = macro_calendar.format_release_line(
        {
            "name": catalyst.get("name") or "",
            "period": catalyst.get("period") or "",
            "figures": figs,
        },
        max_figs=3,
    )
    return line or ((catalyst.get("name") or "").strip() or "(today's release)")


def generate_lead_v2(brief_type, tape, macro_ctx, top_stories, prior_ctx=None):
    """LEAD_V2: ONE bounded, focused Gemini call that produces the Today's Lead
    block (headline + lead_paragraph + supporting_context) with a REAL WHY, no
    tautology, and MACRO RECENCY. Mirrors generate_market_pulse: it is wired to
    OVERWRITE the monolith's parsed lead fields when the LEAD_V2 flag is on.
    Returns a dict {"headline", "lead_paragraph", "supporting_context"} (any subset
    of non-empty strings), or None on failure (caller keeps the monolith lead).

    Inputs:
      brief_type  : "morning" | "evening" (drives claim-scope framing).
      tape        : fetch_tape() dict (indices + VIX + regime).
      macro_ctx   : Agent 1's released_macro_context() dict
                    {"releases":[...], "today_catalyst": <dict|None>, "strip": str}.
                    today_catalyst present => that release IS today's catalyst and
                    the lead leads with it and its VALUE (never "await"). Tolerant
                    of a bare string or None (degrades to no fresh catalyst).
      top_stories : [{title, sector, one_liner, companies}] ranked, the corporate
                    stories the lead may draw its primary story from.
      prior_ctx   : optional prior-session context string (prior brief lead).

    Contract (also enforced by the deterministic _lead_tautology_violation
    post-check + the existing _headline_unsourced_figures guard): the lead's
    driver is an EXTERNAL force, never the move restating itself; a release that
    dropped TODAY leads the lead with its value; figures appear only if present in
    the inputs; the framing is observational, never prescriptive/advice.

    The model call is wired here; it is NOT exercised by the offline harness
    (which tests only _lead_tautology_violation). Gemini is never called at import
    time."""
    facts = _tape_facts_block(tape)
    # Normalize macro_ctx to the shared contract, tolerating a bare string / None.
    # is_release_day is the ONE authoritative flag the market pulse also reads, so
    # both consumers agree on whether a macro print is fresh-today vs backdrop.
    today_catalyst = None
    macro_strip = ""
    is_release_day = False
    if isinstance(macro_ctx, dict):
        today_catalyst = macro_ctx.get("today_catalyst")
        macro_strip = (macro_ctx.get("strip") or "").strip()
        is_release_day = bool(macro_ctx.get("is_release_day"))
    elif isinstance(macro_ctx, str):
        macro_strip = macro_ctx.strip()
    # The catalyst branch is keyed on the SHARED release-day flag, never on the
    # presence of a macro number in the strip. A backdrop print in the strip must
    # NOT trip the "release dropped today" framing.
    today_catalyst = today_catalyst if is_release_day else None
    macro_block = macro_strip if macro_strip else "(no fresh macro prints)"

    if brief_type == "evening":
        claim_scope = (
            "CLAIM SCOPE (EVENING, absolute): the session has CLOSED. The lead may "
            "render the settled full-session verdict; closing verbs are correct "
            "('closed up', 'ended the day', 'finished the session')."
        )
    else:
        claim_scope = (
            "CLAIM SCOPE (MORNING, absolute): the session is IN PROGRESS. Describe "
            "the market as it OPENED / is TRADING in the EARLY SESSION, using "
            "opening/early-session verbs ONLY ('opened higher', 'is trading up', "
            "'early gains'). FORBIDDEN: any settled whole-day or closing verdict "
            "('closed', 'ended the day', 'finished', 'on the day')."
        )

    # MACRO RECENCY framing. today_catalyst may be a released_macro_context entry
    # (name + y_o_y/m_o_m/figures) or, defensively, a string. Render it BASIS-
    # LABELED via the shared formatter so the catalyst line the lead is told to
    # lead with is unambiguous ("June CPI: -0.4% m/m, +3.5% y/y"), never a bare
    # number the reader cannot reconcile against the strip.
    if today_catalyst:
        _cat_line = _format_catalyst_line(today_catalyst)
        macro_framing = (
            "MACRO RECENCY (a release DROPPED TODAY - it IS the day's catalyst): "
            f"today's catalyst is {_cat_line}. The lead's driver IS this release "
            "STATED WITH ITS BASIS-LABELED VALUE (model: 'June CPI fell 0.4% m/m, "
            "though it is still up 3.5% y/y, ...'). MANDATORY: whenever you cite a "
            "macro percentage (CPI, PPI, PCE, GDP), you MUST state its BASIS - m/m "
            "(month-over-month) or y/y (year-over-year). A CPI figure without m/m "
            "or y/y is FORBIDDEN: '-0.4%' alone is ambiguous and reads as "
            "contradicting the y/y number. If you cite the m/m move, also name the "
            "y/y so the two reconcile. FORBIDDEN on a release day: framing the "
            "market as 'awaiting' / 'ahead of' / 'looking to' this print - it has "
            "ALREADY landed. Lead the lead_paragraph with the print and the "
            "market's reaction to it."
        )
    else:
        macro_framing = (
            "MACRO RECENCY (NO release dropped today - the shared release-day flag "
            "is FALSE, every macro print in the backdrop is a PRIOR-SESSION or older "
            "print, NOT today's news): ABSOLUTE PROHIBITION - the lead must NOT lead "
            "with, headline, or center any macro print (CPI, PPI, PCE, jobs, GDP, "
            "etc.). Do NOT open the lead_paragraph or the headline with a macro "
            "figure or its month-over-month / year-over-year value, and do NOT frame "
            "a dated print as 'today's', 'this morning's', 'the latest', or a fresh "
            "'reprieve' / 'surprise' / 'report'. Those prints are BACKDROP only: they "
            "earn AT MOST a single short trailing clause of context, never the "
            "subject of the lead. Lead instead with the real corporate/market driver "
            "from the RANKED STORIES; if the tape is quiet with no dominant catalyst, "
            "say so honestly ('opened higher in quiet trading with no fresh catalyst "
            "on the tape'). An honest no-catalyst line is REQUIRED over dressing a "
            "day-old print up as fresh news."
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
    prior_block = (prior_ctx or "").strip()

    system = (
        "You write the Today's Lead block of a daily market brief: the single most "
        "important development and why it matters. Return JSON only: "
        '{"headline": "<10-15 word headline naming the ONE primary story>", '
        '"lead_paragraph": "<2-3 sentences on that story: who, what, the figure/'
        'value, the market reaction>", "supporting_context": "<2-3 sentences of '
        "real context: why it matters now, the backdrop, comparable moves>\"}. No "
        "other keys, no prose outside the JSON. Zero em-dashes; use hyphens, "
        "colons, parens.\n\n"
        "You are ONE sharp markets analyst explaining the day's single biggest "
        "driver to a smart person who is NOT in the market every day. Write like a "
        "wire lead (AP / Bloomberg), not an AI summary: plain words, short "
        "sentences, concrete named forces. Observational only: state what happened "
        "and why; NEVER give advice, a recommendation, or a call to action."
    )
    user = (
        "Write the Today's Lead block. Pick the SINGLE most material development as "
        "the primary story and commit the whole block to it (never stack two "
        "stories with 'and', commas, 'while', 'as', or 'amid').\n\n"
        f"{claim_scope}\n\n"
        f"{facts}\n\n"
        f"MACRO BACKDROP (fetched facts, do not invent; each print tagged with its "
        f"release recency):\n{macro_block}\n\n"
        f"{macro_framing}\n\n"
        f"RANKED STORIES (the corporate candidates for the primary story):\n"
        f"{stories_block}\n\n"
        + (f"PRIOR SESSION CONTEXT: {prior_block}\n\n" if prior_block else "")
        + "RULES (absolute):\n"
        "- REAL WHY, NOT TAUTOLOGY: the driver must be an EXTERNAL force - a named "
        "catalyst (a macro print, a deal, an earnings result), a sector move, a "
        "rates / oil / credit force - NEVER the price action restating itself. "
        "BANNED because they merely restate the move: 'reflects investor caution "
        "ahead of ...', 'on mixed sentiment', 'amid investor optimism', 'as "
        "risk-on sentiment drove participation', 'on positive momentum', 'as "
        "buyers stepped in'. If NO real external driver exists, say so honestly "
        "('drifted in quiet trading with no dominant catalyst'); an honest "
        "no-catalyst line beats a fake why. Do NOT manufacture a driver.\n"
        "- MACRO RECENCY: obey the MACRO RECENCY framing above exactly. On a "
        "release day the catalyst IS today's release stated WITH ITS VALUE; never "
        "frame the market as 'awaiting' or 'ahead of' a print that already "
        "landed.\n"
        "- FIGURE FIDELITY: state a specific figure (dollar amount, percent, "
        "count, date, magnitude) ONLY if that exact figure appears in the RANKED "
        "STORIES, the MACRO BACKDROP, or the TAPE FACTS above. Index moves, VIX, "
        "and macro values from the tape/strip are sourced and fine. When unsure of "
        "a number, DROP it: a qualitative claim is never wrong; a fabricated "
        "figure is.\n"
        "- ENTITY FIDELITY: name every company EXACTLY as written in the RANKED "
        "STORIES (correct name and capitalization). Name ONLY organizations that "
        "appear in the stories, macro, or tape above.\n"
        "- HEADLINE: 10-15 words, names the ONE primary story (company / "
        "institution / index / data point) and what happened. No generic labels "
        "('Markets Face Uncertainty'), no comma-stacking two stories, no 'and' "
        "joining two different transactions or themes.\n"
        "- OBSERVATIONAL + COMPLIANT: no prescriptive or advice language, no "
        "recommendation, no 'investors should', no reader-directed call to "
        "action. State the read and what it turns on; never narrate who is "
        "'watching' or 'awaiting'.\n"
        "- VOICE: plain, short, one analyst. Every sentence carries a fact or a "
        "named force; if a sentence does neither, cut it."
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.3, max_tokens=1024)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed, dict):
            out = {}
            for k in ("headline", "lead_paragraph", "supporting_context"):
                v = parsed.get(k)
                if isinstance(v, str) and v.strip():
                    out[k] = v.strip()
            if out.get("lead_paragraph") or out.get("supporting_context"):
                return out
    except Exception as e:
        print(f"  ⚠ LEAD_V2 dedicated call failed (non-fatal): {e}")
    return None


# Deterministic breadth-claim guard (pure). A recent render asserted "resilient
# breadth" while the only proxy (Russell) was red and the model had NO breadth
# input. The pulse may assert breadth ONLY when the tape carries a real breadth
# field. These phrases assert market breadth as a characterization; matched
# case-insensitively on word boundaries. "narrow leadership" / "small-cap lag"
# are NOT breadth claims (they describe the observable index spread) and are not
# listed here.
_BREADTH_ASSERTION_RE = re.compile(
    r"\b("
    r"resilient breadth|healthy breadth|strong breadth|broad breadth|narrow breadth|"
    r"weak breadth|deteriorating breadth|improving breadth|"
    r"broad(?:-|\s)based (?:gains|rally|advance|participation|strength|buying)|"
    r"broad participation|broad-based|broadly participating|"
    r"advance[/-]decline|advancers|decliners|"
    r"most (?:stocks|names|sectors) (?:rose|advanced|gained|fell|declined)"
    r")\b",
    re.IGNORECASE,
)


def _narrative_breadth_claims(narrative):
    """Return the breadth-asserting phrases found in the narrative (deduped,
    lowercased). Empty when the narrative makes no breadth characterization.
    Pure; offline-testable via the raw regex on a string."""
    if not isinstance(narrative, str) or not narrative.strip():
        return []
    seen, out = set(), []
    for m in _BREADTH_ASSERTION_RE.finditer(narrative):
        raw = m.group(0).strip().lower()
        if raw not in seen:
            seen.add(raw)
            out.append(raw)
    return out


def _pulse_breadth_violation(narrative, tape):
    """A breadth claim is a violation ONLY when the tape carries NO real breadth
    field. Returns the offending phrases (empty = clean). This is the deterministic
    backstop behind the prompt's breadth rule. Pure."""
    if _tape_has_breadth_field(tape):
        return []
    return _narrative_breadth_claims(narrative)


# ── Sector-attribution guard (#461 proxy honesty) ────────────────────────────
# The sector figures the pulse consumes are sector-ETF DAY MOVES (a leadership
# PROXY), not constituent breadth: XLK can be up on ONE megacap. Consuming them
# as "technology led / energy lagged" asserts sector-wide breadth we cannot
# support - wrong in the SAME reassuring direction the breadth guard exists to
# kill. This guard flags a sector name used as the SUBJECT of a group-move verb
# WITHOUT ETF attribution ('ETF' / 'ETFs' / an XL* ticker) nearby. Attributed
# forms ('tech ETFs led', 'the technology ETF (XLK) outperformed') are clean.
# The sector-name vocabulary derives from market_tape.SECTOR_ETFS labels plus
# common short forms. Pure; offline-testable on a raw string.
_SECTOR_NAME_TERMS = [
    "technology", "tech", "financials", "financial", "energy", "health care",
    "healthcare", "consumer discretionary", "consumer staples", "staples",
    "industrials", "materials", "utilities", "real estate", "communication services",
    "communications",
]
# Group-move verbs/adjectives that, applied to a bare sector name, assert the
# whole sector participated (a breadth claim). "ETF(s)" / an XL* ticker within
# the same clause is the attribution that makes it honest.
_SECTOR_MOVE_TERMS = (
    r"led|leading|lagged|lagging|rose|fell|rallied|rally|gained|gaining|climbed|"
    r"dropped|slid|sank|jumped|surged|tumbled|outperformed|underperformed|"
    r"advanced|declined|strong|strength|weak|weakness|soft|softness"
)
# Attribution tokens: 'ETF' / 'ETFs' (any case) or an SPDR sector ticker (XLK,
# XLF, ... XLRE). Presence within the match window makes the claim attributed.
_SECTOR_ATTR_RE = re.compile(r"\bETFs?\b|\bXL[A-Z]{1,2}\b", re.IGNORECASE)
# BREADTH MARKERS: words that assert the whole sector's CONSTITUENTS moved as a
# group (real sector-wide breadth), NOT the ETF proxy. When any of these sits in
# the SAME sentence as a sector-move span, the claim is a genuine breadth
# assertion the ETF proxy cannot support - it VIOLATES even if an 'ETFs' token
# also appears in the sentence ('tech ETFs led as technology stocks broadly
# rallied' is still a breadth claim). This is the hard floor that keeps the
# single-attribution relaxation below from ever accepting real breadth.
# NOTE: intentionally NARROW. "names"/"shares" are idiomatic single-focus
# references ("large-cap growth names", "the chip names") and would false-flag an
# attributed, honest read; they are OMITTED. The markers kept are the ones that
# ONLY read as a whole-sector-constituents claim. "broadly" alone still catches
# the classic "tech names broadly rose" / "energy stocks broadly rallied".
_SECTOR_BREADTH_MARKER_RE = re.compile(
    r"\b(?:broadly|broad-based|broad based|across the board|sector-wide|"
    r"sector wide|constituents|sector participation|broad participation|"
    r"participated broadly|en masse|wholesale|whole sector|entire sector)\b",
    re.IGNORECASE,
)
_SECTOR_CLAIM_RES = [
    re.compile(
        r"\b" + re.escape(term) + r"\b[^.;]{0,40}?\b(?:" + _SECTOR_MOVE_TERMS + r")\b",
        re.IGNORECASE,
    )
    for term in _SECTOR_NAME_TERMS
]


def _tape_has_sector_field(tape):
    """True when the tape carries the sector-ETF leadership proxy (leaders or
    laggards populated), under either #461's nested shape or a flat alias. Pure."""
    if not isinstance(tape, dict):
        return False
    view = _enrichment_view(tape)
    for k in ("sector_leaders", "sector_laggards", "leaders", "laggards"):
        v = view.get(k)
        if isinstance(v, (list, tuple)) and len(v) > 0:
            return True
    return False


def _sentence_bounds(text, pos):
    """[start, end) of the sentence in `text` that contains index `pos`. Splits on
    ./!/? followed by whitespace, matching overview_grounding's boundary. Pure."""
    start = 0
    for m in re.finditer(r"[.!?]+(?:\s+|$)", text):
        if m.end() <= pos:
            start = m.end()
        elif m.start() >= pos:
            return start, m.end()
    return start, len(text)


def _narrative_unattributed_sector_claims(narrative):
    """Sector-as-group move claims that assert the sector moved as a group WITHOUT
    honest ETF attribution. Returns the offending spans (deduped, lowercased);
    empty when every sector mention is attributed or absent.

    ATTRIBUTE-ONCE (the #468 phrasing was clumsy: it forced 'ETFs' onto EVERY
    sector, yielding 'Energy ETFs led while Health Care ETFs lagged'). A sector
    move now reads as attributed when the ETF proxy is named EITHER in the local
    window OR anywhere in the SAME sentence - so 'Energy ETFs led (+0.45%) while
    health care lagged (-1.14%)' passes on the single leading 'ETFs'. The gate is
    NOT loosened into accepting real breadth: a BREADTH MARKER ('broadly',
    'stocks', 'names', 'across the board', ...) in the sentence is a HARD violation
    regardless of any ETF token, so 'energy stocks broadly rallied' and 'tech ETFs
    led as technology stocks broadly rose' both still VIOLATE. Pure."""
    if not isinstance(narrative, str) or not narrative.strip():
        return []
    seen, out = set(), []
    for rx in _SECTOR_CLAIM_RES:
        for m in rx.finditer(narrative):
            span = m.group(0)
            # Widen the attribution window a little past the match so 'tech led,
            # per the sector ETFs' style trailing attribution still counts.
            start = max(0, m.start() - 12)
            end = min(len(narrative), m.end() + 24)
            window = narrative[start:end]
            s_start, s_end = _sentence_bounds(narrative, m.start())
            sentence = narrative[s_start:s_end]
            # HARD FLOOR: a breadth marker in the sentence is a genuine sector-wide
            # breadth claim the ETF proxy cannot support - always a violation, even
            # when an 'ETFs' token also appears (it does not launder the breadth).
            breadth_asserted = bool(_SECTOR_BREADTH_MARKER_RE.search(sentence))
            if not breadth_asserted and (
                _SECTOR_ATTR_RE.search(window)
                or _SECTOR_ATTR_RE.search(sentence)
            ):
                continue  # attributed to the ETF move (locally or once per sentence)
            key = " ".join(span.split()).strip().lower()
            if key not in seen:
                seen.add(key)
                out.append(key)
    return out


def _pulse_sector_attribution_violation(narrative, tape):
    """A sector claim is a violation ONLY when the tape is feeding the sector-ETF
    proxy AND the narrative asserts a sector as a group-move subject without ETF
    attribution. Gated on the proxy being present so we never false-flag prose on
    a tape with no sector field. Deterministic backstop behind LEVER 3c. Returns
    the offending spans (empty = clean). Pure."""
    if not _tape_has_sector_field(tape):
        return []
    return _narrative_unattributed_sector_claims(narrative)


# ── Enrichment-aware grounding (dead-path fix) ───────────────────────────────
# overview_grounding.validate_pulse_grounding builds its sourced set from
# tape['quotes'] + VIX + macro + stories ONLY. It has NO knowledge of #461's
# enrichment block (rates level, oil level/pct, sector-ETF pcts, sector labels).
# So the instant the V2 pulse SPENDS space on the enrichment (#463's whole point),
# the validator flags those figures/entities as unsourced and forces the minimal
# fallback -> the enrichment prose can NEVER ship. That is the real dead path: the
# enrich flag was off (fixed) AND the grounding gate rejects enrichment prose. We
# fix it in OUR file (no edit to overview_grounding): compute the enrichment
# figures + entity labels as legitimately-sourced, and drop them from the
# validator's violation lists. Reuses overview_grounding helpers by import.
def _enrichment_sourced_figures(tape):
    """The figure set the enrichment legitimately sources: 10Y level + bps,
    oil level + pct, and each sector-ETF pct. Same (kind, mag, raw) shape as
    overview_grounding._pulse_figures. Empty when no enrichment. Pure."""
    figs = []
    if not isinstance(tape, dict):
        return figs
    view = _enrichment_view(tape)
    # Rates level + bps (flat aliases populated by _enrichment_view).
    for k, kind in (("us10y_level", "pct"), ("us10y_bps", "count")):
        v = view.get(k)
        if v is not None:
            try:
                figs.append((kind, float(v), "enrichment"))
            except (TypeError, ValueError):
                pass
    # Oil: level (a count magnitude) + pct.
    wti = view.get("wti")
    if isinstance(wti, dict):
        for k, kind in (("level", "count"), ("pct", "pct")):
            v = wti.get(k)
            if v is not None:
                try:
                    figs.append((kind, float(v), "enrichment"))
                except (TypeError, ValueError):
                    pass
    # Sector-ETF pcts (leaders + laggards).
    for key in ("sector_leaders", "sector_laggards"):
        for s in (view.get(key) or []):
            if isinstance(s, dict) and s.get("pct") is not None:
                try:
                    figs.append(("pct", float(s["pct"]), "enrichment"))
                except (TypeError, ValueError):
                    pass
    return figs


def _enrichment_sourced_entities(tape):
    """The lowercased vocabulary the #461 enrichment legitimately sources, DERIVED
    FROM THE ENRICHMENT BLOCK (never hardcoded): every sector-ETF symbol (XLE, XLK,
    XLU, ...) and its sector name AND the "<Sector> ETFs" phrasing the prompt tells
    the model to use, plus the oil symbol/name (WTI, CL=F, crude) whenever oil is
    present. The rates name (10-year Treasury) is already covered by overview_
    grounding._NON_ORG_TERMS. Returned as a set of lowercased strings; the enriched
    validator matches candidates against a bag built from these via org_supported,
    so a single ticker (WTI/XLE) matches verbatim and a two-word phrase
    ("Energy ETFs") matches through its non-generic head. Empty when no enrichment.
    Pure. A term NOT emitted by the tape is NOT added, so a genuine hallucination
    still fails."""
    out = set()
    if not isinstance(tape, dict):
        return out
    view = _enrichment_view(tape)
    _has_sector_field = False
    for key in ("sector_leaders", "sector_laggards"):
        for s in (view.get(key) or []):
            if not isinstance(s, dict):
                continue
            _has_sector_field = True
            nm = (s.get("sector") or s.get("name") or s.get("label") or "").strip().lower()
            if nm:
                out.add(nm)
                # The prompt instructs the model to attribute as "<Sector> ETFs".
                out.add(f"{nm} etfs")
                out.add(f"{nm} etf")
            sym = str(s.get("symbol") or "").strip().lower()
            if sym:
                out.add(sym)
    # The GENERIC aggregate reference to the sector-ETF proxy ("Sector ETFs",
    # "sector ETF") is sourced by the enrichment whenever it actually carries the
    # sector-ETF field. It names the ETF proxy itself, not a company, so it is NOT
    # a hallucinated entity. Added ONLY when a real sector field is present (still
    # derived from inputs, never a blanket allow); on a tape with no sector proxy
    # the phrase stays flagged. This kills the recurring "Sector ETFs" false
    # positive that forced minimal_template on Jul 16 / 18 / 20.
    if _has_sector_field:
        out.update({"sector etfs", "sector etf"})
    # Oil symbol + name, only when the enrichment actually carries oil.
    wti = view.get("wti")
    if isinstance(wti, dict) and (wti.get("level") is not None or wti.get("pct") is not None):
        out.update({"wti", "cl=f", "crude", "wti crude"})
    return out


def _validate_pulse_grounding_enriched(narrative, tape, macro_strip, top_stories):
    """Wrap overview_grounding.validate_pulse_grounding, then FORGIVE the figures
    and entities the #461 enrichment legitimately sources (rates / oil / sector-ETF
    moves + sector labels). Without this, any pulse that uses the enrichment prose
    is force-failed into the minimal fallback and the enrichment never ships. Reuses
    overview_grounding._pulse_figures / ._figure_sourced by import. Returns the same
    dict shape as validate_pulse_grounding. Pure."""
    res = overview_grounding.validate_pulse_grounding(narrative, tape, macro_strip, top_stories)
    enr_figs = _enrichment_sourced_figures(tape)
    enr_ents = _enrichment_sourced_entities(tape)
    if not enr_figs and not enr_ents:
        return res
    # Re-filter unsourced figures: drop any now covered by the enrichment set.
    kept_figs = []
    for raw in res.get("unsourced_figures") or []:
        parsed = overview_grounding._pulse_figures(raw)
        forgiven = any(
            overview_grounding._figure_sourced(kind, mag, enr_figs)
            for (kind, mag, _r) in parsed
        )
        if not forgiven:
            kept_figs.append(raw)
    # Re-filter unsupported entities: drop any candidate the enrichment sources.
    # Build a lowercased bag from the enrichment vocabulary and forgive via the
    # SAME support logic the base check uses (org_supported), so a single ticker
    # (WTI / XLE / XLK) matches verbatim and a two-word phrase ("Energy ETFs")
    # matches through its non-generic head. An entity absent from the enrichment
    # bag stays flagged, so a genuine hallucination still fails.
    enr_bag = " ".join(sorted(enr_ents))
    kept_ents = [
        e for e in (res.get("unsupported_entities") or [])
        if not overview_grounding.org_supported(e.strip().lower(), enr_bag, set())
    ]
    tapes = res.get("tape_violations") or []
    reasons = []
    if kept_ents:
        reasons.append("unsupported entities: " + ", ".join(kept_ents))
    reasons.extend(tapes)
    if kept_figs:
        reasons.append("unsourced figures: " + ", ".join(kept_figs))
    return {
        "ok": not kept_ents and not tapes and not kept_figs,
        "unsupported_entities": kept_ents,
        "tape_violations": tapes,
        "unsourced_figures": kept_figs,
        "reasons": reasons,
    }


def _pulse_sentence_violation_kinds(sentence, tape, macro_strip, top_stories):
    """The set of grounding-violation kinds a SINGLE pulse sentence carries, run
    with the SAME four checks + the SAME enrichment-forgiveness the whole-hero gate
    uses: enriched entities, unsourced figures, and unattributed sector-breadth.
    The tape-DIRECTION check is deliberately EXCLUDED here: it is a NET, whole-
    narrative claim (dominant direction), not a per-sentence one, so evaluating it
    sentence-by-sentence would false-flag a lone opposite word. Direction stays a
    whole-hero gate; the strip only targets sentence-local entity/figure/sector
    faults. Returns a set of strings (empty = the sentence is clean). Pure."""
    kinds = set()
    _v = _validate_pulse_grounding_enriched(sentence, tape, macro_strip, top_stories)
    if _v.get("unsupported_entities"):
        kinds.add("entity")
    if _v.get("unsourced_figures"):
        kinds.add("figure")
    if _pulse_sector_attribution_violation(sentence, tape):
        kinds.add("sector")
    if _pulse_breadth_violation(sentence, tape):
        kinds.add("breadth")
    return kinds


def _repair_pulse_hero(narrative, tape, macro_strip, top_stories,
                       final_corpus_companies, brief_type):
    """STRIP-OR-REPAIR: remove ONLY the sentence(s) that carry an entity / figure /
    sector-attribution / breadth violation, keep the rest of the V2 hero, and ship
    the result ONLY if it re-passes the FULL grounding gate (opening + enriched
    grounding + breadth + sector-attribution). The gate is NOT weakened: a genuine
    hallucination in a strippable sentence is removed (not shipped), and a sentence
    whose removal cannot clear the gate (or a violation in the lead sentence) yields
    None so the caller falls to the minimal template. Returns (repaired_text, dropped
    list) or (None, dropped). Pure aside from the deterministic checks it calls."""
    dropped: list[str] = []

    def _is_viol(sent):
        kinds = _pulse_sentence_violation_kinds(sent, tape, macro_strip, top_stories)
        if kinds:
            dropped.append(sent.strip())
        return bool(kinds)

    repaired = overview_grounding.strip_pulse_violations(narrative, _is_viol)
    if not repaired:
        return None, dropped
    # Re-validate the SURVIVING hero through the same full gate. Direction is a
    # whole-narrative claim and IS re-checked here (it was excluded per-sentence).
    ok = bool(
        overview_grounding.validate_pulse_opening(
            repaired, final_corpus_companies, brief_type)["ok"]
        and _validate_pulse_grounding_enriched(
            repaired, tape, macro_strip, top_stories)["ok"]
        and not _pulse_breadth_violation(repaired, tape)
        and not _pulse_sector_attribution_violation(repaired, tape)
    )
    if not ok:
        return None, dropped
    return repaired, dropped


# Headline figure guard (gap 5). The V2 pulse figure guard covers the narrative
# but NOT the monolith's Today's Lead HEADLINE, where an unsourced "$3 Billion"
# has shipped. Every figure in a generated headline must trace to an input: the
# article corpus text or the tape. Reuses overview_grounding's figure helpers by
# import (no edit to overview_grounding). Pure; offline-testable.
def _headline_sourced_figures(article_text, tape):
    """The figure set a headline is allowed to state: every figure appearing in
    the corpus text, plus the tape's own numbers (index pcts, levels, VIX). Reuses
    overview_grounding._pulse_figures / ._sourced_figure_set. Pure."""
    figs = list(overview_grounding._pulse_figures(article_text or ""))
    # Tape numbers (index pcts + levels + VIX) via the shared sourced-set builder,
    # passing no macro strip / stories (headline sourcing is corpus + tape only).
    try:
        figs.extend(overview_grounding._sourced_figure_set(tape, "", []))
    except Exception:
        pass
    return figs


def _headline_unsourced_figures(headline, article_text, tape):
    """Figures in the headline not supported by the corpus text or the tape.
    A fabricated magnitude (a $3B no input states) is flagged; a headline with no
    figure is never flagged. Trivial rounding/unit forms allowed (same tolerance
    as the pulse figure guard). Pure."""
    if not isinstance(headline, str) or not headline.strip():
        return []
    sourced = _headline_sourced_figures(article_text, tape)
    seen, bad = set(), []
    for (kind, mag, raw) in overview_grounding._pulse_figures(headline):
        if not overview_grounding._figure_sourced(kind, mag, sourced) and raw.lower() not in seen:
            seen.add(raw.lower())
            bad.append(raw)
    return bad


def _reask_headline_drop_unsourced(headline, unsourced, article_text, tape):
    """ONE bounded re-ask that rewrites the headline to DROP or fix the unsourced
    figures, keeping it a valid 10-15 word primary-story headline. Returns the new
    string or None. Runs only on a violation (not exercised by the offline harness).
    Uses the corpus text as the sourcing ground truth."""
    facts = _tape_facts_block(tape)
    system = (
        "You rewrite ONE field of a finished market brief: the lead headline. Return "
        'JSON only: {"headline": "<rewritten headline>"}. No other keys, no prose '
        "outside the JSON. Keep it a single 10-15 word headline naming ONE primary "
        "story. Zero em-dashes; use hyphens, colons, parens."
    )
    user = (
        "The current headline states figure(s) NOT supported by any input: "
        + ", ".join(unsourced) + ".\n"
        "Rewrite the headline so EVERY figure it states appears verbatim in the SOURCE "
        "TEXT or the TAPE below. If a figure is not sourced, DROP it and state the "
        "development qualitatively (a qualitative headline is never wrong; a fabricated "
        "figure is). Change nothing else about which story it names.\n\n"
        f"{facts}\n\n"
        "CURRENT HEADLINE:\n" + headline + "\n\n"
        "SOURCE TEXT (the only figures you may cite, besides the tape):\n"
        + (article_text or "")[:6000]
    )
    try:
        raw = gemini_generate(system=system, user_content=user, temperature=0.2, max_tokens=256)
        parsed = _parse_brief_json(raw)
        if parsed and isinstance(parsed.get("headline"), str) and parsed["headline"].strip():
            return parsed["headline"].strip()
    except Exception as e:
        print(f"  ⚠ headline figure guard: re-ask failed (non-fatal): {e}")
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

        # UNIFIED_LEAD: ONE deterministic argmax over the unified candidate set
        # (macro / impact clusters AND the qualified deal, which is already a scored
        # cluster in the pool) on the named-weight rubric in impact_ranking
        # (compute_unified_lead: materiality / session_fit / confirmation / breadth).
        #
        # SHADOW CLOCK (contract C1): compute_unified_lead is COMPUTED and its full
        # per-candidate result LOGGED to preselect_decision.unified on EVERY run,
        # flag on or off. Only the SERVE (replacing the shipped precedence pick with
        # argmax(unified_score)) stays gated on UNIFIED_LEAD == "on". When the flag
        # is OFF the shipped brief is byte-identical to prod: `preselected` =
        # `impact_pick or deal_pick` is untouched; only the added telemetry differs.
        # The RAW per-candidate components (materiality/session_fit/confirmation/
        # breadth) + weighted_score + is_shipped_lead are load-bearing: the
        # calibrator re-fits weights from them and joins the grade to the right
        # candidate. Orthogonal to MATERIALITY_RANK_MODE (does NOT flip it). Fails
        # closed: any error keeps the precedence pick and logs nothing. Selection-only.
        if brief_type in ("morning", "evening") and _pool:
            try:
                import impact_ranking as _uir
                # Reuse the SAME tape + per-name moves the materiality block uses so
                # the whole brief still makes ONE fetch_tape() call. When the
                # materiality block runs after us we set _materiality_tape here and it
                # reuses it; when MATERIALITY_RANK_MODE=off we fetch here (unified only).
                if _materiality_tape is None:
                    try:
                        _prior_tape_u = _fetch_prior_session_tape(_et_session_date(_now))
                        _materiality_tape = market_tape.fetch_tape(
                            enrich=True, prior_session_tape=_prior_tape_u
                        )
                    except Exception as _ute:
                        print(f"  ⚠ [unified] tape fetch failed (non-fatal): {_ute}")
                        _materiality_tape = None
                _u_name_moves, _u_name_calls = _pool_name_session_moves(_pool)

                # ── Identify the SHIPPED lead BEFORE the contest so we can force its
                # cluster into the audit. With the flag OFF the shipped lead is the
                # precedence pick (impact_pick or deal_pick) = `preselected` right now
                # (serve has not run). The unified audit is capped
                # (_TOP_CLUSTERS_AUDIT_CAP) and the shipped cluster can rank below it
                # (observed Jul 15: macro:cpi outside the top-10), which would leave
                # is_shipped_lead false everywhere and break the calibrator join. APP
                # added always_include_clusters: any cluster in that set is appended to
                # unified_candidates with its full vector + below_cap=True even when it
                # ranks below the cap. Pass the shipped cluster so its vector is
                # guaranteed present. ──
                _shipped_cluster = str((preselected or {}).get("_impact_cluster") or "")
                _shipped_title = str((preselected or {}).get("title") or "")[:200].strip().lower()
                _always_include = {_shipped_cluster} if _shipped_cluster else set()

                # Defensive: the merged APP signature accepts always_include_clusters;
                # a pre-merge local impact_ranking does not. Try the new kwarg, fall
                # back to the old call so this verifies standalone before integration.
                _uni_kwargs = dict(
                    brief_type=brief_type,
                    tape=_materiality_tape,
                    name_session_pct=_u_name_moves,
                    mega_deal_urls=_uir._mega_deal_urls(supabase, _now),
                )
                try:
                    _uni = _uir.compute_unified_lead(
                        _pool, _now, always_include_clusters=_always_include, **_uni_kwargs
                    )
                except TypeError:
                    print("  ⚠ [unified] impact_ranking pre-merge (no always_include_clusters); "
                          "using legacy call (shipped cluster may be below the audit cap)")
                    _uni = _uir.compute_unified_lead(_pool, _now, **_uni_kwargs)

                if _uni and _uni.get("article"):

                    def _is_shipped(_cand: dict) -> bool:
                        _ck = str(_cand.get("cluster_key") or "")
                        if _shipped_cluster and _ck and _ck == _shipped_cluster:
                            return True
                        _ct = str(_cand.get("title") or "")[:200].strip().lower()
                        return bool(_shipped_title and _ct and _ct == _shipped_title)

                    # ── Active weights + provenance. Prefer the accessor Agent APP is
                    # wiring into impact_ranking (active_weights_meta -> {values, source,
                    # version}); fall back defensively to the hardcoded 4/4/3/1.5 so this
                    # is verifiable standalone before APP merges. ──
                    _wa = getattr(_uir, "active_weights_meta", None)
                    if callable(_wa):
                        try:
                            _wmeta = _wa() or {}
                        except Exception:
                            _wmeta = {}
                    else:
                        _wmeta = {}
                    _wvals = _wmeta.get("values") if isinstance(_wmeta, dict) else None
                    if isinstance(_wvals, dict) and _wvals:
                        _weights_used = {
                            "materiality": _wvals.get("materiality", getattr(_uir, "W_MATERIALITY", 4.0)),
                            "session_fit": _wvals.get("session_fit", getattr(_uir, "W_SESSION_FIT", 4.0)),
                            "confirmation": _wvals.get("confirmation", getattr(_uir, "W_CONFIRMATION", 3.0)),
                            "breadth": _wvals.get("breadth", getattr(_uir, "W_BREADTH", 1.5)),
                            "source": (
                                f"{_wmeta.get('source', 'default')}"
                                + (f"_v{_wmeta['version']}" if _wmeta.get("version") is not None else "")
                            ),
                        }
                    else:
                        _weights_used = {
                            "materiality": getattr(_uir, "W_MATERIALITY", 4.0),
                            "session_fit": getattr(_uir, "W_SESSION_FIT", 4.0),
                            "confirmation": getattr(_uir, "W_CONFIRMATION", 3.0),
                            "breadth": getattr(_uir, "W_BREADTH", 1.5),
                            "source": "default",
                        }

                    def _cand_c1(_a: dict) -> dict:
                        # Map an impact_ranking audit row -> the C1 per-candidate shape:
                        # raw pre-weight components + final weighted score +
                        # is_shipped_lead + below_cap (true for a cluster APP appended
                        # via always_include_clusters because it ranked below the cap).
                        return {
                            "title": _a.get("title"),
                            "cluster": _a.get("cluster_key"),
                            "source": (_a.get("source")
                                       or ("macro" if str(_a.get("cluster_key") or "").startswith("macro:")
                                           else "impact")),
                            "is_shipped_lead": _is_shipped(_a),
                            "components": {
                                "materiality": _a.get("c_materiality"),
                                "session_fit": _a.get("c_session_fit"),
                                "confirmation": _a.get("c_confirmation"),
                                "breadth": _a.get("c_breadth"),
                            },
                            "weighted_score": _a.get("unified_score"),
                            "below_cap": bool(_a.get("below_cap", False)),
                        }

                    _audit = _uni.get("unified_candidates") or []
                    _c1_candidates = [_cand_c1(a) for a in _audit]
                    _win = _uni.get("unified_winner") or {}
                    _c1_winner = {
                        "title": _win.get("title") or _uni.get("article", {}).get("title"),
                        "cluster": _win.get("cluster_key") or _uni.get("cluster_key"),
                        "source": (_win.get("source")
                                   or ("macro" if str(_uni.get("cluster_key") or "").startswith("macro:")
                                       else "impact")),
                        "score": _win.get("unified_score", _uni.get("score")),
                    }
                    # Top 2 by weighted_score excluding the winner (audit is already
                    # sorted desc; winner is index 0).
                    _c1_losers = [_cand_c1(a) for a in _audit[1:3]]

                    # ── Join integrity for the calibrator. The unified audit is capped
                    # (impact_ranking._TOP_CLUSTERS_AUDIT_CAP), so the shipped precedence
                    # cluster can rank BELOW the cap (observed Jul 15: macro:cpi outside
                    # the top-10). We now force it in via always_include_clusters (APP),
                    # so is_shipped_lead should resolve true even for a below-cap shipped
                    # pick (its candidate carries below_cap=True). shipped_in_audit stays
                    # as an explicit invariant check: on the merged path it is true; if
                    # it is ever false the join silently failed (pre-merge legacy call,
                    # or the shipped cluster was not scored at all) and the calibrator
                    # must skip the run rather than mis-join. ──
                    _shipped_in_audit = any(c["is_shipped_lead"] for c in _c1_candidates)

                    _c1_unified = {
                        "computed": True,
                        "flag_state": UNIFIED_LEAD,
                        "winner": _c1_winner,
                        "candidates": _c1_candidates,
                        "losers": _c1_losers,
                        "weights_used": _weights_used,
                        "shipped_cluster": _shipped_cluster or None,
                        "shipped_title": (str((preselected or {}).get("title") or "")[:200] or None),
                        "shipped_in_audit": _shipped_in_audit,
                    }
                    try:
                        import lead_preselect as _lp_u
                        _lp_u._LAST_DECISION_LOG["unified"] = _c1_unified
                        # Keep the legacy flat keys for continuity with existing readers.
                        _u = _uni.get("unified") or {}
                        _lp_u._LAST_DECISION_LOG.update({
                            "unified_lead": UNIFIED_LEAD,
                            "unified_lead_title": str(_uni["article"].get("title") or "")[:200],
                            "unified_cluster": _uni["cluster_key"],
                            "unified_score": _uni.get("score"),
                            "unified_weights": _u.get("weights"),
                            "unified_winner": _uni.get("unified_winner"),
                            "unified_losers": _uni.get("unified_losers"),
                            "unified_candidates": _uni.get("unified_candidates"),
                            "unified_name_move_count": _u_name_calls,
                        })
                    except Exception:
                        pass
                    print(f"  🧭 [unified:{UNIFIED_LEAD}] argmax -> {_uni['cluster_key']}: "
                          f"{str(_uni['article'].get('title') or '')[:60]} "
                          f"(score={_uni.get('score')}; logged {len(_c1_candidates)} candidates)")

                    # ── SERVE: only when the flag is ON do we replace the shipped
                    # precedence pick with the unified argmax. OFF is shadow-only. ──
                    if UNIFIED_LEAD == "on":
                        _prev_title = str((preselected or {}).get("title") or "")[:200]
                        preselected = dict(_uni["article"])
                        preselected["_preselect_reason"] = f"unified:{_uni['cluster_key']}"
                        preselected["_impact_score"] = _uni.get("score")
                        preselected["_impact_breadth"] = _uni.get("breadth")
                        preselected["_impact_cluster"] = _uni["cluster_key"]
                        lead_source = "unified"
                        print(f"  ✅ [unified:on] SERVED lead -> {_uni['cluster_key']} "
                              f"(was: {_prev_title[:50]})")
            except Exception as _uerr:
                print(f"  ⚠ unified lead contest skipped (non-fatal, keeping precedence pick): {_uerr}")

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
                    # enrich=True: this hoisted fetch is threaded (via
                    # _materiality_tape -> tape_obj) into BOTH the pulse prose
                    # (generate_market_pulse) AND the persisted snapshot
                    # (serialize_tape_snapshot). Without enrich the rates / oil /
                    # sector-ETF prose from #463 silently degrades (dead path) and
                    # the snapshot omits enrichment. +13 bounded Yahoo GETs, no LLM.
                    #
                    # FREEZE DETECTOR WIRING (#467 was inert): read the prior DISTINCT
                    # session's persisted tape and hand it to fetch_tape so
                    # indices_frozen_suspect can fire. First-brief / missing-prior
                    # returns None -> no detection, which is correct (nothing to
                    # compare). Flag, do NOT fail: a freeze is a DATA ALARM for Noah,
                    # never a reason to kill the brief.
                    _prior_tape = _fetch_prior_session_tape(_et_session_date(_now))
                    _materiality_tape = market_tape.fetch_tape(
                        enrich=True, prior_session_tape=_prior_tape
                    )
                    _fs = (_materiality_tape or {}).get("frozen_suspect") or []
                    if _fs:
                        print(f"  🧊🚨 FROZEN-SUSPECT indices {_fs}: fetched level is identical "
                              f"to the prior session's persisted level to the penny - the index "
                              f"panel may be echoing a stale close. Carried on tape['frozen_suspect'] "
                              f"and persisted on the snapshot; brief NOT blocked (data alarm only).")
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
                            # Full ordered per-story ranking snapshot (capped in
                            # impact_ranking) so a rare material tape can be
                            # audited after the fact: where did each competing
                            # cluster rank, with BOTH impact + materiality scores
                            # and the reason strings. Winner-only scalars above
                            # lose the ordering; this preserves it.
                            "materiality_top_clusters": _mat.get("top_clusters"),
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
            # L3 (TICKERSCOPE): capture the shipped lead's anchor company + ticker at
            # preselect time. Additive jsonb, deterministic, no external API. NULL-safe:
            # anchor/ticker resolve to None on anything and the brief is unaffected.
            _anchor_name = None
            _lead_ticker = None
            try:
                _anchor_name = _preselect_anchor_name(preselected)
                _lead_ticker = _resolve_preselect_ticker(_anchor_name)
            except Exception:
                _anchor_name, _lead_ticker = None, None
            _lp._LAST_DECISION_LOG.update({
                "lead_source": lead_source,
                "impact_lead_title": (impact_pick.get("title") if impact_pick else None),
                "impact_lead_cluster": (impact_pick.get("_impact_cluster") if impact_pick else None),
                "impact_lead_score": (impact_pick.get("_impact_score") if impact_pick else None),
                "deal_lead_title": (deal_pick.get("title") if deal_pick else None),
                "impact_lead_anchor_name": _anchor_name,
                "impact_lead_ticker": _lead_ticker,
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
            # Shipped-path observability (see the decision-log write below): the
            # ACTUAL path the shipped hero took, and whether enrichment reached it.
            # Defaults describe the non-V2 / V2-off case; overwritten as the V2
            # block resolves. GREEN (pulse_v2_ok) is NOT the same as "rich hero
            # shipped": the old flags reported success even on a minimal ship.
            _pulse_shipped_path = "v2_off"
            _enrichment_in_shipped = False
            # Agent 1's canonical macro accessor (merge order 1 -> 2 -> 3 guarantees
            # released_macro_context exists after Agent 1 merges). Consumed by name
            # so the fallback can carry the day's macro catalyst. Soft-fail to None
            # until Agent 1 lands (or when the data layer is unreachable offline).
            # ONE shared macro object for the whole brief: the pulse AND the LEAD_V2
            # lead read the SAME today_catalyst and the SAME is_release_day flag out
            # of this single dict, so they cannot disagree on whether a macro print
            # is fresh-today or backdrop (the CPI-fresh-lead-over-no-fresh-catalyst-
            # pulse divergence). Built ONCE here; reused by both consumers below.
            _today_catalyst = None
            _shared_macro_ctx = None
            _macro_release_today = False
            try:
                _shared_macro_ctx = released_macro_context() or {}
                _today_catalyst = _shared_macro_ctx.get("today_catalyst")
                _macro_release_today = bool(_shared_macro_ctx.get("is_release_day"))
            except NameError:
                # Agent 1 not merged yet (pre-merge-order-1 window); no catalyst.
                _today_catalyst = None
                _macro_release_today = False
            except Exception as _rmc_e:
                print(f"  ⚠ released_macro_context read skipped (non-fatal): {_rmc_e}")
                _today_catalyst = None
                _macro_release_today = False
            if MARKET_PULSE_V2 and isinstance(_mp, dict):
                try:
                    _pulse_stories = _pulse_top_stories(spine, floor, _companies_of)
                    # Strip TEXT still comes from _pulse_macro_strip (formatting only);
                    # the release-day FLAG is the shared authoritative one above, NOT a
                    # second independent derivation.
                    _pulse_macro, _ = _pulse_macro_strip()
                    _prior_ctx = _fetch_prior_brief_lead()
                    _v2 = generate_market_pulse(
                        brief_type, tape_obj, _pulse_macro, _pulse_stories, prior_ctx=_prior_ctx,
                        macro_is_release_day=_macro_release_today,
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
                                prior_ctx=_prior_ctx, macro_is_release_day=_macro_release_today,
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
                                    tape_obj, (_lead_title or data.get("headline") or ""),
                                    today_catalyst=_today_catalyst,
                                    sentiment_word=(_mp or {}).get("sentiment_word"),
                                )
                                _pulse_v2_ok = False
                                _pulse_shipped_path = "minimal_template"
                                _enrichment_in_shipped = bool(
                                    overview_grounding._minimal_enrichment_bits(tape_obj)
                                    or _today_catalyst
                                )
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
                    # Enrichment-aware: forgives rates/oil/sector-ETF figures +
                    # sector labels the #461 enrichment sources, so enrichment
                    # prose is not force-failed into the minimal fallback.
                    _vres = _validate_pulse_grounding_enriched(
                        _candidate, tape_obj, _pulse_macro, _pulse_stories
                    )
                    # Deterministic breadth guard: a breadth assertion with NO breadth
                    # field in the tape is an unsupported claim (the "resilient breadth
                    # despite the small-cap underperformance" bug). Fold it into the
                    # grounding gate so the same re-ask + fallback path handles it.
                    _bviol = _pulse_breadth_violation(_candidate, tape_obj)
                    if _bviol:
                        print(f"  ⚠ pulse breadth violation (V2): unsupported breadth claim(s): {', '.join(_bviol)}")
                    # Deterministic sector-attribution guard (#461 proxy honesty): a
                    # sector asserted as a group-move subject with NO ETF attribution
                    # ('technology led') overstates the ETF-move proxy as sector-wide
                    # breadth. Same reassuring-direction failure as the breadth bug.
                    # Fold into the same re-ask + fallback path.
                    _sviol = _pulse_sector_attribution_violation(_candidate, tape_obj)
                    if _sviol:
                        print(f"  ⚠ pulse sector-attribution violation (V2): unattributed sector-breadth claim(s): {', '.join(_sviol)}")
                    if not _vres["ok"] or _bviol or _sviol:
                        for _r in _vres["reasons"]:
                            print(f"  ⚠ pulse grounding violation (V2): {_r}")
                        _v2re = generate_market_pulse(
                            brief_type, tape_obj, _pulse_macro, _pulse_stories,
                            prior_ctx=_prior_ctx, macro_is_release_day=_macro_release_today,
                        )
                        _reok = bool(
                            _v2re
                            and overview_grounding.validate_pulse_opening(
                                _v2re, _final_corpus_companies, brief_type)["ok"]
                            and _validate_pulse_grounding_enriched(
                                _v2re, tape_obj, _pulse_macro, _pulse_stories)["ok"]
                            and not _pulse_breadth_violation(_v2re, tape_obj)
                            and not _pulse_sector_attribution_violation(_v2re, tape_obj)
                        )
                        if _reok:
                            _candidate = _v2re
                            _pulse_shipped_path = "passing_reask"
                            _enrichment_in_shipped = _narrative_carries_enrichment(
                                _candidate, tape_obj, _today_catalyst
                            )
                            print("  [pulse grounding] re-ask resolved violations")
                        else:
                            # STRIP-OR-REPAIR before conceding to the minimal template:
                            # the gate is BINARY, so one bad clause nuked the entire
                            # enriched hero. Remove ONLY the offending sentence(s) from
                            # the primary V2 narrative and keep the rest, but ONLY ship
                            # it if the survivor re-passes the FULL gate. Fall to the
                            # minimal template only when the hero is unsalvageable (lead
                            # sentence is the violation, or the strip cannot clear the
                            # gate). Grounding is NOT weakened: the offending clause is
                            # dropped, never shipped.
                            _repaired, _dropped = _repair_pulse_hero(
                                _candidate, tape_obj, _pulse_macro, _pulse_stories,
                                _final_corpus_companies, brief_type,
                            )
                            if _repaired:
                                if _dropped:
                                    print("  [pulse grounding] strip-or-repair dropped clause(s): "
                                          + " | ".join(_dropped))
                                _candidate = _repaired
                                _pulse_shipped_path = "v2_repaired"
                                _enrichment_in_shipped = _narrative_carries_enrichment(
                                    _candidate, tape_obj, _today_catalyst
                                )
                                print("  [pulse grounding] strip-or-repair salvaged the V2 hero (offending clause removed, rest kept)")
                            else:
                                _candidate = overview_grounding.build_minimal_overview(
                                    tape_obj, _best_title, today_catalyst=_today_catalyst,
                                    sentiment_word=(_mp or {}).get("sentiment_word"),
                                )
                                _pulse_shipped_path = "minimal_template"
                                _enrichment_in_shipped = bool(
                                    overview_grounding._minimal_enrichment_bits(tape_obj)
                                    or _today_catalyst
                                )
                                print("  [pulse grounding] hero unsalvageable (lead-sentence violation or strip still fails gate); using minimal grounded template (enrichment- and macro-aware)")
                    else:
                        _pulse_shipped_path = "v2_primary"
                        _enrichment_in_shipped = _narrative_carries_enrichment(
                            _candidate, tape_obj, _today_catalyst
                        )
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
                                _pulse_shipped_path = "passing_reask"
                                _enrichment_in_shipped = _narrative_carries_enrichment(
                                    _candidate, tape_obj, _today_catalyst
                                )
                                print("  [grounding post-check] re-ask resolved all violations")
                            else:
                                _candidate = overview_grounding.build_minimal_overview(
                                    tape_obj, _best_title, today_catalyst=_today_catalyst,
                                    sentiment_word=(_mp or {}).get("sentiment_word"),
                                )
                                _pulse_shipped_path = "minimal_template"
                                _enrichment_in_shipped = bool(
                                    overview_grounding._minimal_enrichment_bits(tape_obj)
                                    or _today_catalyst
                                )
                                print("  [grounding post-check] re-ask still violating; using minimal grounded template (enrichment- and macro-aware)")
                        else:
                            _candidate = overview_grounding.build_minimal_overview(
                                tape_obj, _best_title, today_catalyst=_today_catalyst,
                                sentiment_word=(_mp or {}).get("sentiment_word"),
                            )
                            _pulse_shipped_path = "minimal_template"
                            _enrichment_in_shipped = bool(
                                overview_grounding._minimal_enrichment_bits(tape_obj)
                                or _today_catalyst
                            )
                            print("  [grounding post-check] re-ask failed; using minimal grounded template (enrichment- and macro-aware)")
                    elif _new:
                        _pulse_shipped_path = "monolith_rewrite"
                        _enrichment_in_shipped = _narrative_carries_enrichment(
                            _candidate, tape_obj, _today_catalyst
                        )
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

    # LEAD_V2 (default OFF): produce the Today's Lead block (lead_paragraph +
    # supporting_context, and the headline) from a dedicated focused call
    # (generate_lead_v2) and OVERWRITE the monolith's parsed lead fields HERE,
    # BEFORE the headline figure guard below, so the V2 headline is ALSO run
    # through that guard. Mirrors the MARKET_PULSE_V2 generate-then-overwrite
    # pattern. It CONSUMES Agent 1's released_macro_context() for macro recency +
    # the ranked stories for the primary story. When the flag is OFF this block is
    # skipped entirely and behavior is byte-identical to today (generate_lead_v2 is
    # never invoked). Soft-fail: on a miss the monolith lead is kept and the
    # existing chain (headline figure guard, temporal + prose guards) runs on it.
    # A deterministic anti-tautology post-check ('reflects investor caution ahead
    # of ...') gets ONE bounded re-ask before the overwrite commits.
    if LEAD_V2 and not brief_is_stub and isinstance(data, dict):
        try:
            _lead_stories = _pulse_top_stories(spine, floor, _companies_of)
            # Reuse the ONE shared macro object the pulse consumed (same
            # today_catalyst, same authoritative is_release_day flag) so pulse and
            # lead CANNOT disagree on CPI freshness. Fall back to a fresh fetch only
            # if the final-lead gate was skipped (var never set); the accessor is
            # deterministic for the day, so the flag is identical either way.
            try:
                _macro_ctx = _shared_macro_ctx if _shared_macro_ctx else released_macro_context()
            except NameError:
                _macro_ctx = released_macro_context()
            _lead_prior = _fetch_prior_brief_lead()
            _lv2 = generate_lead_v2(
                brief_type, tape_obj, _macro_ctx, _lead_stories, prior_ctx=_lead_prior
            )
            if _lv2:
                _lp = _lv2.get("lead_paragraph")
                _sc = _lv2.get("supporting_context")
                # Anti-tautology guard on the whole lead body: ONE bounded re-ask
                # if the move restates itself as its own cause. Keep V2 output if
                # the re-ask still tautologizes or fails (it is still real-why-ruled
                # and macro-recent); the monolith lead is the last resort.
                _lead_body = " ".join(x for x in (_lp, _sc) if isinstance(x, str))
                _taut = _lead_tautology_violation(_lead_body)
                if _taut:
                    print(f"  ⚠ LEAD_V2 tautology: move restates itself as cause: {', '.join(_taut)}")
                    _lv2r = generate_lead_v2(
                        brief_type, tape_obj, _macro_ctx, _lead_stories, prior_ctx=_lead_prior
                    )
                    if _lv2r:
                        _rbody = " ".join(
                            x for x in (_lv2r.get("lead_paragraph"), _lv2r.get("supporting_context"))
                            if isinstance(x, str)
                        )
                        if not _lead_tautology_violation(_rbody):
                            _lv2 = _lv2r
                            _lp = _lv2.get("lead_paragraph")
                            _sc = _lv2.get("supporting_context")
                            print("  [LEAD_V2] re-ask resolved the tautology")
                        else:
                            print("  ⚠ LEAD_V2: re-ask still tautologizes; keeping first V2 lead")
                    else:
                        print("  ⚠ LEAD_V2: re-ask failed; keeping first V2 lead")
                if isinstance(_lp, str) and _lp.strip():
                    data["lead_paragraph"] = _lp.strip()
                if isinstance(_sc, str) and _sc.strip():
                    data["supporting_context"] = _sc.strip()
                _hl2 = _lv2.get("headline")
                if isinstance(_hl2, str) and _hl2.strip():
                    data["headline"] = _hl2.strip()
                print("  ✨ LEAD_V2: dedicated real-why + macro-recency lead wired in")
        except Exception as e:
            print(f"  ⚠ LEAD_V2 wire-in skipped (non-fatal): {e}")

    # Headline figure guard (non-fatal). The V2 pulse figure guard covers the
    # narrative but NOT the lead HEADLINE, where an unsourced "$3 Billion" has
    # shipped. Every figure in the generated headline must trace to the corpus
    # text or the tape. On a violation, ONE bounded re-ask drops/fixes the
    # unsourced figure; if the re-ask still carries an unsourced figure (or
    # fails), keep the original headline and log (never ship a garbled headline).
    if not brief_is_stub:
        try:
            _hl = data.get("headline")
            if isinstance(_hl, str) and _hl.strip():
                _hbad = _headline_unsourced_figures(_hl, article_text, tape_obj)
                if _hbad:
                    print(f"  ⚠ headline figure guard: unsourced figure(s): {', '.join(_hbad)}")
                    _new_hl = _reask_headline_drop_unsourced(_hl, _hbad, article_text, tape_obj)
                    if _new_hl and not _headline_unsourced_figures(_new_hl, article_text, tape_obj):
                        data["headline"] = _new_hl
                        print("  [headline figure guard] re-ask dropped the unsourced figure")
                    elif _new_hl:
                        print("  ⚠ headline figure guard: re-ask still unsourced; keeping original headline")
                    else:
                        print("  ⚠ headline figure guard: re-ask failed; keeping original headline")
        except Exception as e:
            print(f"  ⚠ headline figure guard error (non-fatal): {e}")

    # Lead-thesis opener guard (morning + evening, non-fatal). The narrative's
    # opening sentence is the most visible line in the product and reliably
    # regresses to a mood / index recap. Detect it and do ONE targeted re-ask
    # that rewrites the narrative only, leading with a named driver; keep the
    # original and log if the re-ask still recaps or fails. See helper block.
    #
    # V2 GATE (mirrors the rewrite gate at "if MARKET_PULSE_V2 and _pulse_v2_ok"
    # above): when the dedicated V2 pulse PRODUCED and VALIDATED a tape-first
    # narrative, its opening is intentionally the index-level market read, which
    # _is_opener_recap flags as a "market-subject" recap and _regenerate_opener
    # would then re-ask to lead with a NAMED DRIVER - the exact inverse of the V2
    # tape-first contract, clobbering the hero (observed on the 2026-07-13 evening
    # brief: rates/oil/sector dropped, a penny stock led). Same clobber class as
    # the market-wide rewrite, which is already V2-gated. Skip the opener guard on
    # the V2-OK path; it still does its job on the NON-V2 (monolith) path.
    _pulse_v2_shipped = bool(MARKET_PULSE_V2 and locals().get("_pulse_v2_ok"))
    # Per-run observability: whether V2 was ON and whether it validated (_pulse_v2_ok).
    # Recorded into lead_preselect._LAST_DECISION_LOG (additive key), which run.py
    # snapshots into pipeline_runs.preselect_decision on the OBSERVE step - no edit
    # to that write path required. The 07-13 recon could not confirm from the DB
    # whether the flag was even on; this closes that blind spot.
    print(
        f"  [opener guard] MARKET_PULSE_V2={'on' if MARKET_PULSE_V2 else 'off'} "
        f"_pulse_v2_ok={'yes' if locals().get('_pulse_v2_ok') else 'no'} "
        f"(opener guard {'SKIPPED (V2 tape-first hero preserved)' if _pulse_v2_shipped else 'active'})"
    )
    try:
        import lead_preselect as _lp_v2flag
        _lp_v2flag._LAST_DECISION_LOG.update({
            "market_pulse_v2_on": bool(MARKET_PULSE_V2),
            "pulse_v2_ok": bool(locals().get("_pulse_v2_ok")),
            "opener_guard_skipped_v2": _pulse_v2_shipped,
        })
    except Exception as _ve:
        print(f"  ⚠ opener guard: V2-flag decision-log capture skipped (non-fatal): {_ve}")
    if not brief_is_stub:
        try:
            mp = data.get("market_pulse")
            if isinstance(mp, dict) and isinstance(mp.get("narrative"), str) and mp["narrative"].strip():
                fs = _opener_first_sentence(mp["narrative"])
                recap, why = _is_opener_recap(fs)
                # V2 GATE: the opener-recap re-ask is the confirmed clobber. Skip it
                # (only it) when the V2 tape-first pulse shipped; the V2 opening IS
                # the intended index-level market read, not a banned recap.
                if recap and not _pulse_v2_shipped:
                    new_narr = _regenerate_opener(data, tape_regime, brief_type)
                    if new_narr and not _is_opener_recap(_opener_first_sentence(new_narr))[0]:
                        mp["narrative"] = new_narr
                        _pulse_shipped_path = "opener_regenerated"
                        _enrichment_in_shipped = _narrative_carries_enrichment(
                            new_narr, tape_obj, locals().get("_today_catalyst")
                        )
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

    # ── Shipped-path observability (placed AFTER the opener/redundancy guards so
    # it captures a late opener_regenerated swap) ────────────────────────────────
    # The 07-14 blind spot: pulse_v2_ok/opener_guard_skipped_v2 BOTH reported
    # success while the STRIPPED minimal_template shipped (the enriched V2 hero was
    # grounding-rejected on a bad entity, the re-ask failed, and the fallback
    # nuked rates/oil/sector). pulse_v2_ok reflects the OPENING check, not the
    # narrative that actually shipped, so the DB could not tell a rich hero from a
    # bare template. These two fields record the ACTUAL shipped path and whether
    # enrichment reached the shipped string. IMPORTANT (say it out loud): the
    # deterministic fallback is now enrichment-complete, but it is NOT a license to
    # stop shipping the real V2 primary. A rising `pulse_shipped_path=minimal_template`
    # rate is a REGRESSION signal; this flag exists so that stays visible on the DB.
    _shipped_path = locals().get("_pulse_shipped_path", "v2_off")
    _enrich_shipped = bool(locals().get("_enrichment_in_shipped"))
    print(
        f"  [shipped-path] pulse_shipped_path={_shipped_path} "
        f"enrichment_in_shipped={'yes' if _enrich_shipped else 'no'}"
    )
    try:
        import lead_preselect as _lp_shipped
        _lp_shipped._LAST_DECISION_LOG.update({
            "pulse_shipped_path": _shipped_path,
            "enrichment_in_shipped": _enrich_shipped,
        })
    except Exception as _se:
        print(f"  ⚠ shipped-path decision-log capture skipped (non-fatal): {_se}")

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

    # Evening section routing / cross-section dedup (deterministic, non-fatal).
    # Sections are LLM-assigned with no other router; this backstops two observed
    # misroute/duplicate modes (legal ruling in macro_and_rates; a corporate M&A
    # story headlining geopolitics while also living in a more-specific section).
    # Evening-only: the morning schema uses the same keys but was not implicated.
    if brief_type == "evening" and isinstance(data.get("sections"), dict):
        try:
            _fixed_sections, _routing_notes = _evening_section_routing_fixup(data["sections"])
            if _routing_notes:
                data["sections"] = _fixed_sections
                for _n in _routing_notes:
                    print(f"  ↳ section routing: {_n}")
        except Exception as e:
            print(f"  ⚠ section routing fixup error (non-fatal): {e}")

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

    # Move 1 (flag-gated, additive): build the shared story_items payload from
    # the already-selected spine/floor. None when PERSONALIZATION_MODE=off, so
    # the insert path below stays byte-identical to before in the default case.
    _story_items = (
        _build_story_items(spine, floor)
        if PERSONALIZATION_MODE in ("shadow", "active")
        else None
    )

    insert_resp = None
    if extras or _story_items is not None:
        row_with_extras = {**row, **extras}
        # Ordered insert candidates: with-tape (best), extras-only (existing
        # behavior, preserves market_pulse if the tape column is absent), base.
        # market_tape is a JSONB column, so pass the native dict (NOT json.dumps):
        # a json-string would be stored as a jsonb string scalar and `->`/`->>`
        # could not key into it. The dict is stored as a queryable jsonb object.
        _candidates = []
        if _story_items is not None:
            # Richest attempt: base + extras + tape (if any) + story_items.
            # story_items is a new nullable jsonb column; if it is not yet
            # migrated this candidate raises and the ladder falls through to the
            # tape / extras / base attempts, so the brief is never lost.
            _best = {**row_with_extras}
            if _tape_snapshot is not None:
                _best["market_tape"] = _tape_snapshot
            _candidates.append({**_best, "story_items": _story_items})
        if _tape_snapshot is not None:
            _candidates.append({**row_with_extras, "market_tape": _tape_snapshot})
        _candidates.append(row_with_extras)
        _candidates.append(row)
        _last_err = None
        for _cand in _candidates:
            try:
                insert_resp = supabase.table("briefings").insert(_cand).execute()
                if "story_items" in _cand:
                    print(f"  ✨ story_items saved: {len(_story_items)} stories (mode={PERSONALIZATION_MODE})")
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
                    # Contract C2: the SHIPPED lead is the final served headline.
                    shipped_lead_title=data.get("headline", ""),
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
