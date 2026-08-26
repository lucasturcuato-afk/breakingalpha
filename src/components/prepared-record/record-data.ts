import type { OutcomeState } from "@/components/ledger";

/**
 * The Prepared record's SHAPE and its content-free derivations.
 *
 * Split out of `./fixture` so the client component can reach the types, the
 * three pure helpers and the no-record constant without pulling the sample
 * entries into the browser bundle. `RecordScreen` is a client component, and a
 * value import from a module is a download of that whole module: importing
 * `countsByState` from `./fixture` shipped all forty-one invented claims into
 * `.next/static`, where the gate cannot reach them because the gate only stops
 * the render.
 *
 * Nothing in this file states a fact about a reader or a market. There are no
 * entries here, no name, no dates, no results. That is the property that makes
 * it safe on both sides of the boundary, and it is the property to check
 * before adding anything to it.
 *
 * COMPLIANCE, and this screen is the one most likely to break it:
 *
 *  - No aggregate figure anywhere, including in `./fixture`. Nothing here is a
 *    rate, a ratio or a percentage of the record. The four bucket numbers and
 *    the per-month numbers are COUNTS, derived from the entries themselves by
 *    `countsByState` and `groupByMonth` below, so the strip and the list can
 *    never disagree and no denominator is ever printed beside them.
 *  - Challenged entries sit in line where they fell. Nothing here sorts,
 *    filters or ranks by state. `fixture.test.ts` asserts both.
 */

export interface RecordEntry {
  id: string;
  /** ISO date the call was entered. Rendered verbatim in the mono lead. */
  date: string;
  state: OutcomeState;
  /** The falsifiable sentence, as it was written before the outcome. */
  claim: string;
  /**
   * The user's own reasoning, written before the outcome was known. The
   * strongest idea on the screen: a record of adopted calls proves the user
   * clicked, a record carrying their reasoning proves they thought.
   */
  note: string;
  /** How it settled, against what benchmark. Absent while a call is awaiting. */
  result?: string;
  /** When it will be checked. Present only while a call is awaiting. */
  window?: string;
}

export interface RecordData {
  /** Whose record. The artifact is signed; that is part of what makes it one. */
  name: string;
  /** One strict reverse-chronological sequence. Never re-sorted downstream. */
  entries: RecordEntry[];
  /**
   * Entries that settled after this record was prepared. Drives the stale
   * notice only. A count, never a rate.
   */
  settledSincePrepared: number;
  /** When this record was prepared, already formatted. Never a clock. */
  preparedAt: string;
}

/** A month of the record, in the order the record renders it. */
export interface RecordMonth {
  /** e.g. "February 2027". */
  label: string;
  entries: RecordEntry[];
}

const MONTH_LABEL: Intl.DateTimeFormatOptions = {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
};

const LONG_DATE: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
};

/**
 * Parse the date field at UTC, whatever precision it arrives in. The field is
 * documented as a plain ISO date, but a real loader reading a timestamp column
 * hands back "2027-02-20T14:03:00Z", and appending a second time part to that
 * yields an Invalid Date: every month label becomes "Invalid Date", every one
 * of them compares equal, and the whole record collapses into one bucket with
 * no month rules in it. Taking the date part is one call and removes the mode.
 */
function atUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** "June 2, 2026". Used for the range line under the name. */
export function longDate(iso: string): string {
  return atUtc(iso).toLocaleDateString("en-US", LONG_DATE);
}

/**
 * Group into months WITHOUT sorting. The sequence is already the record's
 * order, and re-sorting it here would be a second opinion about that order,
 * which is exactly what the screen promises it does not have. A month boundary
 * is a label on the sequence rather than a bucket the sequence is poured into:
 * an entry arriving out of order shows up out of order instead of being quietly
 * filed, which is the failure the design's own markup made.
 */
export function groupByMonth(entries: RecordEntry[]): RecordMonth[] {
  const months: RecordMonth[] = [];
  for (const entry of entries) {
    const label = atUtc(entry.date).toLocaleDateString("en-US", MONTH_LABEL);
    const last = months[months.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else months.push({ label, entries: [entry] });
  }
  return months;
}

/**
 * Counts, in the fixed order of the four states. Never a denominator beside
 * them and never a figure derived from them.
 */
export function countsByState(entries: RecordEntry[]): Record<OutcomeState, number> {
  const counts: Record<OutcomeState, number> = {
    supported: 0,
    challenged: 0,
    developing: 0,
    awaiting: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}

/**
 * No record at all: no name, no entries, nothing derived. What production
 * renders while there is no loader behind this screen.
 *
 * Not a spread of the fixture. Everything in it is empty on purpose, because
 * the one thing this screen must never do is show a person someone else's
 * name over a record of calls they did not make. It pairs with
 * `stage="unavailable"`, and it used to pair with `stage="error"`, which was
 * wrong in the way this screen exists to catch: in production nothing is read
 * and nothing fails, so "This is a failed read" was a fallback asserting a
 * fact it has no source for. The gate keeps the fixture back by design, and
 * the copy now says that instead.
 */
export const RECORD_UNAVAILABLE: RecordData = {
  name: "",
  entries: [],
  settledSincePrepared: 0,
  preparedAt: "",
};
