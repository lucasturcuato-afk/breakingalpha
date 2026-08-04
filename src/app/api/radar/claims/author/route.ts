import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Claim authoring: free-text intent -> ONE bounded LLM call -> a proposed
 * trackable reduction the user confirms or tweaks. Nothing is persisted
 * here; the confirmed proposal is POSTed to /api/radar/claims.
 *
 * Honesty rules enforced here:
 *  - The user's words are NEVER rewritten. This route returns only the
 *    standardized resolution beneath them; the client keeps user_claim
 *    verbatim as the headline.
 *  - v1 resolution method is price_attribution ONLY. Anything that does
 *    not reduce to a direction on a priceable entity within a bounded
 *    window comes back gradeable=false with an honest gradeability_note
 *    (tracked as context, never given a fake verdict).
 *  - confidence_in_reduction is the model's confidence that the
 *    REDUCTION is faithful. It never influences grading and is never
 *    shown as a probability of the call being right.
 */

const MAX_CLAIM_CHARS = 400;
const MAX_WINDOW_DAYS = 90;

const CLAIM_TYPES = ["ticker", "sector", "index", "aggregate", "other"] as const;
const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;

interface AuthorProposal {
  claim_type: (typeof CLAIM_TYPES)[number];
  target_symbol: string | null;
  expected_direction: (typeof DIRECTIONS)[number] | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  evidence_entities: string[];
  gradeable: boolean;
  gradeability_note: string | null;
  confidence_in_reduction: number | null;
  /**
   * When the claim as written is not price-gradeable, a concrete
   * gradeable proxy reduction (specific ticker/ETF + direction +
   * bounded window that captures the intent), offered as a one-tap
   * "Make it gradeable" option. Null when nothing priceable honestly
   * fits. Never replaces the user's words; only the resolution.
   */
  gradeable_alternative: {
    claim_type: (typeof CLAIM_TYPES)[number];
    target_symbol: string;
    expected_direction: (typeof DIRECTIONS)[number];
    resolution_window_start: string;
    resolution_window_end: string;
    rationale: string;
  } | null;
}

function authoringPrompt(claimText: string, todayIso: string): string {
  return `You reduce a user's market claim to a standardized, honestly gradeable resolution method. Today is ${todayIso}.

The user's claim (their words, which will be preserved verbatim elsewhere; do NOT rewrite it):
"""${claimText}"""

Our only v1 grading method is price attribution: after a bounded window closes, the named entity's price move is compared against its sector ETF and SPY; only a move meaningfully beyond both benchmarks in the predicted direction counts. Claims are gradeable ONLY if they reduce to:
- a single priceable entity (a stock ticker, a sector, or a broad index),
- a clear direction (bullish / bearish / neutral),
- a bounded window ending no more than ${MAX_WINDOW_DAYS} days from today (window_end strictly after today).

INFER the window length from the claim's nature; do not default to one size, and do not compress a long-dated thesis into a short window just to resolve it sooner. A reaction to a discrete, already-dated event (an earnings print, an announced deal closing, a scheduled decision) resolves fast: 1-3 days. A single-name move driven by fresh news flow needs about a week: 5-10 days. A sector rotation or thematic move needs 14-30 days. A genuinely structural thesis (a multi-quarter capex cycle, a regulatory regime change, a secular demand shift, or any claim whose own language says "over the next few months", "this year", "long term") needs 45-${MAX_WINDOW_DAYS} days. When the claim names its own horizon, use that (clamped to ${MAX_WINDOW_DAYS} days). Grading scales its bar with the window (roughly sqrt of the session count), so a long window is honestly gradeable and is the right answer for a long-dated claim.

If the claim is about earnings beats, economic data, discrete events, private companies, crypto without an obvious listed proxy the user named, or has no bounded horizon, it is NOT gradeable in v1 AS WRITTEN: set gradeable=false and write a plain, honest gradeability_note saying what we'd need to grade it. Do not force a price reduction onto a claim that is not a price claim.

WHEN gradeable=false, also try to propose gradeable_alternative: the closest honest PRICE proxy that captures the claim's intent, as a specific listed ticker, sector, or index ETF plus a clear direction and a bounded window (<= ${MAX_WINDOW_DAYS} days). Examples: an industrial-policy claim -> XLI; an "AI capex" claim -> a named beneficiary or SMH; a rates claim -> TLT direction. Include a one-sentence rationale for why the proxy captures the intent. If no listed proxy honestly captures it, set gradeable_alternative to null; never invent a stretch.

Respond with ONLY a JSON object, no markdown fence:
{
  "claim_type": "ticker" | "sector" | "index" | "aggregate" | "other",
  "target_symbol": string | null,        // ticker symbol, sector name, or index symbol
  "expected_direction": "bullish" | "bearish" | "neutral" | null,
  "resolution_window_start": "YYYY-MM-DD" | null,  // usually today
  "resolution_window_end": "YYYY-MM-DD" | null,
  "evidence_entities": string[],         // entities the claim references
  "gradeable": boolean,
  "gradeability_note": string | null,    // required when gradeable=false
  "confidence_in_reduction": number,     // 0-1, your confidence the reduction faithfully captures the claim
  "gradeable_alternative": {             // only when gradeable=false and an honest proxy exists; else null
    "claim_type": "ticker" | "sector" | "index",
    "target_symbol": string,
    "expected_direction": "bullish" | "bearish" | "neutral",
    "resolution_window_start": "YYYY-MM-DD",
    "resolution_window_end": "YYYY-MM-DD",
    "rationale": string                  // one sentence: why this proxy captures the intent
  } | null
}`;
}

