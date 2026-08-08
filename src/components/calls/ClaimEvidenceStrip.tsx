/**
 * ClaimEvidenceStrip - what has landed against an open claim since it was
 * committed. Plain counts and the most recent few stories with their dates.
 *
 * Deliberately NOT a score. No percentage, no ratio, no implied verdict: the
 * price-attribution grader is the only thing that resolves a claim. When nothing
 * has matched, which is the common case (most stories are neutral and record
 * nothing), it says so plainly rather than rendering a zeroed scoreboard.
 *
 * Pure presentation over the summary from src/lib/claim-evidence.ts.
 */

import {
  summarizeClaimEvidence,
  evidenceCountLine,
  EVIDENCE_COPY,
  type RawEvidenceRow,
} from "@/lib/claim-evidence";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ClaimEvidenceStrip({ rows }: { rows: RawEvidenceRow[] | null | undefined }) {
  const summary = summarizeClaimEvidence(rows);

  if (summary.isEmpty) {
    return (
      <p
        data-testid="claim-evidence-empty"
        className="motion-fade-reveal mt-1 px-1 font-sans text-[11px] leading-snug text-text-faint"
      >
        {EVIDENCE_COPY.empty}
      </p>
    );
  }

  const line = evidenceCountLine(summary);

  return (
    <div data-testid="claim-evidence" className="motion-fade-reveal mt-1 px-1">
      <p className="font-sans text-[11px] font-medium leading-snug text-text-muted">
        <span className="text-signal-up">{summary.supporting} supporting</span>
        {", "}
        <span className="text-signal-dn">{summary.challenging} challenging</span>{" "}
        <span className="text-text-faint">{EVIDENCE_COPY.since}</span>
        <span className="sr-only">{line}</span>
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {summary.recent.map((item, i) => (
          <li
            key={i}
            className="flex items-baseline gap-1.5 font-sans text-[10.5px] leading-snug text-text-faint"
          >
            <span
              className={item.stance === "support" ? "text-signal-up" : "text-signal-dn"}
              aria-hidden
            >
              {item.stance === "support" ? "+" : "-"}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-muted">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {item.title ?? "Untitled story"}
                </a>
              ) : (
                (item.title ?? "Untitled story")
              )}
            </span>
            {item.publishedAt && (
              <span className="shrink-0 tabular-nums">{shortDate(item.publishedAt)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
