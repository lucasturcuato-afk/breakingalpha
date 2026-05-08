"use client";

/**
 * ArticlesRow (PR-C2) -- single article row with 5 cells.
 *
 * Sentiment is lowercased server-side; we map to UPPERCASE tone before
 * SentimentPill. Keyboard nav: ArrowDown / ArrowUp on the anchor moves
 * focus to the adjacent row's anchor (no roving-tabindex on <tr>).
 */

import type { KeyboardEvent, Ref } from "react";

import { SentimentPill, type SentimentTone } from "@/components/ui/sentiment-pill";
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
  "font-data inline-block rounded-[2px] border border-[var(--gold-border)] bg-[var(--gold-muted)] px-[6px] py-[2px] text-[9px] font-bold uppercase text-[var(--gold-dark)]";
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

  function onKeyDown(e: KeyboardEvent<HTMLAnchorElement>) {
    if (e.key === "ArrowDown" && index < total - 1) {
      e.preventDefault();
      onArrow(index, 1);
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      onArrow(index, -1);
    }
  }

  const rowBg = index % 2 === 1 ? "bg-[var(--row-alt)]" : "";

  return (
    <tr
      data-testid="articles-row"
      className={`border-b border-border-subtle last:border-b-0 transition-colors hover:bg-[var(--row-hover)] ${rowBg}`}
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
          onKeyDown={onKeyDown}
          className={LINK}
        >
          {article.title || "Untitled"}
        </a>
      </td>
      <td
        data-testid="articles-row-source"
        className={`${TD} text-xs text-text-muted truncate`}
      >
        {article.source ?? ""}
      </td>
      <td data-testid="articles-row-tone" className={TD}>
        <SentimentPill tone={tone} size="xs" />
      </td>
      <td
        data-testid="articles-row-published-at"
        className={`${TD} text-right text-xs text-text-muted`}
      >
        {article.publishedAt ? (
          <time dateTime={article.publishedAt}>{formatAge(article.publishedAt)}</time>
        ) : (
          ""
        )}
      </td>
    </tr>
  );
}
