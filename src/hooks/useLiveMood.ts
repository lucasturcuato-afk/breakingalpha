"use client";

import { useState, useEffect, useMemo } from "react";
import type { MoodType } from "@/components/shell";

interface MoodResult {
  mood: MoodType;
  moodHeadline: string;
  moodDetails: string[];
}

interface MarketCardData {
  symbol: string;
  label: string;
  value: string;
  pct: number;
}

/**
 * Fetches VIX, SPY, TNX from /api/market-indices and computes live mood.
 * Replaces all hardcoded mood values across pages.
 */
export function useLiveMood(): MoodResult {
  const [cards, setCards] = useState<Record<string, MarketCardData | null>>({});

  useEffect(() => {
    fetch("/api/market-indices?symbols=VIX,SPY,TNX")
      .then((r) => r.json())
      .then((data) => setCards(data.cards ?? {}))
      .catch(() => {});
  }, []);

  return useMemo(() => {
    const vixCard = cards["VIX"];
    const tnxCard = cards["TNX"];
    const spyCard = cards["SPY"];

    const vixVal = vixCard ? parseFloat(vixCard.value) : null;
    const vixPct = vixCard?.pct ?? 0;
    const spyPct = spyCard?.pct ?? 0;

    let m: MoodType = "neutral";
    let headline = "Markets steady";
    const details: string[] = [];

    if (vixVal !== null) {
      details.push(`VIX ${vixVal.toFixed(1)} ${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(1)}%`);

      if (vixVal >= 25) {
        m = "risk-off";
        headline = "Risk-Off regime";
      } else if (vixVal >= 20) {
        m = vixPct > 3 ? "risk-off" : "neutral";
        headline = vixPct > 3 ? "Elevated volatility" : "Cautious markets";
      } else if (vixVal < 15) {
        m = "risk-on";
        headline = "Risk-On regime";
      } else {
        m = spyPct > 0.3 ? "risk-on" : spyPct < -0.3 ? "risk-off" : "neutral";
        headline = spyPct > 0.3 ? "Markets advancing" : spyPct < -0.3 ? "Markets pulling back" : "Markets steady";
      }
    }

    if (tnxCard) details.push(`10Y ${tnxCard.value}%`);
    if (spyCard) details.push(`S&P ${spyPct >= 0 ? "+" : ""}${spyPct.toFixed(2)}%`);

    return {
      mood: m,
      moodHeadline: headline,
      moodDetails: details.length > 0 ? details : ["Loading..."],
    };
  }, [cards]);
}
