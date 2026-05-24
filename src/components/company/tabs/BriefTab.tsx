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
  regenerations_remaining_today?: number;
  resetsAt?: string;
}

interface CacheResponse {
  cached: boolean;
  markdown?: string;
  generated_at?: string;
  regenerations_remaining_today?: number;
}

type Phase = "checking-cache" | "ready" | "generating" | "error";

// WD70: BriefTab Regenerate button daily quota. Kept in lockstep with the
// MEMO_REGENERATIONS_PER_DAY constant in /api/memo/route.ts.
const MEMO_REGENERATIONS_PER_DAY = 3;

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
  // WD70: Regenerate state.
  const [regenRemaining, setRegenRemaining] = useState<number>(MEMO_REGENERATIONS_PER_DAY);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [regenToast, setRegenToast] = useState<string | null>(null);

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
        if (typeof data.regenerations_remaining_today === "number") {
          setRegenRemaining(data.regenerations_remaining_today);
        }
        if (res.ok && data.cached && typeof data.markdown === "string" && data.markdown.length > 0) {
          setParsed(parseMemo(data.markdown));
          setCachedAt(data.generated_at ?? null);
        }
      } catch {
        // network failure, render miss path
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
      if (typeof data.regenerations_remaining_today === "number") {
        setRegenRemaining(data.regenerations_remaining_today);
      }
      setParsed(parseMemo(data.memo));
      setCachedAt(null);
      setPhase("ready");
    } catch {
      setErrorMessage("Network error while generating brief.");
      setPhase("error");
    }
  };

  // WD70: in-place regenerate. Does NOT swap to the full-screen generating
  // skeleton (the user is already looking at a brief). Disables the button,
  // posts to /api/memo?regenerate=true, swaps memo content on success, and
  // surfaces a small inline toast on 429.
  const regenerateBrief = async () => {
    if (!content || isRegenerating) return;
    setIsRegenerating(true);
    setRegenToast(null);
    try {
      const res = await fetch("/api/memo?regenerate=true", {
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
      if (res.status === 429) {
        setRegenRemaining(0);
        setRegenToast("Daily regeneration limit reached. Resets at midnight UTC.");
        return;
      }
      if (!res.ok || typeof data.memo !== "string" || data.memo.length === 0) {
        setRegenToast(data.error ?? "Failed to regenerate brief.");
        return;
      }
      if (typeof data.regenerations_remaining_today === "number") {
        setRegenRemaining(data.regenerations_remaining_today);
      } else {
        setRegenRemaining((n) => Math.max(0, n - 1));
      }
      setParsed(parseMemo(data.memo));
      setCachedAt(null);
    } catch {
      setRegenToast("Network error while regenerating brief.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const hasContent = phase === "ready" && parsed !== null;
  const cacheState = hasContent ? (cachedAt ? "hit" : "fresh") : "miss";

  // Tailwind v4 utility groups (chrome polish per WD84 + WD85 sweep).
  // - `bodyProse` drops the previous `prose prose-sm` wrap that was
  //   overriding the explicit 13px / leading-relaxed treatment, and adds
  //   bullet styling tuned to the cream/espresso palette.
  const bodyProse = [
    "font-sans text-[13px] text-text-secondary leading-relaxed",
    "[&_p]:m-0 [&_p+p]:mt-2",
    "[&_ul]:pl-5 [&_ul]:list-disc [&_ul]:my-2 [&_li]:my-0.5",
    "[&_li]:marker:text-text-faint",
    "[&_strong]:text-espresso [&_strong]:font-semibold",
  ].join(" ");

  if (phase === "checking-cache" || phase === "generating") {
    return (
      <div data-testid="brief-tab" data-cache-state={cacheState} className={SHELL}>
        <div
          data-testid="brief-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="space-y-3"
        >
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
          {phase === "generating" ? (
            <p className="font-data text-[11px] uppercase tracking-[0.10em] text-text-faint text-center pt-2">
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
        <div
          data-testid="brief-error"
          role="alert"
          className="flex flex-col gap-2 py-2"
        >
          <p className="font-sans text-[13px] text-signal-dn">
            {errorMessage ?? "An unexpected error occurred."}
          </p>
          <div>
            <Button
              data-testid="brief-generate-button"
              variant="secondary"
              onClick={generateBrief}
            >
              Retry
            </Button>
          </div>
        </div>
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
            description="Generate an analyst brief from the latest article corpus."
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
  const hasSections = sectionEntries.length >= 2;
  const regenDisabled = isRegenerating || regenRemaining <= 0 || !content;

  return (
    <div data-testid="brief-tab" data-cache-state={cacheState} className={SHELL}>
      <div
        data-testid={cachedAt ? "brief-cache-hit" : "brief-cache-miss"}
        className="hidden"
      />
      <div className="flex items-start justify-between gap-3 mb-4">
        {cachedAt ? (
          <p className="font-data text-[10px] uppercase tracking-[0.10em] text-text-faint">
            Cached {relativeTime(cachedAt)}
          </p>
        ) : (
          <span aria-hidden className="invisible" />
        )}
        <div className="flex items-center gap-2">
          {regenToast ? (
            <span
              data-testid="brief-regenerate-toast"
              className="font-sans text-[11px] text-signal-dn font-semibold"
              role="status"
            >
              {regenToast}
            </span>
          ) : null}
          <Button
            data-testid="brief-regenerate-button"
            variant="secondary"
            size="sm"
            disabled={regenDisabled}
            onClick={regenerateBrief}
          >
            {isRegenerating ? (
              <>
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-full border border-text-faint border-t-transparent animate-spin"
                />
                Regenerating
              </>
            ) : (
              <>Regenerate ({regenRemaining}/{MEMO_REGENERATIONS_PER_DAY} today)</>
            )}
          </Button>
        </div>
      </div>
      {hasSections ? (
        <div className="space-y-4">
          {sectionEntries.map(([label, body], i) => {
            const ordinal = String(i + 1).padStart(2, "0");
            // WD84: first section gets the gold-faint TLDR treatment per
            // DirectionD MemoCard L668-677 to anchor the lead beat.
            if (i === 0) {
              return (
                <section
                  key={label}
                  data-testid={`brief-section-${slugify(label)}`}
                  className="rounded-md border border-gold-border bg-gold-muted px-[14px] py-[11px] space-y-1"
                >
                  <h3
                    data-testid="brief-tldr-eyebrow"
                    className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-gold-dark"
                  >
                    TLDR
                  </h3>
                  <div className={bodyProse}>
                    <ReactMarkdown>{body}</ReactMarkdown>
                  </div>
                </section>
              );
            }
            return (
              <section
                key={label}
                data-testid={`brief-section-${slugify(label)}`}
                className="space-y-1"
              >
                <h3 className="font-mono text-[9.5px] font-bold uppercase tracking-[0.10em] text-text-faint">
                  {ordinal} · {label}
                </h3>
                <div className={bodyProse}>
                  <ReactMarkdown>{body}</ReactMarkdown>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-data text-[10px] uppercase tracking-[0.10em] text-text-faint">
            Showing unparsed memo
          </p>
          <div
            data-testid="brief-fallback-markdown"
            className={bodyProse}
          >
            <ReactMarkdown>{parsed.rawMarkdown}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
