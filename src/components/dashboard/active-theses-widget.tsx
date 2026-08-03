"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { neutralizeThesisTitle } from "@/lib/track-record-live-score";

/**
 * ActiveThesesWidget — the right-panel "Active Theses" strip on the brief
 * pages, wired to REAL theses.
 *
 * It previously took an optional `theses` prop with three HARDCODED defaults
 * ("AI Infra Consolidation Wave", "China Tech Regulatory Reset", "Commercial
 * RE Distress Cycle") whose ids were the strings "1", "2", "3". Neither brief
 * page passed the prop, so both shipped fabricated theses linking to
 * /radar/calls?thesis=1 -- ids that match nothing. The dashboard copy of this
 * problem was removed in #541; this is the same fix for the brief pages.
 *
 * Vocabulary note: theses are evidence-judged, never price-graded, so this
 * surface never uses the Right/Wrong scored-call language. It shows only the
 * sector and the neutralized title -- /api/theses does not return live_verdict,
 * and inventing a leaning here would be the same class of error this widget is
 * being fixed for.
 */

interface ThesisRow {
  id: string;
  title: string;
  sector: string | null;
  conviction: string | null;
}

export function ActiveThesesWidget() {
  // undefined = loading
  const [theses, setTheses] = useState<ThesisRow[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/theses");
        if (!res.ok) throw new Error(`theses request failed: ${res.status}`);
        const json = await res.json();
        if (!json.theses || !Array.isArray(json.theses)) {
          throw new Error("theses response missing the theses array");
        }
        if (!cancelled) setTheses(json.theses.slice(0, 3) as ThesisRow[]);
      } catch {
        // A failed load is not an empty board; say so rather than showing
        // nothing and implying the pipeline produced nothing.
        if (!cancelled) {
          setFailed(true);
          setTheses([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (theses === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-parchment-mid/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic leading-snug">
        Could not load tracked views just now.
      </p>
    );
  }

  if (theses.length === 0) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic leading-snug">
        No tracked views yet. They appear as the pipeline generates them.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {theses.map((t) => {
        return (
          <Link
            key={t.id}
            href={`/radar/calls?thesis=${t.id}`}
            className="group block rounded-lg px-2 py-1.5 -mx-2 hover:bg-parchment-mid transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              {t.sector && (
                <span className="font-data text-[9px] text-text-faint uppercase tracking-[0.04em] truncate">
                  {t.sector}
                </span>
              )}
              {t.conviction && (
                <span className="font-data text-[9px] text-text-faint ml-auto">
                  {t.conviction}
                </span>
              )}
            </div>
            <p className="font-sans text-[11.5px] text-text-primary leading-snug line-clamp-2 group-hover:text-gold-dark transition-colors m-0">
              {neutralizeThesisTitle(t.title)}
            </p>
          </Link>
        );
      })}
      <Link
        href="/radar/calls?views=open"
        className="block mt-1 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        All tracked views →
      </Link>
    </div>
  );
}