function validateProposal(raw: unknown, todayIso: string): AuthorProposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;

  const claimType = CLAIM_TYPES.includes(p.claim_type as never)
    ? (p.claim_type as AuthorProposal["claim_type"])
    : "other";
  const direction = DIRECTIONS.includes(p.expected_direction as never)
    ? (p.expected_direction as AuthorProposal["expected_direction"])
    : null;

  const isoDate = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  let windowStart = isoDate(p.resolution_window_start);
  let windowEnd = isoDate(p.resolution_window_end);

  let gradeable = p.gradeable === true;
  let note =
    typeof p.gradeability_note === "string" && p.gradeability_note.trim()
      ? p.gradeability_note.trim()
      : null;

  // Server-side gradeability enforcement, independent of the model.
  if (gradeable) {
    const symbol = typeof p.target_symbol === "string" ? p.target_symbol.trim() : "";
    const endsAfterToday = windowEnd !== null && windowEnd > todayIso;
    const withinMax =
      windowEnd !== null &&
      (new Date(windowEnd).getTime() - new Date(todayIso).getTime()) / 86400_000 <=
        MAX_WINDOW_DAYS;
    const priceable = claimType === "ticker" || claimType === "sector" || claimType === "index";
    if (!symbol || !direction || !endsAfterToday || !withinMax || !priceable) {
      gradeable = false;
      note =
        note ??
        "Could not reduce this to a priceable entity, a clear direction, and a bounded window; tracked as context only.";
    }
  }
  if (!gradeable && !note) {
    note = "Not price-gradeable in v1; tracked as context only.";
  }
  if (!gradeable) {
    windowStart = windowStart ?? null;
    windowEnd = windowEnd ?? null;
  } else if (!windowStart || windowStart > windowEnd!) {
    windowStart = todayIso;
  }

  const conf =
    typeof p.confidence_in_reduction === "number" &&
    p.confidence_in_reduction >= 0 &&
    p.confidence_in_reduction <= 1
      ? Math.round(p.confidence_in_reduction * 100) / 100
      : null;

  // Validate the gradeable alternative with the SAME server-side rules;
  // a proxy that fails them is dropped, never softened.
  let alternative: AuthorProposal["gradeable_alternative"] = null;
  if (!gradeable && typeof p.gradeable_alternative === "object" && p.gradeable_alternative !== null) {
    const alt = p.gradeable_alternative as Record<string, unknown>;
    const altType = alt.claim_type as AuthorProposal["claim_type"];
    const altSymbol = typeof alt.target_symbol === "string" ? alt.target_symbol.trim() : "";
    const altDir = DIRECTIONS.includes(alt.expected_direction as never)
      ? (alt.expected_direction as (typeof DIRECTIONS)[number])
      : null;
    const altStart = isoDate(alt.resolution_window_start) ?? todayIso;
    const altEnd = isoDate(alt.resolution_window_end);
    const altRationale = typeof alt.rationale === "string" ? alt.rationale.trim() : "";
    const altWindowOk =
      altEnd !== null &&
      altEnd > todayIso &&
      (new Date(altEnd).getTime() - new Date(todayIso).getTime()) / 86400_000 <= MAX_WINDOW_DAYS;
    if (
      ["ticker", "sector", "index"].includes(altType) &&
      altSymbol &&
      altDir &&
      altWindowOk &&
      altRationale
    ) {
      alternative = {
        claim_type: altType,
        target_symbol: altSymbol,
        expected_direction: altDir,
        resolution_window_start: altStart <= altEnd! ? altStart : todayIso,
        resolution_window_end: altEnd!,
        rationale: altRationale,
      };
    }
  }

  return {
    claim_type: claimType,
    target_symbol:
      typeof p.target_symbol === "string" && p.target_symbol.trim()
        ? p.target_symbol.trim()
        : null,
    expected_direction: direction,
    resolution_window_start: windowStart,
    resolution_window_end: windowEnd,
    evidence_entities: Array.isArray(p.evidence_entities)
      ? p.evidence_entities.filter((e): e is string => typeof e === "string").slice(0, 8)
      : [],
    gradeable,
    gradeability_note: note,
    confidence_in_reduction: conf,
    gradeable_alternative: alternative,
  };
}

export async function POST(request: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { claim_text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const claimText = (body.claim_text ?? "").trim();
  if (!claimText) {
    return NextResponse.json({ error: "claim_text required" }, { status: 400 });
  }
  if (claimText.length > MAX_CLAIM_CHARS) {
    return NextResponse.json(
      { error: `claim_text over ${MAX_CLAIM_CHARS} characters` },
      { status: 400 },
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = authoringPrompt(claimText, todayIso);

  let rawText: string | undefined;
  try {
    // ONE bounded call: strong model first, flash fallback.
    try {
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      rawText = completion.text;
    } catch {
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      rawText = completion.text;
    }
  } catch (err) {
    console.error("[claims/author] LLM call failed:", err);
    return NextResponse.json(
      { error: "Could not analyze the claim right now." },
      { status: 502 },
    );
  }

  let proposal: AuthorProposal | null = null;
  try {
    proposal = validateProposal(JSON.parse(rawText ?? ""), todayIso);
  } catch {
    proposal = null;
  }
  if (!proposal) {
    return NextResponse.json(
      { error: "Could not reduce the claim to a proposal." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    // The user's words, untouched, echoed back as the headline.
    user_claim: claimText,
    proposal,
  });
}
