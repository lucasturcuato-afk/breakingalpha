/**
 * Timezone formatting helpers — always render timestamps in
 * America/Los_Angeles with an explicit "PT" suffix.
 *
 * Root cause this fixes: Node on Vercel runs UTC. The original
 * brief-pdf.tsx used `toLocaleDateString` with no `timeZone` option, so
 * morning briefs generated at 06:30 PT on 24 April were stamped as
 * "April 24, 2026" at UTC (13:30 UTC) but evening wraps generated at
 * 19:00 PT on 23 April landed at 02:00 UTC the NEXT day and stamped
 * as "April 24" — visibly one day ahead of the trading day they cover.
 *
 * This module is the single source of truth for the two print+PDF paths
 * (Puppeteer-driven `/print/[id]` and the legacy react-pdf fallback in
 * `brief-pdf.tsx`) so the timezone/label bug cannot regress on either.
 *
 * We hard-code the "PT" literal rather than asking Intl for a short
 * timezone name because `timeZoneName: "short"` returns "PDT"/"PST"
 * inconsistently across Node versions — and the spec asks for "PT".
 */

const PT_ZONE = "America/Los_Angeles";

/**
 * "April 23, 2026 · 8:27 PM PT" — spec Section 4.4 format.
 * Returns "" when given null/undefined/unparseable input so callers can
 * drop the stamp rather than render "Invalid Date".
 */
export function formatPTStamp(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${datePart} · ${timePart} PT`;
}

/** "Thursday, April 23" — masthead date line. */
export function formatPTDateLong(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** "8:27 PM PT" — masthead time line. */
export function formatPTTimeShort(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${t} PT`;
}

/** "2026-04-23" in PT — used for PDF filename slugs so Friday-evening
 *  files don't stamp as the next calendar day. */
export function ptDateSlug(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: PT_ZONE })
      .format(new Date());
  }
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PT_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
