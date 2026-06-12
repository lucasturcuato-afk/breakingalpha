"use client";

/**
 * ArticlesTab (PR-C2) -- panel-level shell for the Articles tab.
 *
 * Re-sorts articles client-side by publishedAt DESC (server returns by
 * relevance_score DESC). Renders ArticlesTable with the sorted list, or
 * an empty state when no articles are present.
 *
 * Web-sourced fallback rows (isWebSourced, from getArticleFallback) always sort
 * BELOW real in-corpus rows, then by publishedAt DESC within each group. With
 * the fallback flag off, no row carries isWebSourced, so this is identical to
 * the prior pure-recency sort.
 */

import { useMemo } from "react";

import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";

import { ArticlesTable } from "../ArticlesTable";

export interface ArticlesTabProps {
  articles: CompanyDetailArticle[];
}

function ms(value: string | null): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function ArticlesTab({ articles }: ArticlesTabProps) {
  const sorted = useMemo(
    () =>
      [...articles].sort((a, b) => {
        const aw = a.isWebSourced ? 1 : 0;
        const bw = b.isWebSourced ? 1 : 0;
        if (aw !== bw) return aw - bw; // real rows first, web rows last
        return ms(b.publishedAt) - ms(a.publishedAt);
      }),
    [articles],
  );

  if (sorted.length === 0) {
    return (
      <div
        data-testid="articles-tab"
        className="rounded-md border border-border-subtle bg-cream-hi p-6"
      >
        <p data-testid="articles-empty-state" className="text-sm text-text-muted">
          No coverage in last 30 days.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="articles-tab">
      <ArticlesTable articles={sorted} />
    </div>
  );
}
