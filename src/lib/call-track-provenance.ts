/**
 * call-track-provenance.ts - the provenance a commitment event must carry.
 *
 * The chain the dataset depends on is: story surfaced, user read, user
 * committed, reality resolved. The third link is the only one that cannot be
 * reconstructed after the fact. Once the tap has happened there is nothing in
 * the row to recover which claim the user was reading from, so it has to be
 * written at the moment.
 *
 * #519 attached this ambiently, through an enricher that reads whichever object
 * was on screen most recently. Two things went wrong with that. The call card's
 * identity was resolved by querying the DOM for an `aria-describedby` anchor
 * that only exists once an async claims fetch has resolved, so it was null on
 * every row ever written (0 of 28 brief.call.exposed). And "most recently on
 * screen" is not "the card that was tapped" when the reader scrolls past a
 * card before committing to an earlier one.
 *
 * So identity comes in as a PROP here. The ambient block is still folded in for
 * the parts only the page knows (entry point, how long the surface has been
 * open, which story preceded), but nothing load-bearing depends on it.
 *
 * FAIL-OPEN is the contract. A throwing ambient reader, a closed context, a
 * surface with no attention instrumentation at all: each degrades the block and
 * none of them can stop the event. A tracked claim with partial provenance
 * beats a lost one.
 */

export interface TrackProvenanceInput {
  /** The call being committed to. From a prop. Never a DOM lookup. */
  callId: string;
  /** Entity class of the source object. */
  sourceType?: string;
  /** The briefing that surfaced this call, when the surface knows it. */
  briefingId?: string | null;
  /** The horizon the user committed to. */
  horizon: string;
  /**
   * The horizon THIS card offered before the user touched the control.
   *
   * Per card, not per page. #535 defaulted the selector to the call's own
   * horizon, so a page-level default recorded a deliberate edit every time a
   * reader accepted a card whose horizon was not the page default. Accepted
   * versus changed is the fact; it has to be measured against what was on
   * screen.
   */
  offeredHorizon?: string | null;
  /** Ambient block reader. May throw, may return nothing. Both are survivable. */
  readAmbient?: () => Record<string, unknown> | null | undefined;
  /** Seconds since this specific card entered view. Null when never observed. */
  secondsSinceSourceInView?: number | null;
}

/** Ambient keys worth carrying onto a commitment event. */
const AMBIENT_KEYS = [
  "attn_surface_id",
  "attn_surface_type",
  "attn_entry_point",
  "seconds_since_surface_open",
  "preceding_story_id",
  "preceding_story_rank",
  "seconds_since_story_in_view",
] as const;

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Build the provenance block for a commitment event.
 *
 * Always returns an object. The prop-derived keys (`source_object_id`,
 * `horizon_offered`, `horizon_changed`) are present whatever the ambient
 * context does, which is the whole point of taking them as props.
 */
export function buildTrackProvenance(
  input: TrackProvenanceInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  let ambient: Record<string, unknown> = {};
  try {
    const read = input.readAmbient?.();
    if (read && typeof read === "object" && !Array.isArray(read)) {
      ambient = read;
    }
  } catch {
    // A broken reader costs context, never the event.
  }

  for (const key of AMBIENT_KEYS) {
    if (key in ambient) out[key] = ambient[key];
  }

  // The link back to the claim. Prop-derived, so it survives a closed context,
  // a surface with no instrumentation, and any future change to the card.
  out.source_object_type = input.sourceType ?? "brief_call";
  out.source_object_id = input.callId ?? null;
  out.seconds_since_source_in_view = input.secondsSinceSourceInView ?? null;

  // The page's own id wins over the ambient surface id: the surface knows which
  // briefing it rendered, the enricher only knows which context is open.
  const briefingId =
    asString(input.briefingId) ?? asString(ambient.briefing_id) ?? asString(ambient.attn_surface_id);
  out.briefing_id = briefingId;

  const offered = asString(input.offeredHorizon) ?? asString(ambient.horizon_offered);
  out.horizon_offered = offered;
  // Null, not false, when there is nothing to compare against. An unknown is
  // not an acceptance.
  out.horizon_changed = offered ? input.horizon !== offered : null;

  return out;
}
