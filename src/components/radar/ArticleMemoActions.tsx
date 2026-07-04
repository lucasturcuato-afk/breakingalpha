"use client";

/**
 * ArticleMemoActions — the same article hover affordance as the live
 * feed and watchlist feed: a hover-revealed action row with Generate
 * Memo (gold, Sparkles -> MemoModal type "article", withCompanyLine)
 * and a view-source link. Put `group` on the hovered container; this
 * row fades in on group-hover (and stays reachable via focus).
 */

import { useState } from "react";
import Link from "next/link";
import { Sparkles, ExternalLink, Crosshair } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { withCompanyLine } from "@/lib/memo-company-line";

export interface MemoableArticle {
  id: string;
  title: string;
  source?: string | null;
  url?: string | null;
  primary_company?: string | null;
}

export function ArticleMemoActions({
  article,
  alwaysVisible = false,
  trackHref,
}: {
  article: MemoableArticle;
  alwaysVisible?: boolean;
  /** Optional "Track" action: routes to the Calls authoring flow with
   *  this article as the draft intent (e.g. `/radar/calls?draft=...`).
   *  The user still authors and confirms; nothing is tracked silently. */
  trackHref?: string;
}) {
  const [memoOpen, setMemoOpen] = useState(false);
  return (
    <>
      <div
        className={
          "mt-2 flex items-center gap-2 " +
          (alwaysVisible ? "" : "motion-fade-reveal")
        }
      >
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMemoOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 font-sans text-[11px] font-semibold text-cream transition-colors hover:bg-gold-dark"
        >
          <Sparkles size={11} />
          Generate Memo
        </button>
        {trackHref && (
          <Link
            href={trackHref}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-sans text-[11px] text-text-muted hover:text-text-primary"
          >
            <Crosshair size={11} />
            Track
          </Link>
        )}
        {article.url && (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-sans text-[11px] text-text-muted hover:text-text-primary"
          >
            <ExternalLink size={11} />
            View source
          </a>
        )}
      </div>
      {memoOpen && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoOpen(false)}
          title={article.title}
          content={withCompanyLine(
            `${article.title}\n${article.source ?? ""}`,
            article.primary_company,
          )}
          type="article"
        />
      )}
    </>
  );
}

export default ArticleMemoActions;
