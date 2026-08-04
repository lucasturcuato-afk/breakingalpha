"use client";

import { useState, useEffect } from "react";

interface CompetitorAlert {
  competitor: string;
  watchlistTicker: string;
  article: { title: string; source: string; published_at: string };
  coMentionStrength: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CompetitorAlertsWidget() {
  const [alerts, setAlerts] = useState<CompetitorAlert[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed read is not "no competitor activity".
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/competitor-alerts")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(d => setAlerts(d.alerts ?? []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    // Three card-height rows to match the typical filled state.
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-parchment-mid animate-pulse" />)}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic">
        Couldn&apos;t load competitor activity.
      </p>
    );
  }

  if (alerts.length === 0) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic">
        No competitor activity detected in the last 7 days.
      </p>
    );
  }

  return (
    <div className="dash-fill-in space-y-2">
      {alerts.slice(0, 5).map((alert, i) => (
        <div key={i} className="bg-parchment rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-data text-[9px] font-bold text-signal-warn uppercase">
              {alert.watchlistTicker.toUpperCase()} competitor
            </span>
            <span className="font-sans text-[9px] text-text-faint">
              {timeAgo(alert.article.published_at)}
            </span>
          </div>
          <p className="font-sans text-[11px] text-text-primary leading-snug line-clamp-2">
            {alert.article.title}
          </p>
          <p className="font-sans text-[9px] text-text-muted mt-0.5">
            {alert.article.source} · about {alert.competitor}
          </p>
        </div>
      ))}
    </div>
  );
}
