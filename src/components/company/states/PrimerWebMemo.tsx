"use client";

/**
 * PrimerWebMemo -- "Generate a memo from web search" affordance shown inside the
 * Primer's Recent-developments slot when a company has NO indexed article
 * coverage (e.g. a just-minted on-demand row). It reuses the EXACT web-search
 * memo path that backs the directory search-screen Generate button:
 *   POST /api/companies/web-fallback  -> {results, canonicalName}
 *   buildWebFallbackMemoContent / buildWebFallbackMemoSystemPrompt (company-intel)
 *   <MemoModal type="company-web" ...>  -> POSTs /api/memo to generate
 * Nothing here reimplements memo generation; MemoModal is rendered, not edited.
 */

import { Globe, Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { MemoModal } from "@/components/memo/MemoModal";
import {
  buildWebFallbackMemoContent,
  buildWebFallbackMemoSystemPrompt,
} from "@/lib/company-intel";
import { cn } from "@/lib/utils";

// Shape of /api/companies/web-fallback result items. Redeclared locally (same
// pattern the directory page uses) to avoid importing across a route boundary.
interface WebFallbackResult {
  url: string;
  title: string;
  source: string;
  publishedAt: string | null;
  summary: string;
}

interface Props {
  /** Canonical display name; used as the web-search query and memo title. */
  company: string;
  /** Ticker, when known (minted on-demand row), used for entity matching. */
  ticker?: string | null;
}

export function PrimerWebMemo({ company, ticker }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<WebFallbackResult[]>([]);
  const [sectorContext, setSectorContext] = useState<WebFallbackResult[]>([]);
  const [canonical, setCanonical] = useState("");
  const [memoOpen, setMemoOpen] = useState(false);
  // True once a generation returned too few on-entity sources for a reliable
  // brief; we show a thin-coverage state instead of a memo.
  const [thin, setThin] = useState(false);

  const memoContent = useMemo(() => {
    if (!canonical || results.length === 0) return "";
    return buildWebFallbackMemoContent(canonical, results, sectorContext);
  }, [canonical, results, sectorContext]);
  const memoSystemPrompt = useMemo(() => {
    if (!canonical) return "";
    return buildWebFallbackMemoSystemPrompt(canonical, results.length);
  }, [canonical, results.length]);

  const handleGenerate = async () => {
    const query = company.trim();
    if (query.length < 2) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/companies/web-fallback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, ...(ticker ? { ticker } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Search failed (${res.status})`);
      }
      const json = (await res.json()) as {
        results?: WebFallbackResult[];
        sectorContext?: WebFallbackResult[];
        canonicalName?: string;
        thin?: boolean;
      };
      const found = json.results ?? [];
      const name = json.canonicalName ?? query;
      setCanonical(name);
      // Thin-pool gate: too few on-entity sources to ground a reliable brief.
      // Do NOT generate a confident memo on a starved/contaminated pool.
      if (json.thin || found.length === 0) {
        setThin(true);
        setResults([]);
        setError(
          `Limited verifiable coverage for ${name}. Not enough on-topic sources for a reliable brief yet.`,
        );
        return;
      }
      setSectorContext(json.sectorContext ?? []);
      setResults(found);
      setMemoOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Web search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div
        className="mb-4 flex items-center justify-between rounded-xl border px-4 py-4"
        style={{ borderColor: "rgba(201,146,42,0.3)", backgroundColor: "var(--gold-muted)" }}
      >
        <div className="flex items-start gap-3">
          <Globe size={16} className="mt-0.5" style={{ color: "var(--gold)" }} />
          <div>
            <p className="font-sans text-[13px] font-semibold text-espresso">
              No indexed coverage for {company} yet.
            </p>
            {!thin && (
              <p className="font-sans text-[12px] text-text-secondary mt-0.5">
                Generate a memo from web search?
              </p>
            )}
            {error && (
              <p className="font-sans text-[11px] text-signal-dn mt-1">{error}</p>
            )}
          </div>
        </div>
        {!thin && (
          <button
            type="button"
            onClick={results.length > 0 ? () => setMemoOpen(true) : handleGenerate}
            disabled={loading}
            className={cn(
              "flex-shrink-0 ml-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg",
              "font-data text-[10px] font-bold uppercase border cursor-pointer transition-colors",
              "border-gold/40 bg-white text-gold hover:bg-gold/10",
              loading && "opacity-60 cursor-wait",
            )}
          >
            {loading ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Searching
              </>
            ) : (
              <>
                <Sparkles size={11} />
                {results.length > 0 ? "View memo" : "Generate"}
              </>
            )}
          </button>
        )}
      </div>

      {canonical && results.length > 0 && (
        <MemoModal
          isOpen={memoOpen}
          onClose={() => setMemoOpen(false)}
          title={canonical}
          content={memoContent}
          type="company-web"
          systemPrompt={memoSystemPrompt}
          sources={results.map((r) => ({
            url: r.url,
            title: r.title,
            source: r.source,
            publishedAt: r.publishedAt,
          }))}
        />
      )}
    </div>
  );
}
