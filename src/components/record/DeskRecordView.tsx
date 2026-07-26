"use client";

/**
 * DeskRecordView - Signalera's own call record, rendered honestly.
 *
 * PURELY PRESENTATIONAL. Every decision (bucketing, counts, verdict words,
 * ordering) is made in src/lib/desk-record.ts and locked by
 * tests/unit/desk-record.test.ts. This file only lays the model out, so the
 * counts on screen cannot disagree with the tested model.
 *
 * HONESTY IS THE LAYOUT:
 *  - The four buckets are one grid of identical tiles. Supported, Challenged,
 *    No clean read and Not graded get the same size, weight and position
 *    treatment. There is no hero number, no headline hit rate, no ordering
 *    that buries the misses.
 *  - The list is unfiltered and reverse chronological. A wrong call sits in
 *    line wherever it fell.
 *  - The attribution explainer is on the page, not in a tooltip, because the
 *    clean-vs-confounded distinction is the whole reason the record is worth
 *    anything.
 *
 * Resolved calls render through the shared ScoredObject component; it is not
 * forked, only fed props from the shared mapper.
 *
 * COMPLIANCE: a record of the desk's own analytical calls. Never a
 * performance or return claim, never aggregated into anything profit-shaped.
 */

import { ScoredObject } from "@/components/scored-object/ScoredObject";
import {
  ATTRIBUTION_ORDER,
  DESK_RECORD_COPY as COPY,
  RESOLUTION_ORDER,
  type DeskRecord,
  type Resolution,
} from "@/lib/desk-record.ts";

const SERIF = "var(--font-playfair-display), serif";

/** Same tokens the scored objects use for their spines, so a tile and the
 *  cards beneath it read as the same state. Colour marks state, not rank. */
const RESOLUTION_COLOR: Record<Resolution, string> = {
  supported: "var(--signal-up)",
  challenged: "var(--signal-dn)",
  noCleanRead: "var(--text-muted)",
  notGraded: "var(--border-subtle)",
};

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
      {children}
    </h2>
  );
}

/** One bucket tile. Identical markup for all four; only the label, count and
 *  state colour differ. Nothing here scales with whether it is a hit. */
function BucketTile({
  resolution,
  count,
  total,
}: {
  resolution: Resolution;
  count: number;
  total: number;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-4">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: RESOLUTION_COLOR[resolution] }}
        />
        <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          {COPY.bucketLabel[resolution]}
        </span>
      </div>
      <p
        className="mt-2 text-text-primary"
        style={{ fontFamily: SERIF, fontSize: "32px", lineHeight: 1.1 }}
      >
        {count}
        <span className="ml-1.5 font-sans text-[12px] font-normal text-text-faint">
          of {total}
        </span>
      </p>
      <p className="mt-2 font-sans text-[12px] leading-[1.5] text-text-muted">
        {COPY.bucketNote[resolution]}
      </p>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated px-5 py-6">
      <p className="text-text-primary" style={{ fontFamily: SERIF, fontSize: "18px" }}>
        {title}
      </p>
      <p className="mt-2 max-w-[62ch] font-sans text-[13px] leading-[1.6] text-text-muted">
        {body}
      </p>
    </div>
  );
}

export function DeskRecordView({
  record,
  status,
}: {
  record: DeskRecord | null;
  /** "error" and "empty" both render honest copy, never a zeroed headline. */
  status: "loading" | "ready" | "error";
}) {
  const from = shortDate(record?.firstBriefDate ?? null);
  const to = shortDate(record?.lastBriefDate ?? null);

  return (
    <section>
      <header className="mb-5">
        <h1 className="text-text-primary" style={{ fontFamily: SERIF, fontSize: "28px" }}>
          {COPY.title}
        </h1>
        <p className="mt-2 max-w-[68ch] font-sans text-[13px] leading-[1.6] text-text-secondary">
          {COPY.intro}
        </p>
        {status === "ready" && record && record.total > 0 && from && to && (
          <p className="mt-1.5 font-sans text-[12px] text-text-faint">
            {`${record.total} graded calls, ${from} to ${to}.`} {COPY.awaitingNote}
          </p>
        )}
      </header>

      {status === "loading" && (
        <div
          className="h-[120px] rounded-lg border border-border-subtle bg-elevated"
          aria-hidden
        />
      )}

      {status === "error" && <EmptyPanel title={COPY.errorTitle} body={COPY.errorBody} />}

      {status === "ready" && (!record || record.total === 0) && (
        <EmptyPanel title={COPY.emptyTitle} body={COPY.emptyBody} />
      )}

      {status === "ready" && record && record.total > 0 && (
        <>
          <SectionHeading>{COPY.countsHeading}</SectionHeading>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RESOLUTION_ORDER.map((r) => (
              <BucketTile
                key={r}
                resolution={r}
                count={record.byResolution[r]}
                total={record.total}
              />
            ))}
          </div>

          <div className="mt-8">
            <SectionHeading>{COPY.attributionCountsHeading}</SectionHeading>
            <div className="rounded-lg border border-border-subtle bg-elevated p-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {ATTRIBUTION_ORDER.map((key) => (
                  <div key={key}>
                    <dt className="font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                      {COPY.attributionLabel[key]}
                    </dt>
                    <dd
                      className="mt-1 text-text-primary"
                      style={{ fontFamily: SERIF, fontSize: "22px", lineHeight: 1.1 }}
                    >
                      {record.byAttribution[key] ?? 0}
                    </dd>
                  </div>
                ))}
              </dl>
              <hr className="my-4 border-t border-border-subtle" />
              <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                {COPY.attributionHeading}
              </p>
              <p className="mt-2 max-w-[76ch] font-sans text-[13px] leading-[1.65] text-text-secondary">
                {COPY.attributionExplainer}
              </p>
            </div>
          </div>

          <div className="mt-8">
            <SectionHeading>{COPY.listHeading}</SectionHeading>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {record.entries.map((entry) => (
                <ScoredObject key={entry.id} {...entry.props} />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default DeskRecordView;
