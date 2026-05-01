"use client";

import { useEffect, useState } from "react";
import { useLiveMood } from "@/hooks/useLiveMood";

/**
 * Dev-only inspector for the live mood data. Renders nothing unless the
 * page URL contains `?debug=mood` AND we're running outside production.
 *
 * Mounted from `MoodBar` so it's available on every route automatically.
 * Calls `useLiveMood()` itself — the hook's module-level cache makes the
 * call free (it shares state with whichever route hook is also mounted).
 */
export function MoodDebugOverlay() {
  const [visible, setVisible] = useState(false);
  const { banner, meta } = useLiveMood();

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;
    // queueMicrotask defers the setState past the synchronous effect body
    // and keeps the react-hooks/static-components rule happy.
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      setVisible(params.get("debug") === "mood");
    });
  }, []);

  if (!visible) return null;

  const fetched = meta.lastFetched
    ? new Date(meta.lastFetched).toLocaleTimeString()
    : "—";

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 9999,
        maxWidth: 360,
        padding: "10px 12px",
        background: "rgba(20, 14, 6, 0.96)",
        color: "#fffdf9",
        border: "1px solid rgba(212, 168, 75, 0.55)",
        borderRadius: 8,
        font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
        boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ fontWeight: 700, color: "#d4a84b", marginBottom: 6 }}>
        useLiveMood — debug
      </div>
      <div>
        <span style={{ opacity: 0.6 }}>source: </span>
        <code>{meta.sourceUrl}</code>
      </div>
      <div>
        <span style={{ opacity: 0.6 }}>fetched: </span>
        {fetched}
      </div>
      <div>
        <span style={{ opacity: 0.6 }}>banner: </span>
        <strong>{banner.moodTerm}</strong> — {banner.narrative}
      </div>
      <div style={{ marginTop: 4 }}>
        <span style={{ opacity: 0.6 }}>details: </span>
        {banner.details.join(" · ")}
      </div>
      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: "1px dashed rgba(255,253,249,0.2)",
        }}
      >
        <div style={{ opacity: 0.6, marginBottom: 2 }}>raw cards:</div>
        {Object.entries(meta.raw).length === 0 ? (
          <div style={{ opacity: 0.6 }}>(no data yet)</div>
        ) : (
          Object.entries(meta.raw).map(([sym, card]) => (
            <div key={sym}>
              {sym}: {card?.value ?? "—"}
              {card
                ? ` (${card.pct >= 0 ? "+" : ""}${card.pct.toFixed(2)}%)`
                : ""}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
