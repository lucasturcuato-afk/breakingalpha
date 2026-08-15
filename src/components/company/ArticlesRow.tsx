"use client";

/**
 * ArticlesRow (PR-C2 + PR-C1e) -- single article row with 6 cells.
 *
 * Sentiment is lowercased server-side; we map to UPPERCASE tone before
 * SentimentPill. Keyboard nav: ArrowDown / ArrowUp on the anchor moves
 * focus to the adjacent row's anchor (no roving-tabindex on <tr>).
 *
 * PR-C1e additions: Score cell between Source and Tone, SourceCredibilityBadge
 * appended after the source name, and a click-to-expand summary row.
 * Expanded state is per-row local (no persistence, multiple rows can be open).
 */

import { useState } from "react";
import type { KeyboardEvent, Ref, MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown } from "lucide-react";

import { SentimentPill, type SentimentTone } from "@/components/ui/sentiment-pill";
import { CompletenessBadge, SourceCredibilityBadge } from "@/lib/article-signal";
import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";

export interface ArticlesRowProps {
  article: CompanyDetailArticle;
  index: number;
  total: number;
  anchorRef: Ref<HTMLAnchorElement>;
  onArrow: (index: number, delta: 1 | -1) => void;
}

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

const TD = "px-3 py-2 align-middle";
const CHIP =
  "font-sans inline-block rounded-[2px] border border-border-subtle bg-[var(--row-alt)] px-[6px] py-[2px] text-[9px] font-bold text-text-muted";
const LINK =
  "block truncate text-text-primary hover:text-gold-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm";

export function ArticlesRow({
  article,
  index,
  total,
  anchorRef,
  onArrow,
}: ArticlesRowProps) {
  const tone = toTone(article.sentiment);
  const dealType = article.dealType;
  const [expanded, setExpanded] = useState(false);
  const reasonText =
    article.relevanceReason && article.relevanceReason.trim().length > 0
      ? article.relevanceReason.trim()
      : null;
  const summaryText =
    article.summary && article.summary.trim().length > 0
      ? article.summary.trim()
      : null;
  // WD74: prefer LLM-synthesized relevance_reason; fall back to RSS summary for
  // legacy rows where relevance_reason was never populated. Toggle hides if both empty.
  const expandBody = reasonText ?? summaryText;
  const expandLabel = reasonText ? "Why this matters" : null;
  const hasExpandable = expandBody !== null;

  function onAnchorKeyDown(e: KeyboardEvent<HTMLAnchorElement>) {
    if (e.key === "ArrowDown" && index < total - 1) {
      e.preventDefault();
      onArrow(index, 1);
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      onArrow(index, -1);
    }
  }

  function toggle() {
    setExpanded((prev) => !prev);
  }

  function onRowClick(e: ReactMouseEvent<HTMLTableRowElement>) {
    if (!hasExpandable) return;
    const target = e.target as HTMLElement;
    if (target.closest("a")) return;
    if (target.closest('[data-articles-row-toggle="true"]')) return;
    toggle();
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (!hasExpandable) return;
    if (e.key === "Enter" || e.key === " ") {
      const target = e.target as HTMLElement;
      if (target.closest("a")) return;
      e.preventDefault();
      toggle();
    }
  }

  function onToggleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  const rowBg = index % 2 === 1 ? "bg-[var(--row-alt)]" : "";
  const rowInteractive = hasExpandable ? "cursor-pointer" : "";

  return (
    <>
      <tr
        data-testid="articles-row"
        tabIndex={hasExpandable ? 0 : undefined}
        onClick={onRowClick}
        onKeyDown={onRowKeyDown}
        className={`border-b border-border-subtle last:border-b-0 transition-colors hover:bg-[var(--row-hover)] ${rowBg} ${rowInteractive}`}
      >
        <td className={TD}>
          {dealType ? <span className={CHIP}>{dealType}</span> : null}
        </td>
        <td data-testid="articles-row-headline" className={TD}>
          <a
            ref={anchorRef}
            href={article.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            onKeyDown={onAnchorKeyDown}
            className={LINK}
          >
            {article.title || "Untitled"}
          </a>
        </td>
        <td
          data-testid="articles-row-source"
          className={`${TD} text-xs text-text-muted`}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate min-w-0">{article.source ?? ""}</span>
            {article.isWebSourced ? (
              <span
                data-testid="articles-row-web-badge"
                title="Web-sourced (not yet in corpus)"
                className="inline-block rounded-[2px] border border-border-subtle bg-[var(--row-alt)] px-[5px] py-[1px] text-[8px] font-bold text-text-muted dark:text-text-secondary"
              >
                Web
              </span>
            ) : null}
            {article.source != null && !article.isWebSourced ? (
              <SourceCredibilityBadge
                winRate={article.sourceWinRate}
                sampleSize={article.sourceSampleSize}
              />
            ) : null}
            <CompletenessBadge completeness={article.completeness} />
          </span>
        </td>
        <td data-testid="articles-row-tone" className={TD}>
          <SentimentPill tone={tone} size="xs" />
        </td>
        <td
          data-testid="articles-row-published-at"
          className={`${TD} text-right text-xs text-text-muted`}
        >
          <span className="inline-flex items-center justify-end gap-2">
            {article.publishedAt ? (
              <time dateTime={article.publishedAt}>{formatAge(article.publishedAt)}</time>
            ) : (
              <span aria-hidden="true">{""}</span>
            )}
            {hasExpandable ? (
              <button
                type="button"
                data-testid="articles-row-expand-toggle"
                data-articles-row-toggle="true"
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse details" : "Expand details"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                onKeyDown={onToggleKeyDown}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            ) : null}
          </span>
        </td>
      </tr>
      {hasExpandable ? (
        <tr
          data-testid="articles-row-summary-row"
          aria-hidden={!expanded}
          className={expanded ? "border-b border-border-subtle last:border-b-0" : "hidden"}
        >
          <td
            data-testid="articles-row-summary"
            colSpan={5}
            className={`px-4 py-3 text-xs leading-relaxed text-text-secondary bg-[var(--row-alt)] ${rowBg}`}
          >
            {expandLabel ? (
              <div className="mb-1 text-[10px] font-semibold text-text-muted">
                {expandLabel}
              </div>
            ) : null}
            {expandBody}
          </td>
        </tr>
      ) : null}
    </>
  );
}
