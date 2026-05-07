"use client";

import { useState, useEffect, useMemo } from "react";
import type { MoodType } from "@/components/shell";
import { formatChange, type DisplayUnit } from "@/lib/format-change";

/**
 * Single source of truth for the global mood bar.
 *
 * Every route's `<AppShell>` reads from this hook so that the banner pill
 * and the live numbers (VIX / S&P / 10Y / BTC / Oil / watchlist quotes) are
 * identical across the app at any given moment. Without this, individual
 * pages were each mounting their own mood derivation (some from
 * `briefing.market_tone`, some from hard-coded defaults, some from a per-page
 * fetch) and disagreeing with each other inside the same minute.
 *
 * Backwards-compatible: still returns `{ mood, moodHeadline, moodDetails }`
 * for existing AppShell consumers. Also exposes the underlying `cards`,
 * the canonical `banner` triple, and a `meta` block for the debug overlay.
 *
 * Cache strategy: a module-level `Promise` keyed by the symbol set, with
 * a 30 s freshness TTL. Multiple mounts coalesce onto the same in-flight
 * fetch — the API endpoint is hit at most once per 30 s window per
 * symbol set, regardless of how many pages or widgets are open.
 */

interface MarketCardData {
  symbol: string;
  label: string;
  value: string;
  pct: number;
  /** Absolute delta in the same units as `value` (used for bps display). */
  change?: number;
  /** "percent" (default) or "bps". */
  displayUnit?: DisplayUnit;
  asOf?: string | null;
  closed?: boolean;
}

export type CanonicalMoodTerm = MoodType;

export interface MoodBanner {
  moodTerm: CanonicalMoodTerm;
  narrative: string;
  pill: string; // upper-cased label rendered on the badge
  details: string[];
}

export interface MoodMeta {
  sourceUrl: string;
  lastFetched: string | null;
  raw: Record<string, MarketCardData | null>;
}

export interface MoodResult {
  // Legacy shape kept for AppShell back-compat.
  mood: CanonicalMoodTerm;
  moodHeadline: string;
  moodDetails: string[];

  // New SSOT shape.
  vix: MarketCardData | null;
  sp500: MarketCardData | null;
  tenY: MarketCardData | null;
  bitcoin: MarketCardData | null;
  oil: MarketCardData | null;
  watchlistQuotes: Record<string, MarketCardData>;
  banner: MoodBanner;
  meta: MoodMeta;
}

// Symbols that feed the banner derivation. Anything *displayed* in the
// banner detail strings comes from this set. Pages that need additional
// quotes (watchlist tickers, futures, etc.) can pass their own list to the
// hook (`useLiveMood({ extraSymbols })`); those quotes are exposed via
// `watchlistQuotes` but do not influence the banner pill.
const BANNER_SYMBOLS = ["VIX", "SPY", "TNX"] as const;

// Cache TTL — 30 s as required by the SSOT spec. The server route already
// caches at 90 s; this client cache prevents per-mount fetch storms.
const STALE_MS = 30_000;

interface CacheEntry {
  // The most recent successfully resolved data.
  data: Record<string, MarketCardData | null>;
  fetchedAt: number;
  sourceUrl: string;
  // Promise of the fetch that wrote (or is writing) `data`. Concurrent
  // mounts await this so a single fetch fans out to N consumers.
  inflight: Promise<Record<string, MarketCardData | null>> | null;
}

const cache = new Map<string, CacheEntry>();
// Subscribers receive a callback whenever cache for their key updates.
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  const subs = subscribers.get(key);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn();
    } catch {
      // Subscriber errors must never break the cache plumbing.
    }
  }
}

function buildUrl(symbols: readonly string[]): string {
  return `/api/market-indices?symbols=${symbols.join(",")}`;
}

async function fetchSymbols(symbols: readonly string[]): Promise<Record<string, MarketCardData | null>> {
  const url = buildUrl(symbols);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`market-indices ${res.status}`);
  const data = await res.json();
  return (data?.cards ?? {}) as Record<string, MarketCardData | null>;
}

function ensureFresh(symbols: readonly string[]): CacheEntry {
  const key = symbols.join(",");
  const now = Date.now();
  const existing = cache.get(key);

  if (existing && now - existing.fetchedAt < STALE_MS) {
    return existing;
  }
  if (existing?.inflight) {
    return existing;
  }

  // Miss / stale / no in-flight fetch — kick one off.
  const url = buildUrl(symbols);
  const seed: CacheEntry = existing ?? {
    data: {},
    fetchedAt: 0,
    sourceUrl: url,
    inflight: null,
  };
  seed.sourceUrl = url;

  seed.inflight = fetchSymbols(symbols)
    .then((data) => {
      seed.data = data;
      seed.fetchedAt = Date.now();
      seed.inflight = null;
      cache.set(key, seed);
      notify(key);
      return data;
    })
    .catch((err) => {
      // Leave whatever stale data we already have in place; clear the
      // in-flight slot so the next consumer can retry.
      seed.inflight = null;
      cache.set(key, seed);
      // Re-throw so the .catch on the consumer side fires (no-op today).
      throw err;
    });

  cache.set(key, seed);
  return seed;
}

