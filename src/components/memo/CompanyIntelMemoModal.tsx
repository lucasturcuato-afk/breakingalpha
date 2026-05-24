"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X, Copy, Check, Download, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

/* ===========================================================================
 * CompanyIntelMemoModal
 * ---------------------------------------------------------------------------
 * Forked from src/components/memo/MemoModal.tsx for the W2-C Company Intel
 * surfaces only. The shared MemoModal continues to serve the other six
 * calling pages (deal-flow, evening-wrap, trends, morning-brief, watchlist,
 * dashboard story-card and feed row). This fork lets us iterate on a
 * fullscreen, sources-in-rail layout without regressing the other surfaces.
 *
 * Design synthesis: the body is a two-column layout. Memo prose lives in
 * the wide left column, and a sticky sources rail lives in the narrow
 * right column. Inline [n] citation anchors in the prose scroll the
 * matching source into view in the rail and flash it gold for ~200ms.
 *
 * This component is intentionally self-contained. Integration into the
 * directory and detail surfaces is handled in separate PRs.
 * ========================================================================= */

/* ───────── Types ───────── */

export type CompanyIntelMemoType =
  | "deal"
  | "thesis"
  | "brief"
  | "article"
  | "company"
  | "company-web";

/**
 * One source record rendered in the right rail. Index n in this list maps
 * to the [n+1] anchor in the memo prose. Identical shape to MemoSource in
 * the shared MemoModal so call sites can pass the same data structure.
 */
export interface CompanyIntelMemoSource {
  url: string;
  title: string;
  source: string;
  publishedAt: string | null;
}

/**
 * Optional alias-resolved banner payload. Renders a small "Did you mean
 * Pershing Square? You typed Perishing Square" line under the company
 * name. Pass null or undefined to hide it entirely.
 */
export interface CompanyIntelAliasResolved {
  queryTyped: string;
  canonicalName: string;
}

export interface CompanyIntelMemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The canonical company name shown in the header. */
  title: string;
  /** Memo input payload (raw article list or web result list). */
  content: string;
  type: CompanyIntelMemoType;
  systemPrompt?: string;
  /** If provided, skip the API call and display this text directly. */
  preloadedMemo?: string;
  /** Called with the full memo text after a successful API generation. */
  onGenerated?: (text: string) => void;
  /** Optional source list for the right rail and [n] citation anchors. */
  sources?: CompanyIntelMemoSource[];
  /**
   * Optional list of "also known as" strings rendered as small chips under
   * the company name (e.g. ["Nvidia", "NVIDIA Corp"]). Empty or undefined
   * hides the ribbon entirely.
   */
  canonicalAliasRibbon?: string[];
  /**
   * Optional alias-resolution banner. Renders only when both queryTyped
   * and canonicalName are present and differ.
   */
  aliasResolved?: CompanyIntelAliasResolved | null;
  /**
   * When true, render the WEB-SOURCED status pill in the header. Mutually
   * exclusive with the article-grounded path. Callers should set this in
   * tandem with type === "company-web".
   */
  webFallback?: boolean;
}

const TYPE_LABELS: Record<CompanyIntelMemoType, string> = {
  deal: "Deal Memo",
  thesis: "Thesis Memo",
  brief: "Market Brief",
  article: "Article Analysis",
  company: "Company Brief",
  "company-web": "Company Brief",
};

/* ───────── Citation anchor helpers ───────── */

/**
 * Split a string on bracketed citation anchors like "[3]" or "[12]".
 * Returns an array of segments where each segment is either a plain text
 * string or a tagged citation object with the matched index. Used by the
 * markdown text-renderer to wire [n] anchors to source refs in the rail.
 */
type Segment = { kind: "text"; value: string } | { kind: "cite"; index: number };

