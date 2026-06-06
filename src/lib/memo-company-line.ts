/**
 * Prepend a `COMPANY: <name>` line to memo prompt content.
 *
 * Why this exists: /api/memo persists `content.target_company` on every memo
 * row, resolved from (1) an explicit `company` body field or (2) the first
 * `COMPANY: <name>` line in the prompt content (WD126 server-side parser,
 * `extractCompanyFromContent` in src/app/api/memo/route.ts). The outcome
 * grader (backend/outcome/graders/memo.py) reads `content.target_company` to
 * fetch follow-up articles; without it every memo falls back to ungrounded
 * internal-coherence grading.
 *
 * MemoModal is Lucas-protected (read only) and posts only
 * `{content, type, systemPrompt}`, so host surfaces cannot add a body field.
 * The `content` string, however, is host-owned. Prepending a COMPANY: line is
 * the zero-protected-file way to thread the company through to persistence.
 *
 * Mirrors the parser's constraints (route.ts `extractCompanyFromContent`):
 * the value must be a single non-empty line of at most 200 chars, or the
 * server discards it. When the name fails those constraints we return the
 * content unchanged rather than emit a line the parser would reject.
 */
export function withCompanyLine(content: string, company?: string | null): string {
  const name = (company ?? "").trim();
  if (name.length === 0 || name.length > 200 || /[\r\n]/.test(name)) {
    return content;
  }
  return `COMPANY: ${name}\n${content}`;
}
