"use client";

// BriefTab (PR-C1c): cache-first F1 Brief container. Mount: GET
// /api/memo-cache. Hit -> render parsed Markdown sections. Miss ->
// Generate Brief CTA. Click -> POST /api/memo (route's after() hook
// backfills the cache via metadata.markdown_memo).

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

import { parseMemo, type ParsedMemo } from "@/lib/parse-memo";

interface BriefTabProps {
  /** Canonical company name. Sent as `company` to /api/memo. */
  company: string;
  /** Concatenated article-summary content used as memo input. */
  content: string;
  /**
   * Pre-built memo system prompt. Built server-side via
   * `buildMemoSystemPrompt(companyName)` and passed in to keep this
   * client component free of the company-intel import chain.
   */
  systemPrompt: string;
}

interface MemoResponse {
  memo?: string;
  error?: string;
}

interface CacheResponse {
  cached: boolean;
  markdown?: string;
  generated_at?: string;
}

type Phase = "checking-cache" | "ready" | "generating" | "error";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hr ago`;
  return `${Math.floor(diffHour / 24)} d ago`;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SHELL = "bg-cream-hi border border-border-base rounded-lg p-4";

export function BriefTab({ company, content, systemPrompt }: BriefTabProps) {
  const [phase, setPhase] = useState<Phase>("checking-cache");
  const [parsed, setParsed] = useState<ParsedMemo | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("checking-cache");
    setParsed(null);
    setCachedAt(null);
    setErrorMessage(null);
    (async () => {
      try {
        const res = await fetch(`/api/memo-cache?company_id=${encodeURIComponent(company)}`);
        const data: CacheResponse = await res.json().catch(() => ({ cached: false }));
        if (cancelled) return;
        if (res.ok && data.cached && typeof data.markdown === "string" && data.markdown.length > 0) {
          setParsed(parseMemo(data.markdown));
          setCachedAt(data.generated_at ?? null);
        }
      } catch {
        // network failure -> miss path
      } finally {
        if (!cancelled) setPhase("ready");
      }
    })();
    return () => { cancelled = true; };
  }, [company]);

  const generateBrief = async () => {
    if (!content) {
      setErrorMessage("No article content available for this company.");
      setPhase("error");
      return;
    }
    setPhase("generating");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "company",
          company,
          content,
          systemPrompt,
        }),
      });
      const data: MemoResponse = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.memo !== "string" || data.memo.length === 0) {
        setErrorMessage(data.error ?? "Failed to generate brief.");
        setPhase("error");
        return;
      }
      setParsed(parseMemo(data.memo));
      setCachedAt(null);
      setPhase("ready");
    } catch {
      setErrorMessage("Network error while generating brief.");
      setPhase("error");
    }
  };

  const hasContent = phase === "ready" && parsed !== null;
  const cacheState = hasContent ? (cachedAt ? "hit" : "fresh") : "miss";

  if (phase === "checking-cache" || phase === "generating") {
    return (
      <div data-testid="brief-tab" data-cache-state={cacheState} className={SHELL}>
        <div data-testid="brief-loading" className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
          {phase === "generating" ? (
            <p className="font-sans text-[12px] text-text-muted text-center pt-2">
              Generating brief... this typically takes 5-10 seconds.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div data-testid="brief-tab" data-cache-state="miss" className={SHELL}>
        <div data-testid="brief-cache-miss" className="hidden" />
        <EmptyState
          title="Could not generate brief"
          description={errorMessage ?? "An unexpected error occurred."}
          action={
            <Button data-testid="brief-generate-button" variant="primary" onClick={generateBrief}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!parsed) {
    return (
      <div data-testid="brief-tab" data-cache-state="miss" className={SHELL}>
        <div data-testid="brief-cache-miss" className="hidden" />
        <div data-testid="brief-empty-state">
          <EmptyState
            title="No brief generated yet"
            description="Generate a structured analyst brief from the latest article corpus."
            action={
              <Button data-testid="brief-generate-button" variant="primary" onClick={generateBrief}>
                Generate Brief
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const sectionEntries = Object.entries(parsed.sections);
  const hasSections = sectionEntries.length >= 3;

  return (
    <div data-testid="brief-tab" data-cache-state={cacheState} className={SHELL}>
      <div
        data-testid={cachedAt ? "brief-cache-hit" : "brief-cache-miss"}
        className="hidden"
      />
      {cachedAt ? (
        <p className="font-data text-[10px] uppercase tracking-[0.10em] text-text-faint mb-3">
          Cached {relativeTime(cachedAt)}
        </p>
      ) : null}
      {hasSections ? (
        <div className="space-y-4">
          {sectionEntries.map(([label, body]) => (
            <section
              key={label}
              data-testid={`brief-section-${slugify(label)}`}
              className="space-y-1"
            >
              <h3 className="font-data text-[11px] uppercase tracking-[0.10em] text-text-secondary">
                {label}
              </h3>
              <div className="font-sans text-[13px] text-text-secondary leading-relaxed prose prose-sm max-w-none">
                <ReactMarkdown>{body}</ReactMarkdown>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div
          data-testid="brief-fallback-markdown"
          className="font-sans text-[13px] text-text-secondary leading-relaxed prose prose-sm max-w-none"
        >
          <ReactMarkdown>{parsed.rawMarkdown}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
