"use client";

/**
 * ArticlesTable (PR-C2 + PR-C1e) -- semantic 6-column table.
 *
 * Columns: deal-type chip | headline | source | score | tone | age.
 * Score restored in PR-C1e (DirectionD L762-811). Anchor refs collected
 * here so ArticlesRow can move focus across rows on ArrowDown / ArrowUp.
 */

import { useCallback, useRef } from "react";

import type { CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";

import { ArticlesRow } from "./ArticlesRow";

export interface ArticlesTableProps {
  articles: CompanyDetailArticle[];
}

const TH = "px-3 py-2 text-[10px] font-semibold text-text-muted";

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
    <div className="overflow-x-auto rounded-md border border-border-subtle bg-cream-hi">
      <table
        data-testid="articles-table"
        className="w-full table-fixed border-collapse text-left text-sm min-w-[700px]"
      >
        <thead>
          <tr className="border-b border-border-subtle bg-[var(--row-alt)]">
            <th className={`${TH} w-[88px]`}>Type</th>
            <th className={`${TH} min-w-[200px]`}>Headline</th>
            <th className={`${TH} w-[160px]`}>Source</th>
            <th className={`${TH} w-[56px] text-right`}>Score</th>
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
