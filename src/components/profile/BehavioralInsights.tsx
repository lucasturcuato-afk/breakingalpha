"use client";

import { useEffect, useState } from "react";

interface SectorActivity {
  sector: string;
  positive: number;
  negative: number;
  net: number;
  weight: number;
}

interface InsightsResponse {
  profile: {
    first_name: string | null;
    role: string | null;
    sectors: string[];
    risk_appetite: string;
    watchlist_tickers: string[];
  };
  weights_updated_at: string | null;
  event_count_30d: number;
  top_boosted: { sector: string; weight: number }[];
  top_muted: { sector: string; weight: number }[];
  sector_activity: SectorActivity[];
  event_type_breakdown: Record<string, number>;
  narrative: string;
}

const EVENT_LABELS: Record<string, string> = {
  thesis_viewed: "Theses viewed",
  thesis_approved: "Theses approved",
  thesis_dismissed: "Theses dismissed",
  memo_generated: "Memos generated",
  morning_brief_opened: "Morning briefs opened",
  evening_wrap_opened: "Evening wraps opened",
  pattern_clicked: "Patterns explored",
  watchlist_added: "Watchlist added",
  watchlist_removed: "Watchlist removed",
  sector_filter_applied: "Sector filters applied",
  onboarding_completed: "Onboarding completed",
};

export function BehavioralInsights() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile/insights", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as InsightsResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <p className="font-sans text-[12px] text-text-muted italic">
          Loading behavioral insights…
        </p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <p className="font-sans text-[12px] text-text-muted italic">
          Couldn&apos;t load insights right now. {error ? `(${error})` : ""}
        </p>
      </section>
    );
  }

  const totalEvents = Object.values(data.event_type_breakdown).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <section className="bg-parchment border border-border-base rounded-2xl p-6 space-y-5">
      <header>
        <h2 className="font-display text-[16px] font-bold text-espresso">
          How Signalera is learning about you
        </h2>
        <p className="font-sans text-[12px] text-text-secondary mt-1">
          {data.narrative}
        </p>
      </header>

      {/* Activity totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Events (30d)" value={data.event_count_30d} />
        <Stat label="Sectors engaged" value={data.sector_activity.length} />
        <Stat label="Event types" value={Object.keys(data.event_type_breakdown).length} />
      </div>

      {/* Boosted vs muted */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-wider text-gold-dark mb-2">
            Leaning in
          </h3>
          {data.top_boosted.length === 0 ? (
            <p className="font-sans text-[11px] text-text-muted italic">
              No strong positive signal yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.top_boosted.map((b) => (
                <li
                  key={b.sector}
                  className="flex items-center justify-between font-sans text-[12px]"
                >
                  <span className="text-text-primary truncate">{b.sector}</span>
                  <span className="font-data text-[11px] text-gold-dark">
                    {b.weight.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-wider text-signal-dn mb-2">
            Cooling on
          </h3>
          {data.top_muted.length === 0 ? (
            <p className="font-sans text-[11px] text-text-muted italic">
              Nothing notably muted.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.top_muted.map((b) => (
                <li
                  key={b.sector}
                  className="flex items-center justify-between font-sans text-[12px]"
                >
                  <span className="text-text-primary truncate">{b.sector}</span>
                  <span className="font-data text-[11px] text-signal-dn">
                    {b.weight.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Sector activity table */}
      {data.sector_activity.length > 0 && (
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
            Sector activity (30d)
          </h3>
          <div className="divide-y divide-border-base">
            {data.sector_activity.slice(0, 8).map((row) => (
              <div
                key={row.sector}
                className="flex items-center gap-3 py-2 font-sans text-[12px]"
              >
                <div className="w-40 text-text-primary truncate">{row.sector}</div>
                <div className="flex-1 text-right">
                  <span className="text-signal-up mr-3">+{row.positive}</span>
                  <span className="text-signal-dn mr-3">-{row.negative}</span>
                  <span className="font-data text-[11px] text-text-muted">
                    net {row.net > 0 ? `+${row.net}` : row.net}
                  </span>
                </div>
                <div className="w-16 text-right font-data text-[11px] text-text-muted">
                  {row.weight.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event-type breakdown */}
      {totalEvents > 0 && (
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
            Event mix
          </h3>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(data.event_type_breakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <li
                  key={type}
                  className="flex items-center justify-between font-sans text-[11px]"
                >
                  <span className="text-text-secondary">
                    {EVENT_LABELS[type] ?? type}
                  </span>
                  <span className="font-data text-text-muted">{count}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-parchment-mid border border-border-base rounded-xl p-3">
      <div className="font-display text-[20px] font-semibold text-espresso">
        {value}
      </div>
      <div className="font-sans text-[10px] uppercase tracking-wider text-text-muted mt-0.5">
        {label}
      </div>
    </div>
  );
}
