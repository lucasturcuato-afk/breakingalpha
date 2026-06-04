"use client";

/**
 * ToneArticleDetail (WD110 Element 3, re-scoped 2026-06-03) -- click-through
 * detail for one tone-evidence article. Side panel on desktop (>=768px),
 * bottom sheet on mobile. The headline content is sentiment_reason (WD49):
 * the model's "why" for the sentiment label, which had no UI presence before.
 *
 * Portal + backdrop + Escape conventions follow MemoModal.tsx; this surface
 * stays read-only (no generation, no feedback controls).
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";

import { SentimentPill, type SentimentTone } from "@/components/ui/sentiment-pill";
import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";

const TONE_MAP: Record<string, SentimentTone> = {
  bullish: "BULLISH",
  bearish: "BEARISH",
  neutral: "NEUTRAL",
};

function toTone(s: string | null): SentimentTone {
  return TONE_MAP[(s ?? "").toLowerCase()] ?? "NEUTRAL";
}

function formatAge(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(t);
}

export interface ToneArticleDetailProps {
  article: CompanyDetailArticle;
  onClose: () => void;
}

export function ToneArticleDetail({ article, onClose }: ToneArticleDetailProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Escape closes; focus moves to the close button on open and back to the
  // opener on unmount (the opener row is the previously focused element).
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  const tone = toTone(article.sentiment);
  const reason = article.sentimentReason?.trim() || null;
  const summary = article.summary?.trim() || null;
  const published = formatDate(article.publishedAt);
  const age = formatAge(article.publishedAt);

  return createPortal(
    <div
      data-testid="tone-article-detail-overlay"
      className="fixed inset-0 z-[9999] bg-espresso/50 flex items-end md:items-stretch md:justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="tone-article-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Tone detail: ${article.title || "Untitled"}`}
        className="bg-parchment border-border-base flex w-full max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border shadow-2xl md:h-full md:max-h-none md:w-[440px] md:rounded-none md:border-y-0 md:border-r-0 md:border-l"
      >
        {/* ── Head: eyebrow + close ── */}
        <div className="border-border-subtle flex items-center justify-between border-b px-5 py-3">
          <span className="font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Tone evidence
          </span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close article detail"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── Title + provenance ── */}
          <h2 className="font-display text-[17px] font-bold leading-snug text-text-primary">
            {article.title || "Untitled"}
          </h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] text-text-muted">
            {article.source ? <span className="font-semibold">{article.source}</span> : null}
            {published ? (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={article.publishedAt ?? undefined}>{published}</time>
              </>
            ) : null}
            {age ? <span className="font-data">({age})</span> : null}
          </div>

          <div className="mt-3">
            <SentimentPill tone={tone} size="md" testId="tone-article-detail-pill" />
          </div>

          {/* ── sentiment_reason: the headline content of this surface ── */}
          {reason ? (
            <div
              data-testid="tone-article-detail-reason"
              className="border-gold-border bg-gold-muted mt-4 rounded-md border px-4 py-3"
            >
              <div className="font-data text-[10px] font-semibold uppercase tracking-widest text-gold-dark">
                Why this tone
              </div>
              <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-text-primary">
                {reason}
              </p>
            </div>
          ) : null}

          {summary ? (
            <div className="mt-4">
              <div className="font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                Summary
              </div>
              <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-text-secondary">
                {summary}
              </p>
            </div>
          ) : null}
        </div>

        {/* ── Outbound link ── */}
        {article.url ? (
          <div className="border-border-subtle border-t px-5 py-3">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-sans text-[12px] font-semibold text-gold-dark transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
            >
              Read full article{article.source ? ` on ${article.source}` : ""}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