function segmentTextWithCitations(text: string): Segment[] {
  const re = /\[(\d+)\]/g;
  const out: Segment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      out.push({ kind: "text", value: text.slice(last, match.index) });
    }
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > 0) {
      out.push({ kind: "cite", index: n });
    } else {
      out.push({ kind: "text", value: match[0] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", value: text.slice(last) });
  }
  return out;
}

/* ───────── Component ───────── */

export default function CompanyIntelMemoModal(props: CompanyIntelMemoModalProps) {
  const {
    isOpen,
    onClose,
    title,
    content,
    type,
    systemPrompt,
    preloadedMemo,
    onGenerated,
    sources,
    canonicalAliasRibbon,
    aliasResolved,
    webFallback,
  } = props;

  const [mounted, setMounted] = useState(false);
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [containerVisible, setContainerVisible] = useState(false);
  // Highlight key on the active source row. Bumping this re-triggers the
  // 200ms gold flash CSS transition via inline style. We track the source
  // index plus a monotonic counter so repeated clicks on the same anchor
  // re-fire the flash.
  const [highlight, setHighlight] = useState<{ index: number; nonce: number } | null>(null);

  // Refs to each rendered source list item, indexed by its 1-based citation
  // number. Keys are strings so the map stays stable across renders.
  const sourceRefs = useRef<Map<number, HTMLLIElement | null>>(new Map());

  // Keep onGenerated ref in sync to avoid stale-closure bugs in the fetch.
  const onGeneratedRef = useRef(onGenerated);
  useEffect(() => {
    onGeneratedRef.current = onGenerated;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  /* ── Fetch memo on open (or use preloadedMemo if provided) ── */

  const runFetch = useCallback(() => {
    if (!content) return;
    setMemo("");
    setError("");
    setCopied(false);
    setHighlight(null);

    if (preloadedMemo) {
      setMemo(preloadedMemo);
      return;
    }

    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            type,
            ...(systemPrompt ? { systemPrompt } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `API error: ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled && data.memo) {
          setMemo(data.memo);
          onGeneratedRef.current?.(data.memo);
          // Fire-and-forget behavioral event. Mirrors the shared MemoModal.
          try {
            void fetch("/api/user-events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event_type: "memo_generated",
                payload: { memo_type: type, title },
              }),
              keepalive: true,
            }).catch(() => {});
          } catch {
            // ignore
          }
        } else if (!cancelled) {
          setError("No memo content returned");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to generate memo");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content, preloadedMemo, systemPrompt, title, type]);

  useEffect(() => {
    if (!isOpen) return;
    const cleanup = runFetch();
    return cleanup;
  }, [isOpen, runFetch]);

  /* ── 180ms container fade-in ── */

  useEffect(() => {
    if (!isOpen) {
      setContainerVisible(false);
      return;
    }
    // Defer one frame so the initial opacity:0 paints before we transition.
    const id = requestAnimationFrame(() => setContainerVisible(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  /* ── Escape to close ── */

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  /* ── Citation click handler ── */

  const handleCiteClick = useCallback(
    (n: number) => {
      const el = sourceRefs.current.get(n);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      setHighlight((prev) => ({ index: n, nonce: (prev?.nonce ?? 0) + 1 }));
      // Clear the highlight after the 200ms flash so the row settles.
      window.setTimeout(() => {
        setHighlight((curr) => (curr && curr.index === n ? null : curr));
      }, 220);
    },
    [],
  );

  /* ── Markdown component overrides ── */

  const renderTextWithCites = useCallback(
    (raw: string) => {
      const segments = segmentTextWithCitations(raw);
      return segments.map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
        const sourceExists =
          sources != null && seg.index >= 1 && seg.index <= sources.length;
        return (
          <button
            key={i}
            type="button"
            onClick={() => sourceExists && handleCiteClick(seg.index)}
            disabled={!sourceExists}
            className={cn(
              "inline-flex items-center justify-center align-baseline",
              "mx-0.5 px-1 rounded",
              "font-data text-[10px] font-bold leading-none",
              "border transition-colors",
              sourceExists
                ? "border-gold-border bg-gold-muted text-gold hover:bg-gold/15 cursor-pointer"
                : "border-border-base bg-parchment-mid text-text-faint cursor-not-allowed",
            )}
            title={sourceExists ? `Jump to source [${seg.index}]` : `Source [${seg.index}] not provided`}
          >
            [{seg.index}]
          </button>
        );
      });
    },
    [sources, handleCiteClick],
  );

  // Recursively walk markdown children and replace plain strings with
  // citation-aware spans. Non-string children (e.g. <strong>) pass through
  // unchanged so nested formatting still renders.
  const renderChildrenWithCites = useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (typeof children === "string") {
        return renderTextWithCites(children);
      }
      if (Array.isArray(children)) {
        return children.map((child, i) => {
          if (typeof child === "string") {
            return <span key={i}>{renderTextWithCites(child)}</span>;
          }
          return child;
        });
      }
      return children;
    },
    [renderTextWithCites],
  );

  const mdComponents: Components = useMemo(
    () => ({
      h1: ({ children }) => (
        <h1 className="font-display text-[18px] font-bold text-text-primary mb-3 mt-5">
          {renderChildrenWithCites(children)}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="font-display text-[15px] font-bold text-text-primary mb-2 mt-5">
          {renderChildrenWithCites(children)}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="font-sans text-[11px] font-bold text-gold uppercase tracking-wider mb-2 mt-5">
          {renderChildrenWithCites(children)}
        </h3>
      ),
      p: ({ children }) => (
        <p className="font-sans text-[14px] text-text-secondary leading-relaxed mb-4">
          {renderChildrenWithCites(children)}
        </p>
      ),
      strong: ({ children }) => (
        <strong className="font-bold text-text-primary">
          {renderChildrenWithCites(children)}
        </strong>
      ),
      hr: () => <hr className="border-border-base my-5" />,
      ul: ({ children }) => (
        <ul className="list-disc pl-5 space-y-1.5 text-text-secondary mb-4">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="list-decimal pl-5 space-y-1.5 text-text-secondary mb-4">
          {children}
        </ol>
      ),
      li: ({ children }) => (
        <li className="font-sans text-[14px] leading-relaxed">
          {renderChildrenWithCites(children)}
        </li>
      ),
    }),
    [renderChildrenWithCites],
  );

  /* ── Action handlers ── */

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(memo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [memo]);

  const handleExport = useCallback(() => {
    const blob = new Blob([memo], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}_memo.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [memo, title]);

  const handleRetry = useCallback(() => {
    runFetch();
  }, [runFetch]);

  /* ── Source ref setter (stable identity) ── */

  const setSourceRef = useCallback(
    (n: number) => (el: HTMLLIElement | null) => {
      const map = sourceRefs.current;
      if (el) {
        map.set(n, el);
      } else {
        map.delete(n);
      }
    },
    [],
  );

  /* ── Render guard ── */

  if (!isOpen || !mounted) return null;

  const showAliasRibbon =
    Array.isArray(canonicalAliasRibbon) && canonicalAliasRibbon.length > 0;
  const showAliasResolved =
    aliasResolved != null &&
    aliasResolved.queryTyped.trim().length > 0 &&
    aliasResolved.canonicalName.trim().length > 0 &&
    aliasResolved.queryTyped.trim().toLowerCase() !==
      aliasResolved.canonicalName.trim().toLowerCase();
  const hasMemo = memo.length > 0 && !loading && !error;
  const isEmpty = !loading && !error && !memo && !preloadedMemo && !content;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9999] bg-espresso/50 flex items-stretch justify-stretch",
        "transition-opacity duration-[180ms] ease-out",
        containerVisible ? "opacity-100" : "opacity-0",
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "bg-parchment border border-border-base",
          "w-screen h-screen max-w-screen max-h-screen",
          "flex flex-col overflow-hidden shadow-2xl",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-8 py-5 border-b border-border-base flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="font-data text-[9px] uppercase tracking-widest text-gold font-bold mb-1.5">
              {TYPE_LABELS[type]}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-[28px] font-bold text-espresso leading-tight">
                {title}
              </h2>
              {webFallback && (
                <span
                  className={cn(
                    "font-data text-[9px] font-bold uppercase tracking-wider",
                    "px-2 py-1 rounded-md border",
                    "border-gold-border bg-gold-muted text-gold",
                  )}
                  title="Memo grounded in web search results, not the indexed news pipeline"
                >
                  Web-sourced
                </span>
              )}
            </div>

            {/* Canonical alias ribbon */}
            {showAliasRibbon && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-data text-[9px] uppercase tracking-wider text-text-faint">
                  Also known as
                </span>
                {canonicalAliasRibbon!.map((alias, i) => (
                  <span
                    key={`${alias}-${i}`}
                    className={cn(
                      "font-sans text-[11px]",
                      "px-2 py-0.5 rounded-md border",
                      "border-gold-border bg-gold-muted text-gold-dark",
                    )}
                  >
                    {alias}
                  </span>
                ))}
              </div>
            )}

            {/* Alias-resolved banner */}
            {showAliasResolved && aliasResolved && (
              <div
                className={cn(
                  "mt-2 inline-flex items-center gap-2",
                  "px-2.5 py-1 rounded-md border",
                  "border-gold-border bg-gold-muted",
                )}
              >
                <Sparkles size={11} className="text-gold flex-shrink-0" />
                <p className="font-sans text-[11px] text-text-secondary">
                  Did you mean{" "}
                  <span className="font-bold text-gold">
                    {aliasResolved.canonicalName}
                  </span>
                  ? You typed{" "}
                  <span className="font-mono text-text-muted">
                    {aliasResolved.queryTyped}
                  </span>
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-parchment-mid transition-colors cursor-pointer flex-shrink-0"
            aria-label="Close memo"
          >
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        {/* Body: 2-column layout (memo prose | sources rail) */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-0">
            {/* Memo prose (left, wide, scrolls) */}
            <div className="overflow-y-auto px-8 py-6 lg:border-r lg:border-border-base">
              {loading ? (
                <MemoSkeleton />
              ) : error ? (
                <ErrorBanner message={error} onRetry={handleRetry} />
              ) : isEmpty ? (
                <div className="flex items-center justify-center py-24">
                  <p className="font-sans text-[13px] text-text-muted">
                    No memo available.
                  </p>
                </div>
              ) : (
                <article className="max-w-3xl">
                  <ReactMarkdown components={mdComponents}>{memo}</ReactMarkdown>
                </article>
              )}
            </div>

            {/* Sources rail (right, narrow, sticky-ish via own scroll container) */}
            <aside className="overflow-y-auto px-6 py-6 bg-parchment-mid/40 hidden lg:block">
              <p className="font-data text-[10px] uppercase tracking-widest text-gold font-bold mb-3">
                Sources
              </p>
              {loading ? (
                <SourceRailSkeleton />
              ) : sources && sources.length > 0 ? (
                <ol className="space-y-3">
                  {sources.map((s, i) => {
                    const n = i + 1;
                    const isHighlighted = highlight?.index === n;
                    return (
                      <li
                        key={`${s.url}-${i}`}
                        ref={setSourceRef(n)}
                        className={cn(
                          "rounded-lg border p-3 transition-colors duration-[200ms] ease-out",
                          isHighlighted
                            ? "border-gold bg-gold-muted"
                            : "border-border-base bg-parchment",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={cn(
                              "font-data text-[10px] font-bold flex-shrink-0",
                              "mt-0.5 px-1.5 py-0.5 rounded border",
                              "border-gold-border bg-gold-muted text-gold",
                            )}
                          >
                            [{n}]
                          </span>
                          <div className="min-w-0 flex-1">
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-sans text-[12px] font-medium text-text-primary leading-snug hover:text-gold underline-offset-2 hover:underline block"
                            >
                              {s.title}
                            </a>
                            <p className="font-data text-[10px] text-text-faint mt-1">
                              {s.source}
                              {s.publishedAt
                                ? ` · ${s.publishedAt.slice(0, 10)}`
                                : ""}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="font-sans text-[12px] text-text-faint italic">
                  No sources attached.
                </p>
              )}
            </aside>
          </div>
        </div>

        {/* Footer */}
        {hasMemo && (
          <div className="flex items-center justify-end gap-2 px-8 py-3 border-t border-border-base flex-shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg",
                "font-data text-[10px] font-bold uppercase border cursor-pointer transition-colors",
                copied
                  ? "border-signal-up/30 bg-signal-up/10 text-signal-up"
                  : "border-gold/40 bg-gold-muted text-gold hover:bg-gold/10",
              )}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg",
                "border border-gold/40 bg-gold-muted text-gold",
                "font-data text-[10px] font-bold uppercase cursor-pointer hover:bg-gold/10 transition-colors",
              )}
            >
              <Download size={11} />
              Export .md
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg",
                "border border-border-base text-text-muted",
                "font-data text-[10px] font-bold uppercase cursor-pointer hover:text-text-primary transition-colors",
              )}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ───────── Subcomponents (loading + error) ───────── */

function MemoSkeleton() {
  return (
    <div className="max-w-3xl space-y-6 animate-pulse">
      {/* TLDR header */}
      <div>
        <div className="h-3 w-20 rounded bg-border-base mb-3" />
        <div className="h-5 w-3/4 rounded bg-border-base" />
      </div>
      {/* 4 paragraph placeholders */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-full rounded bg-border-base" />
          <div className="h-3 w-full rounded bg-border-base" />
          <div className="h-3 w-5/6 rounded bg-border-base" />
        </div>
      ))}
    </div>
  );
}

function SourceRailSkeleton() {
  return (
    <ol className="space-y-3 animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="rounded-lg border border-border-base bg-parchment p-3"
        >
          <div className="h-3 w-4/5 rounded bg-border-base mb-2" />
          <div className="h-2.5 w-1/2 rounded bg-border-base" />
        </li>
      ))}
    </ol>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        "border-signal-dn/30 bg-signal-dn/5",
      )}
    >
      <div className="flex items-start gap-3">
        <Sparkles size={16} className="text-signal-dn flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-sans text-[13px] font-bold text-signal-dn mb-1">
            Generation failed.
          </p>
          <p className="font-sans text-[12px] text-text-secondary mb-3">
            {message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
              "border border-gold/40 bg-gold-muted text-gold",
              "font-data text-[10px] font-bold uppercase cursor-pointer hover:bg-gold/10 transition-colors",
            )}
          >
            <Sparkles size={11} />
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
