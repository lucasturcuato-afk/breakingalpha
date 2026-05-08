"use client";

// BriefTab (PR-C1): F1 Brief container. POSTs /api/memo (type=company) on
// mount, composes BriefTLDR + BriefLead + BriefContext + BriefWatch on
// data.structured. Loading: 3-line skeleton. Empty: when fetch fails or
// data.structured is null. Markdown-only fallback rendered as <pre>.
// Paragraph lookup is kind-based per recon Section 1.

import { useEffect, useState } from "react";

import type { StructuredMemo } from "@/lib/memo-schema";

import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

import { BriefTLDR } from "../BriefTLDR";
import { BriefLead } from "../BriefLead";
import { BriefContext } from "../BriefContext";
import { BriefWatch } from "../BriefWatch";

interface BriefTabProps {
  /** Canonical company name. Sent as `company` to /api/memo. */
  company: string;
  /** Concatenated article-summary content used as memo input. */
  content: string;
}

interface MemoResponse {
  structured?: StructuredMemo;
  memo?: string;
  error?: string;
}

export function BriefTab({ company, content }: BriefTabProps) {
  const [loading, setLoading] = useState(true);
  const [structured, setStructured] = useState<StructuredMemo | null>(null);
  const [memoMarkdown, setMemoMarkdown] = useState<string | null>(null);

  useEffect(() => {
    if (!content) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setStructured(null);
    setMemoMarkdown(null);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "company", company, content }),
        });
        const data: MemoResponse = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.structured) {
          setStructured(data.structured);
        } else if (res.ok && data.memo) {
          setMemoMarkdown(data.memo);
        }
      } catch {
        // network / parse failure -> empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [company, content]);

  // TODO(C5/D1): wire scroll-to-source on Sources tab once F5 ships.
  const onCiteClick = () => {};

  if (loading) {
    return (
      <div data-testid="brief-tab" className="bg-cream-hi border border-border-base rounded-lg p-4">
        <div data-testid="brief-loading" className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    );
  }

  if (!structured) {
    return (
      <div data-testid="brief-tab" className="bg-cream-hi border border-border-base rounded-lg p-4">
        {memoMarkdown ? (
          <pre className="font-sans text-[13px] text-text-secondary whitespace-pre-wrap leading-relaxed">
            {memoMarkdown}
          </pre>
        ) : (
          <div data-testid="brief-empty-state">
            <EmptyState
              title="Memo not yet generated"
              description="Triggers on the next pipeline cycle."
            />
          </div>
        )}
      </div>
    );
  }

  const lead = structured.paragraphs.find((p) => p.kind === "lead");
  const context = structured.paragraphs.find((p) => p.kind === "context");
  const watch = structured.paragraphs.find((p) => p.kind === "watch");
  const sourceCount = structured.sources.length;

  return (
    <div data-testid="brief-tab" className="bg-cream-hi border border-border-base rounded-lg p-4">
      <BriefTLDR tldr={structured.tldr} sourceCount={sourceCount} onCiteClick={onCiteClick} />
      {lead ? <BriefLead text={lead.text} sourceCount={sourceCount} onCiteClick={onCiteClick} /> : null}
      {context ? <BriefContext text={context.text} sourceCount={sourceCount} onCiteClick={onCiteClick} /> : null}
      {watch ? <BriefWatch text={watch.text} sourceCount={sourceCount} onCiteClick={onCiteClick} /> : null}
    </div>
  );
}
