/**
 * makeCallLink — route a story into the call author flow, pre-filled.
 *
 * Option A consolidation: the ONE thing a user creates is a call
 * (user_claims). Every former "Add to Thesis" action now navigates to
 * /radar/calls?draft=<text>, where the existing composer picks the text up
 * (calls/page.tsx reads ?draft=), the LLM proposes a symbol, direction and
 * resolution window, and the USER reviews and edits all of it before
 * committing. Nothing is written by the click itself: no auto-commit, no
 * write to the theses table, no call inferred from sentiment. The user owns
 * the stated view or nothing is stored.
 *
 * The draft is capped at 400 chars to match MAX_CLAIM_CHARS in
 * /api/radar/claims/author -- the composer would truncate anyway; truncating
 * here keeps the URL honest about what will be proposed.
 */

const MAX_DRAFT_CHARS = 400;

export function makeCallLink(text: string | null | undefined): string {
  const draft = (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DRAFT_CHARS);
  if (!draft) return "/radar/calls";
  return `/radar/calls?draft=${encodeURIComponent(draft)}`;
}
