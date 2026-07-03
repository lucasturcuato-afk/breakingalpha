"use client";

import { useState, useEffect } from "react";

interface CollectiveData {
  trendingTickers: { ticker: string; watcherCount: number }[];
  activeSectors: { sector: string; activityCount: number }[];
  totalUsers: number;
}

export function CollectiveSignalsWidget() {
  const [data, setData] = useState<CollectiveData | null>(null);

  useEffect(() => {
    fetch("/api/collective-signals")
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return <div className="h-16 rounded-lg bg-parchment-mid animate-pulse" />;
  }

  if (data.trendingTickers.length === 0 && data.activeSectors.length === 0) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic">
        Community signals will appear as more users join.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.trendingTickers.length > 0 && (
        <div>
          <p className="font-sans text-[9px] text-text-muted mb-1.5">
            Trending on Signalera
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.trendingTickers.map(t => (
              <span key={t.ticker} className="font-data text-[10px] px-2 py-0.5 rounded bg-gold-muted text-gold-dark border border-gold/20">
                {t.ticker} · {t.watcherCount} watching
              </span>
            ))}
          </div>
        </div>
      )}
      {data.activeSectors.length > 0 && (
        <div>
          <p className="font-sans text-[9px] text-text-muted mb-1.5">
            Active sectors this week
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.activeSectors.map(s => (
              <span key={s.sector} className="font-sans text-[10px] px-2 py-0.5 rounded bg-signal-ai/10 text-signal-ai border border-signal-ai/20">
                {s.sector}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
