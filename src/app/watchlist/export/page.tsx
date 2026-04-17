"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ExportEntry {
  id: string;
  identifier: string;
  type: string;
  display_name: string | null;
  signal: string | null;
  note: string | null;
  topArticles: { title: string; source: string | null; published_at: string | null }[];
}

interface ExportData {
  entries: ExportEntry[];
  exportedAt: string;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export default function WatchlistExportPage() {
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/export/watchlist-pdf")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .print-page { padding: 0; }
          .entry-section { page-break-inside: avoid; }
        }
        @media screen {
          body { background: #f5f0e8; }
        }
      `}</style>

      {/* Print / navigation controls — hidden when printing */}
      <div className="no-print bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <Link
          href="/watchlist"
          className="font-sans text-[12px] text-gray-500 hover:text-gray-900 transition-colors"
        >
          ← Back to Watchlist
        </Link>
        <div className="flex items-center gap-3">
          <p className="font-sans text-[11px] text-gray-400 italic">
            Opens print dialog — select &ldquo;Save as PDF&rdquo;
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white font-sans text-[13px] font-semibold hover:bg-amber-700 transition-colors cursor-pointer"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="print-page max-w-[800px] mx-auto px-8 py-10 bg-white min-h-screen">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="font-sans text-gray-400">Loading watchlist data…</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-24">
            <p className="font-sans text-red-500">{error}</p>
          </div>
        ) : !data ? null : (
          <>
            {data.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="font-serif text-[18px] text-gray-700 mb-2">Your watchlist is empty</p>
                <p className="font-sans text-[13px] text-gray-500 mb-4">Add tickers, companies, or sectors to your watchlist to generate an export.</p>
                <Link href="/watchlist" className="font-sans text-[13px] text-amber-600 hover:text-amber-700 underline">← Back to Watchlist</Link>
              </div>
            ) : (
              <>
                {/* Cover */}
                <div className="mb-12 border-b-2 border-gray-900 pb-8">
                  <p className="font-serif text-[11px] uppercase tracking-[3px] text-gray-500 mb-2">Signalera</p>
                  <h1 className="font-serif text-[36px] font-bold text-gray-900 leading-tight mb-2">
                    Watchlist Intelligence Report
                  </h1>
                  <p className="font-sans text-[14px] text-gray-500">{today}</p>
                  <p className="font-sans text-[13px] text-gray-700 mt-3 font-semibold">
                    TRACKING {data.entries.length} {data.entries.length === 1 ? "ITEM" : "ITEMS"}
                  </p>
                </div>

                {/* Entries */}
                {data.entries.map((entry, i) => (
                  <div key={entry.id} className={cn("entry-section mb-10 pb-8", i < data.entries.length - 1 && "border-b border-gray-200")}>
                    <div className="flex items-center gap-3 mb-3">
                      <h2 className="font-serif text-[22px] font-bold text-gray-900">
                        {entry.display_name || entry.identifier}
                      </h2>
                      <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border border-amber-400 text-amber-700 bg-amber-50">
                        {entry.type === "ticker" ? entry.identifier : entry.type.toUpperCase()}
                      </span>
                    </div>

                    {entry.signal && (
                      <p className="font-serif text-[14px] italic text-amber-700 mb-3 leading-relaxed">
                        &ldquo;{entry.signal}&rdquo;
                      </p>
                    )}

                    {entry.topArticles.length > 0 && (
                      <div className="mb-3">
                        <p className="font-sans text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Recent Coverage</p>
                        <ul className="space-y-1">
                          {entry.topArticles.map((a, j) => (
                            <li key={j} className="font-sans text-[12px] text-gray-700">
                              <span className="font-semibold">{a.title}</span>
                              {(a.source || a.published_at) && (
                                <span className="text-gray-400 ml-1.5 text-[11px]">
                                  {[a.source, a.published_at ? formatDate(a.published_at) : null].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {entry.note && (
                      <p className="font-serif text-[12px] italic text-gray-500 mt-2">
                        <span className="font-sans font-semibold not-italic text-gray-600">Analyst Note: </span>
                        {entry.note}
                      </p>
                    )}
                  </div>
                ))}

                {/* Footer */}
                <div className="mt-12 pt-6 border-t border-gray-300">
                  <p className="font-sans text-[10px] text-gray-400 text-center">
                    Generated by Signalera · {today} · AI-generated content · Not financial advice
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
