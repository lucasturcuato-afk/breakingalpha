/**
 * The Deal Flow stage vocabulary, as the mobile screen needs it.
 *
 * The taxonomy itself is not new. `src/app/deal-flow/page.tsx` lines 69 to 76
 * already carries it, and `src/app/saved/page.tsx` lines 13 to 18 carries a second
 * copy with different casing and different colours. batch-6 open question 9
 * asks who owns it. That question is not settled, and settling it from a screen
 * PR would mean editing two live surfaces, so this module does not try: it
 * carries the words the design draws and the tokens the design paints them in,
 * and nothing else. The duplication is recorded in the PR body rather than
 * quietly widened.
 *
 * Colours are read off the rendered prototype, not chosen here:
 *   Rumored    --c-amberink
 *   Announced  --c-secondary
 *   Under LOI  --c-amberink
 *   Closed     --c-greenink
 * Stage colour lives on the card's stage word only. It never reaches a chip.
 */

export type DealStage = "rumored" | "announced" | "under_loi" | "closed";
export type DealLens = "all" | DealStage;

/** Render order, matching the prototype's `order:` values on the four cards. */
export const DEAL_STAGES: readonly DealStage[] = [
  "rumored",
  "announced",
  "under_loi",
  "closed",
];

export const DEAL_LENSES: readonly DealLens[] = ["all", ...DEAL_STAGES];

export const STAGE_LABEL: Record<DealStage, string> = {
  rumored: "Rumored",
  announced: "Announced",
  under_loi: "Under LOI",
  closed: "Closed",
};

/** Ink tokens only. Gold never touches type, and no base token is used here. */
export const STAGE_INK: Record<DealStage, string> = {
  rumored: "var(--c-amberink)",
  announced: "var(--c-secondary)",
  under_loi: "var(--c-amberink)",
  closed: "var(--c-greenink)",
};

/**
 * `stage || status || "rumored"`, the resolver already live at
 * `src/app/deal-flow/page.tsx:91`, narrowed to the four words the design draws.
 *
 * Note measured against the live table this pass: `deal_flow` has no `status`
 * column at all, so the middle term of that fallback never fires in production.
 * Kept anyway because the caller's `Deal` type still declares it.
 */
export function resolveStage(raw?: string | null): DealStage {
  const key = (raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (DEAL_STAGES as readonly string[]).includes(key)
    ? (key as DealStage)
    : "rumored";
}

export function isDealLens(raw?: string | null): raw is DealLens {
  return !!raw && (DEAL_LENSES as readonly string[]).includes(raw);
}

/**
 * The result line under the masthead. The prototype derives a sentence for the
 * unfiltered lens and a compact figure for each of the four others
 * (`dealCount`, prototype line 3598). Both shapes are the design's own strings.
 */
export function lensResultLine(lens: DealLens, count: number): string {
  if (lens === "all") {
    return `${count} deals. The whole universe, not only what you follow.`;
  }
  return `${count} deals · ${STAGE_LABEL[lens]}`;
}
