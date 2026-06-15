// Pure EDGAR URL builder, keyed by a company's SEC CIK.
//
// Lives in a dedicated leaf module (no "@/..." imports) so it stays importable
// under the node:test runner, which cannot resolve the "@/" path alias that
// sec-filings.ts pulls in via company-intel. sec-filings.ts re-exports this, so
// callers import it from "@/lib/sec-filings". Zero-pads the CIK to 10 digits to
// match the backend's str(cik).zfill(10) (backend/edgar/submissions.py).

export function edgarFilingsUrl(cik: number): string {
  const padded = String(cik).padStart(10, "0");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}&type=&dateb=&owner=include&count=40`;
}
