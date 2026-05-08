"use client";

/**
 * ArticlesTable (PR-C2) -- semantic 5-column table.
 *
 * Columns: deal-type chip | headline | source | tone | age. Spec omits
 * relevanceScore. Anchor refs collected here so ArticlesRow can move
 * focus across rows on ArrowDown / ArrowUp.
 */

import { useCallback, useRef } from "react";

import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";

import { ArticlesRow } from "./ArticlesRow";

export interface ArticlesTableProps {
  articles: CompanyDetailArticle[];
}

const TH = "px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted";

export function ArticlesTable({ articles }: ArticlesTableProps) {
  const anchorRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const setAnchorRef = useCallback(
    (i: number) => (el: HTMLAnchorElement | null) => {
      anchorRefs.current[i] = el;
    },
    [],
  );

  const handleArrow = useCallback((i: number, delta: 1 | -1) => {
    anchorRefs.current[i + delta]?.focus();
  }, []);

  return (
    <div className="overflow-hidden rounded-md border border-border-subtle bg-cream-hi">
      <table
        data-testid="articles-table"
        className="w-full border-collapse text-left text-sm"
      >
        <thead>
          <tr className="border-b border-border-subtle bg-[var(--row-alt)]">
            <th className={`${TH} w-[88px]`}>Type</th>
            <th className={TH}>Headline</th>
            <th className={`${TH} w-[120px]`}>Source</th>
            <th className={`${TH} w-[88px]`}>Tone</th>
            <th className={`${TH} w-[72px] text-right`}>Age</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((a, i) => (
            <ArticlesRow
              key={a.id}
              article={a}
              index={i}
              total={articles.length}
              anchorRef={setAnchorRef(i)}
              onArrow={handleArrow}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