function subscribe(symbols: readonly string[], cb: () => void): () => void {
  const key = symbols.join(",");
  let subs = subscribers.get(key);
  if (!subs) {
    subs = new Set();
    subscribers.set(key, subs);
  }
  subs.add(cb);
  return () => {
    const s = subscribers.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) subscribers.delete(key);
  };
}

function deriveBanner(cards: Record<string, MarketCardData | null>): MoodBanner {
  const vixCard = cards["VIX"];
  const spyCard = cards["SPY"];
  const tnxCard = cards["TNX"];

  const vixVal = vixCard ? parseFloat(vixCard.value) : null;
  const vixPct = vixCard?.pct ?? 0;
  const spyPct = spyCard?.pct ?? 0;

  let moodTerm: CanonicalMoodTerm = "neutral";
  let narrative = "Markets steady";
  const details: string[] = [];

  if (vixVal !== null && !isNaN(vixVal)) {
    details.push(`VIX ${vixVal.toFixed(1)} ${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(1)}%`);

    if (vixVal >= 25) {
      moodTerm = "risk-off";
      narrative = "Risk-Off regime";
    } else if (vixVal >= 20) {
      moodTerm = vixPct > 3 ? "risk-off" : "neutral";
      narrative = vixPct > 3 ? "Elevated volatility" : "Cautious markets";
    } else if (vixVal < 15) {
      moodTerm = "risk-on";
      narrative = "Risk-On regime";
    } else {
      moodTerm = spyPct > 0.3 ? "risk-on" : spyPct < -0.3 ? "risk-off" : "neutral";
      narrative =
        spyPct > 0.3
          ? "Markets advancing"
          : spyPct < -0.3
            ? "Markets pulling back"
            : "Markets steady";
    }
  }

  if (tnxCard && tnxCard.value !== "—") {
    const tnxChange = formatChange({
      pct: tnxCard.pct,
      change: tnxCard.change,
      unit: tnxCard.displayUnit ?? "percent",
    });
    details.push(`10Y ${tnxCard.value} ${tnxChange.text}`);
  }
  if (spyCard && spyCard.value !== "—") {
    const spyChange = formatChange({
      pct: spyPct,
      change: spyCard.change,
      unit: spyCard.displayUnit ?? "percent",
    });
    details.push(`S&P ${spyChange.text}`);
  }

  const pillMap: Record<CanonicalMoodTerm, string> = {
    "risk-off": "Risk-Off",
    "risk-on": "Risk-On",
    neutral: "Neutral",
    mixed: "Mixed",
    watch: "Watch",
  };

  return {
    moodTerm,
    narrative,
    pill: pillMap[moodTerm],
    details: details.length > 0 ? details : ["Loading..."],
  };
}

interface UseLiveMoodOptions {
  /** Extra symbols to pull alongside the banner set. Surfaced via `watchlistQuotes`. */
  extraSymbols?: readonly string[];
}

export function useLiveMood(options: UseLiveMoodOptions = {}): MoodResult {
  const symbols = useMemo(() => {
    const merged = new Set<string>(BANNER_SYMBOLS);
    for (const s of options.extraSymbols ?? []) merged.add(s.toUpperCase());
    return Array.from(merged);
  }, [options.extraSymbols]);

  const [, forceRender] = useState(0);

  useEffect(() => {
    const entry = ensureFresh(symbols);
    // Subscribe first so we don't miss the resolution of an in-flight fetch.
    const unsub = subscribe(symbols, () => forceRender((n) => n + 1));
    if (entry.inflight) {
      // Force re-render once the in-flight resolves; subscribe handles it.
    }
    return unsub;
  }, [symbols]);

  const key = symbols.join(",");
  const entry = cache.get(key);

  return useMemo(() => {
    const cards = entry?.data ?? {};
    const banner = deriveBanner(cards);

    // Banner symbols are pinned; everything else lives under watchlistQuotes.
    const watchlistQuotes: Record<string, MarketCardData> = {};
    for (const sym of symbols) {
      const card = cards[sym];
      if (card && !BANNER_SYMBOLS.includes(sym as (typeof BANNER_SYMBOLS)[number])) {
        watchlistQuotes[sym] = card;
      }
    }

    return {
      mood: banner.moodTerm,
      moodHeadline: banner.narrative,
      moodDetails: banner.details,

      vix: cards["VIX"] ?? null,
      sp500: cards["SPY"] ?? null,
      tenY: cards["TNX"] ?? null,
      bitcoin: cards["BTC-USD"] ?? null,
      oil: cards["CL=F"] ?? null,
      watchlistQuotes,
      banner,
      meta: {
        sourceUrl: entry?.sourceUrl ?? buildUrl(symbols),
        lastFetched: entry?.fetchedAt ? new Date(entry.fetchedAt).toISOString() : null,
        raw: cards,
      },
    };
  }, [entry, symbols]);
}

// Test/dev hook so we can flush the in-memory cache from the debug overlay
// or unit harnesses. Not exported via the index.
export function __resetLiveMoodCache(): void {
  cache.clear();
  subscribers.clear();
}
