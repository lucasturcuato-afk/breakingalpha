"use client";

/**
 * CompanyDetailHeader (PR-B1) -- docs/DirectionD.jsx lines 528-579.
 * Watchlist toggle mirrors company-detail-client.tsx (53-134) without
 * importing Lucas-protected helpers. Memo button fires window event;
 * MemoModal mount lands in a later PR.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SentimentPill, type SentimentTone } from "@/components/ui";
import type { CompanyDetail } from "@/lib/data-access/getCompanyDetail";
import { formatEvidence, levelPolarity, type ToneSummary } from "@/lib/tone";

const PENDING = "__pending__";
const SANS = "var(--font-inter), Inter, sans-serif";

const btnBase = { fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 6 } as const;
const btnSecondary = { ...btnBase, background: "var(--cream)", border: "1px solid var(--border-base)", color: "var(--espresso)" } as const;
const btnPrimary = { ...btnBase, background: "var(--gold-deep)", border: "1px solid var(--gold-deep)", color: "var(--cream)", cursor: "pointer" } as const;

interface Props {
  detail: CompanyDetail;
  /**
   * Which heading element carries the company name. Defaults to h1, which is
   * what production renders: with the mobile fixture gate SHUT this component
   * is the only heading on the route and nothing about it changes.
   *
   * With the gate OPEN, `/company/[id]` server-renders both trees and the
   * mobile screen carries its own h1. Only one is ever visible and
   * `display:none` already keeps assistive tech to one, but the document
   * outline sees both. The mobile screen keeps h1, because that is the one a
   * mobile reader's assistive tech can actually reach; this one steps down to
   * h2 on that path only.
   */
  titleAs?: "h1" | "h2";
}

// Pill color follows tone polarity; the pill text carries the full level label
// (e.g. "Strongly Positive"). Insufficient coverage shows a neutral pill.
function pillToneFor(t: ToneSummary): SentimentTone {
  if (!t.level) return "NEUTRAL";
  const p = levelPolarity(t.level);
  return p === "positive" ? "BULLISH" : p === "negative" ? "BEARISH" : "MIXED";
}

function formatSubtitle(d: CompanyDetail): string {
  const sector = d.sector ?? "--";
  return d.ticker ? `NASDAQ · ${sector}` : sector;
}

export function CompanyDetailHeader({ detail, titleAs: Title = "h1" }: Props) {
  const [entryId, setEntryId] = useState<string | null>(null);
  const isOn = entryId !== null;
  const pending = entryId === PENDING;
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        if (!res.ok) return;
        const json = (await res.json()) as { entries?: Array<{ id: string; identifier: string; type: string }> };
        if (cancelled) return;
        const target = detail.canonical.toLowerCase();
        const match = (json.entries ?? []).find((e) => e.type === "company" && e.identifier.toLowerCase() === target);
        setEntryId(match?.id ?? null);
      } catch { /* soft-fail: button defaults to Add */ }
    })();
    return () => { cancelled = true; };
  }, [detail.canonical]);

  const onToggle = useCallback(async () => {
    if (inFlight.current || entryId === PENDING) return;
    inFlight.current = true;
    const prev = entryId;
    setEntryId(prev ? null : PENDING);
    try {
      if (prev && prev !== PENDING) {
        const res = await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: prev }),
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      } else {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: detail.canonical, type: "company", display_name: detail.display }),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const json = (await res.json()) as { entry?: { id: string } };
        if (json.entry?.id) setEntryId(json.entry.id);
      }
      window.dispatchEvent(new Event("watchlist:changed"));
    } catch (e) {
      console.error("Watchlist toggle failed:", e);
      setEntryId(prev);
    } finally {
      inFlight.current = false;
    }
  }, [detail.canonical, detail.display, entryId]);

  const onGenerateMemo = useCallback(() => {
    window.dispatchEvent(new CustomEvent("memo:generate", { detail: { canonical: detail.canonical } }));
  }, [detail.canonical]);

  const tone = detail.tone;
  const initial = (detail.display.charAt(0) || "?").toUpperCase();
  const exportHref = `/api/export/company-pdf?identifier=${encodeURIComponent(detail.canonical)}`;

  return (
    <header
      data-testid="company-header"
      className="rounded-md"
      style={{ background: "var(--cream-hi)", border: "1px solid var(--border-base)", padding: "16px 18px" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          data-testid="company-header-logo"
          className="font-display"
          style={{
            width: 44, height: 44, borderRadius: 8, flexShrink: 0,
            background: "var(--cream)", border: "1px solid var(--gold-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 700, color: "var(--gold-deep)", textTransform: "uppercase",
          }}
        >
          {initial}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Title
              className="font-display"
              style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.015em", color: "var(--espresso)" }}
            >
              {detail.display}
            </Title>
            {detail.ticker ? (
              <span
                data-testid="company-header-ticker"
                className="font-data"
                style={{
                  fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                  padding: "2px 7px", borderRadius: 3,
                  background: "var(--cream)", border: "1px solid var(--border-base)",
                }}
              >
                {detail.ticker}
              </span>
            ) : null}
            <span
              data-testid="company-header-subtitle"
              style={{ fontFamily: SANS, fontSize: 12, color: "var(--text-muted)" }}
            >
              {formatSubtitle(detail)}
            </span>
            <SentimentPill
              tone={pillToneFor(tone)}
              label={tone.sufficient ? tone.levelLabel : "Limited coverage"}
              size="sm"
              testId="company-header-sentiment-pill"
            />
            {tone.sufficient ? (
              <span
                data-testid="company-header-tone-evidence"
                style={{ fontFamily: SANS, fontSize: 10, color: "var(--text-faint)" }}
              >
                {formatEvidence(tone.evidence)}
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            data-testid="watchlist-toggle-btn"
            aria-pressed={isOn}
            aria-label={isOn ? "Remove from watchlist" : "Add to watchlist"}
            disabled={pending}
            onClick={onToggle}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            style={{ ...btnSecondary, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
          >
            {isOn ? "On Watchlist" : "+ Watchlist"}
          </button>
          <a
            data-testid="export-btn"
            href={exportHref}
            aria-label="Export company report as PDF"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            style={{ ...btnSecondary, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Export
          </a>
          <button
            type="button"
            data-testid="generate-memo-btn"
            aria-label="Generate research memo"
            onClick={onGenerateMemo}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            style={btnPrimary}
          >
            Generate Memo
          </button>
        </div>
      </div>
    </header>
  );
}
