/**
 * POST /api/financials-commentary
 *
 * Generates SHORT descriptive commentary on a company's OWN reported financials.
 * Input is strictly that company's validated XBRL (financial_facts_latest, via
 * fetchCompanyFinancials); no web pool, no news, no cross-company data ever
 * enters the prompt (see assembleXbrlInput). The output is descriptive, never
 * prescriptive: figures and own-history deltas only, no valuation, no
 * recommendation, no security judgment.
 *
 * Two-layer compliance: the prompt (financials-commentary.ts) asks for
 * descriptive-only prose, and the response is run through
 * compliance-language-filter.ts as the POST-GENERATION BACKSTOP that actually
 * holds -- offending sentences are stripped before anything is returned.
 *
 * Two-layer accuracy, on the same pattern and for a separate failure: multi-
 * period arithmetic is computed in code (financials-derived-facts.ts) and given
 * to the model as a closed list, then multi-period-claim-validator.ts strips any
 * streak, extreme, or first the model asserted outside that list. A fabricated
 * streak is compliant prose, so the compliance filter cannot catch it.
 *
 * Default OFF: gated on FINANCIALS_COMMENTARY_ENABLED === "true" (server env,
 * not in the schedule, not exposed to the client bundle). Absent the override
 * this returns 503 and prod is unchanged on merge. No caching / no writes: the
 * feature is on-demand behind a flag.
 *
 * Scope fence: this route does not touch the web-fallback route, the thin-pool
 * gate, or the web-memo path.
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

import { getSupabaseWithUser } from "@/lib/supabase-server";
import { fetchCompanyFinancials } from "@/lib/financial-facts";
import {
  assembleXbrlInput,
  buildCommentaryPrompt,
  sanitizeCommentary,
  COMMENTARY_DISCLAIMER,
} from "@/lib/financials-commentary";
import { filterComplianceLanguage } from "@/lib/compliance-language-filter";
import { computeDerivedFacts } from "@/lib/financials-derived-facts";
import { validateMultiPeriodClaims } from "@/lib/multi-period-claim-validator";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function commentaryEnabled(): boolean {
  return process.env.FINANCIALS_COMMENTARY_ENABLED === "true";
}

export async function POST(request: NextRequest) {
  // Flag gate first: dormant by default, prod unchanged on merge.
  if (!commentaryEnabled()) {
    return NextResponse.json({ error: "feature disabled" }, { status: 503 });
  }

  // Auth gate (mirrors the other company routes; the page is already gated).
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { company?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const company = (body.company ?? "").trim();
  if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

  // Generator input is the company's OWN XBRL, re-fetched server-side. Nothing
  // else is assembled into the prompt.
  const financials = await fetchCompanyFinancials(supabase, { name: company });
  const xbrlBlock = assembleXbrlInput(company, financials);
  if (!xbrlBlock) {
    return NextResponse.json({
      commentary: "",
      empty: true,
      disclaimer: COMMENTARY_DISCLAIMER,
    });
  }

  const { system, user: userPrompt } = buildCommentaryPrompt(xbrlBlock);
  let raw = "";
  try {
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: system,
        temperature: 0.2,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    raw = completion.text ?? "";
  } catch (e) {
    console.warn("[financials-commentary] generation failed (non-fatal):", e);
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }

  // Sanitize, then apply the compliance backstop: strip any sentence that
  // carries valuation / recommendation / verdict / peer / price-target language.
  const sanitized = sanitizeCommentary(raw);
  const filtered = filterComplianceLanguage(sanitized);

  // Then the accuracy backstop. Compliance and truth are different failures: a
  // fabricated streak reads as clean descriptive prose, so it survives the
  // filter above and has to be checked against arithmetic computed in code.
  const derivedFacts = computeDerivedFacts(financials);
  const verified = validateMultiPeriodClaims(filtered.clean, derivedFacts);
  if (verified.blocked) {
    console.warn(
      "[financials-commentary] stripped unverified multi-period claim(s):",
      verified.findings.map((f) => `${f.reason} :: ${f.sentence}`),
    );
  }

  return NextResponse.json({
    commentary: verified.clean,
    disclaimer: COMMENTARY_DISCLAIMER,
    // Surfaced for observability; the UI does not need to render these.
    filtered: filtered.blocked,
    removedCount: filtered.findings.length,
    unverifiedClaims: verified.blocked,
    unverifiedCount: verified.findings.length,
    empty: verified.clean.length === 0,
  });
}
