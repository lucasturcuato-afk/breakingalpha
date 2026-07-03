"use client";

/**
 * ToneEvidenceList (WD110 Element 3, re-scoped 2026-06-03) -- compact
 * "Behind this tone" list rendered directly under the ToneReadout on the
 * Price & Tone tab. One row per article in the SAME trailing 7-day window the
 * tone level is computed from (src/lib/tone.ts TONE_WINDOW), so the rows are
 * the evidence the headline level claims. Click opens ToneArticleDetail with
 * the WD49 sentiment_reason front and center.
 *
 * Rows arrive relevance-desc from getCompanyDetail, so the top row is the
 * highest-signal event of the window -- the "what should I look at first"
 * answer for surveillance users.
 */

import { useState } from "react";

import { SentimentPill, type SentimentTone } from "@/components/ui/sentiment-pill";
import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";
import { ToneArticleDetail } from "./ToneArticleDetail";

/** Mirrors TONE_WINDOW_MS in getCompanyDetail.ts (trailing 7 days). */
const WINDOW_MS = 7 * 86_400_000;
const MAX_ROWS = 5;

const TONE_MAP: Record<string, SentimentTone> = {
  bullish: "BULLISH",
  bearish: "BEARISH",
  neutral: "NEUTRAL",
};

function toTone(s: string | null): SentimentTone {
  return TONE_MAP[(s ?? "").toLowerCase()] ?? "NEUTRAL";
}

function formatAge(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export interface ToneEvidenceListProps {
  articles: CompanyDetailArticle[];
}

export function ToneEvidenceList({ articles }: ToneEvidenceListProps) {
  const [selected, setSelected] = useState<CompanyDetailArticle | null>(null);
  // Per-mount snapshot (lazy init) keeps render pure for the React Compiler;
  // the article set is server-fetched per request, so a fresher clock than
  // "time of mount" buys nothing.
  const [cutoff] = useState(() => Date.now() - WINDOW_MS);
  const inWindow = articles.filter((a) => {
    if (!a.publishedAt) return false;
    const t = Date.parse(a.publishedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
  const rows = inWindow.slice(0, MAX_ROWS);
  const overflow = inWindow.length - rows.length;

  if (rows.length === 0) return null;

  return (
    <div data-testid="tone-evidence-list" className="mt-3">
      <div className="font-sans text-[10px] font-semibold text-text-muted">
        Behind this tone
      </div>
      <ul className="border-border-subtle mt-1.5 divide-y divide-[var(--border-subtle)] border-y">
        {rows.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              data-testid="tone-evidence-row"
              onClick={() => setSelected(a)}
              className="flex w-full items-baseline gap-2.5 px-1 py-[7px] text-left transition-colors hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm cursor-pointer"
            >
              <SentimentPill tone={toTone(a.sentiment)} size="xs" />
              <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-text-primary">
                {a.title || "Untitled"}
              </span>
              <span className="flex-shrink-0 font-data text-[10px] text-text-faint">
                {formatAge(a.publishedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <div className="mt-1.5 font-sans text-[10.5px] text-text-faint">
          +{overflow} more this week in the Articles tab
        </div>
      ) : null}

      {selected ? (
        <ToneArticleDetail article={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
