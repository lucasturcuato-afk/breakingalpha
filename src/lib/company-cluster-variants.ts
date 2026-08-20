/**
 * Cluster-wide article-variant expansion (fix/article-cluster-expansion).
 *
 * THE BUG THIS FIXES
 * ------------------
 * getCompanyDetail filtered articles with
 *   .or(buildCompanyContainsOr(getCompanyVariants(head.name)))
 * and `companies.cs.{...}` is EXACT PostgreSQL array containment, not ILIKE.
 * An article tagged "Bank of America Corp" therefore cannot match the variant
 * "Bank of America", so it never reaches the page. Measured over the live
 * 14-day window, most of a company's articles were invisible for no reason
 * other than the legal suffix or the capitalization ingest happened to write.
 *
 * WHAT THIS DOES
 * --------------
 * Takes every surface form the resolver already knows about (the head name,
 * the ticker-cluster siblings, the alias rows, and the normalized-key-matched
 * alias rows discovered by resolveAlias's widened lookup), keeps only the ones
 * that fold onto the SAME company key as the head, expands each into a small
 * deterministic set of casing forms, and hard-caps the result so the PostgREST
 * `.or()` cannot outgrow the request URL.
 *
 * WHY THE GATE IS NOT OPTIONAL
 * ----------------------------
 * `companies.ticker` is contaminated: RGTI holds "Gett" and "Rigetti", ASTH
 * holds "Stran" and "Astrana Health", CVLT holds "MMV" and "Commvault
 * Systems", GBTC holds "SCA" and "Bitcoin", CHX holds "CHAMP" and "ChampionX",
 * DJT holds "Trump" and "Trump Media", BCG holds "BCG" and "Kingswood".
 * Expanding to every sibling name would put another company's articles on the
 * page, a worse bug than the under-matching. Every candidate is gated on
 * normalizeCompanyKey() equality with the head, so a ticker-sharing row whose
 * name does not fold onto the head is dropped and counted.
 *
 * Casing is preserved deliberately: containment is case-sensitive, so
 * "Bank Of America" and "Bank of America" are DIFFERENT array elements and
 * both have to be in the predicate.
 */
import { normalizeCompanyKey } from "@/lib/company-cluster-key";
import { getCompanyVariants } from "@/lib/company-intel";

/**
 * Count cap on emitted variants.
 *
 * THE URL CEILING, CORRECTED. This block used to say the request URL is
 * "accepted up to 25,205 bytes and rejected with a bare 400 at 25,268". That
 * pair is a SERVER-side URI-length boundary. The client that actually issues
 * this query gives out at roughly half of it, for a reason on the RESPONSE
 * side. Three steps, and only the third one binds:
 *
 *   1. 25,205 bytes  Server-side boundary. Reachable only from a client with
 *                    no response-header cap, such as curl. Not this one. (An
 *                    error response carries no content-location, so an
 *                    oversized URL fails server-side without ever tripping the
 *                    client cap in step 2. Not re-probed here: probing it
 *                    means deliberately forcing a 400 against prod.)
 *   2. ~15,482 bytes The `content-location` RESPONSE header at the last
 *                    accepted size, ~15,513 at the first rejected one. On a
 *                    2xx PostgREST echoes the whole query back in
 *                    `content-location`, re-encoded, which inflates it ~1.11x
 *                    over the request URL. node/undici caps TOTAL response
 *                    headers at http.maxHeaderSize = 16,384; the other
 *                    response headers cost ~880-940 bytes and the header
 *                    framing costs 20, leaving ~15,420-15,484 for that one
 *                    value.
 *   3. ~14,062 bytes THE REQUEST-URL CEILING. This is the number the caps
 *                    below have to respect.
 *
 * Measured against prod on node v25.8.0 with the real getCompanyDetail query
 * shape (13 selected columns, published_at filter, two-key order, limit 50):
 *
 *   14,062-byte request URL -> HTTP 200
 *   14,119-byte request URL -> TypeError: fetch failed,
 *                              cause code UND_ERR_HEADERS_OVERFLOW
 *
 * The failure mode is therefore a CLIENT-SIDE THROW, not a bare 400. A page
 * that outgrew the ceiling would surface as `TypeError: fetch failed` with
 * cause UND_ERR_HEADERS_OVERFLOW, which is exactly why hunting for it as a
 * PostgREST 400 landed on the wrong boundary.
 *
 * Re-derived 2026-08-20 from successful requests only: 49.9 URL bytes/term,
 * 55.4 content-location bytes/term, 941 bytes of other headers, giving 277
 * terms and a 14,040-byte ceiling. Treat the number as ~14 KB and do not chase
 * the last 30 bytes; it moves with how much of the predicate is
 * percent-encoded and with the size of the other response headers. Server-side
 * latency also climbs with term count (~120ms at 10 terms, ~1.3s at 200).
 *
 * 64 variants is roughly 3.5 KB encoded, about 25% of the real ~14 KB ceiling,
 * and comfortably above the widest real cluster observed (Wells Fargo, 20
 * variants from 4 base forms). Truncation is counted, never silent.
 */
export const MAX_CLUSTER_VARIANTS = 64;

/**
 * Byte cap on the ENCODED `.or()` predicate, applied in addition to the count
 * cap because a single pathological name can be long. 6,000 bytes is ~43% of
 * the real ~14,062-byte ceiling documented above, leaving room for the select
 * list, the published_at filter, the order clause and the host prefix.
 */
export const MAX_PREDICATE_BYTES = 6_000;

export type ClusterFormSource = "head" | "sibling" | "alias" | "widened";

export type ClusterCandidate = {
  name: string;
  /** Ranking key. Higher wins. Missing counts sort last. */
  mentionCount?: number | null;
  source: ClusterFormSource;
};

export type ClusterVariantResult = {
  /** Ready for buildCompanyContainsOr(). Deterministic order, head first. */
  variants: string[];
  /** The gated, deduped surface forms the variants were expanded from. */
  baseForms: string[];
  /** Candidates dropped because their key did not fold onto the head's. */
  excluded: Array<{ name: string; key: string; source: ClusterFormSource }>;
  /** The head's own key, for logging. */
  headKey: string;
  /** True when the cap dropped at least one variant. */
  truncated: boolean;
  /** How many variants the cap dropped. Never silent. */
  droppedVariantCount: number;
  /** Encoded byte length of the predicate the variants will produce. */
  predicateBytes: number;
};

/** Lowercase, then upper the first letter of each word and each hyphen /
 *  slash / ampersand / paren segment. "sei investments co" -> "Sei Investments Co",
 *  "parker-hannifin" -> "Parker-Hannifin", "bank of america" -> "Bank Of America"
 *  (which is a real stored form: 10 rows in the live 14-day window). */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/&(.])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** ALL-CAPS first token + Title Case remainder. Recovers "SEI Investments Co"
 *  from the stored "SEI INVESTMENTS CO", and "NVIDIA Corporation" from
 *  "Nvidia Corporation". */
function capsFirstTitleRest(s: string): string {
  const parts = s.split(/\s+/);
  if (parts.length === 0) return s;
  return [parts[0].toUpperCase(), ...parts.slice(1).map((w) => titleCase(w))].join(" ");
}

/**
 * The deterministic casing forms emitted per base surface form. Order is the
 * priority order used when the cap bites: the stored form first, then the
 * shapes ingest actually writes.
 */
export function casingForms(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const out: string[] = [trimmed];
  for (const v of [titleCase(trimmed), trimmed.toUpperCase(), capsFirstTitleRest(trimmed)]) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Bytes the variant would add to an encoded `companies.cs.{"..."}` term. */
function encodedTermBytes(variant: string): number {
  // buildCompanyContainsOr emits: companies.cs.{"<escaped>"} plus one comma.
  const raw = `companies.cs.{"${variant.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"},`;
  return encodeURIComponent(raw).length;
}

/**
 * Build the capped, gated variant set for a resolved company cluster.
 *
 * Priority order (stable, so behavior does not drift between requests):
 *   1. getCompanyVariants(head.name)   - exactly today's behavior, never dropped
 *   2. head name casing forms
 *   3. widened / alias / sibling forms by mention_count desc, name asc
 * Ties break on name so two rows with equal mention_count cannot swap places.
 */
export function buildClusterVariants(
  headName: string,
  candidates: ClusterCandidate[],
  opts: { maxVariants?: number; maxPredicateBytes?: number } = {},
): ClusterVariantResult {
  const maxVariants = opts.maxVariants ?? MAX_CLUSTER_VARIANTS;
  const maxBytes = opts.maxPredicateBytes ?? MAX_PREDICATE_BYTES;
  const headKey = normalizeCompanyKey(headName);

  const excluded: ClusterVariantResult["excluded"] = [];
  const seenCandidate = new Set<string>();
  const kept: ClusterCandidate[] = [];

  for (const c of candidates) {
    const name = (c.name ?? "").trim();
    if (!name) continue;
    if (seenCandidate.has(name)) continue;
    seenCandidate.add(name);
    const key = normalizeCompanyKey(name);
    // THE CONTAMINATION GATE. A ticker-sharing row whose name does not fold
    // onto the head is a different company; it never enters the predicate.
    if (key !== headKey) {
      excluded.push({ name, key, source: c.source });
      continue;
    }
    kept.push({ ...c, name });
  }

  // Rank: head first, then by mention_count desc, then name asc.
  kept.sort((a, b) => {
    if (a.source === "head" && b.source !== "head") return -1;
    if (b.source === "head" && a.source !== "head") return 1;
    const am = a.mentionCount ?? -1;
    const bm = b.mentionCount ?? -1;
    if (bm !== am) return bm - am;
    return a.name.localeCompare(b.name);
  });

  const baseForms = kept.map((c) => c.name);

  // Ordered variant stream. getCompanyVariants(head) leads, so the VARIANT set
  // is a strict superset of today's and the cap can never drop a variant the
  // page already queries with.
  //
  // CORRECTED. That sentence used to end "nothing that renders now can stop
  // rendering because of the cap", which reasons only about the VARIANT cap
  // and never about ARTICLE_LIMIT. They are different limits, and it is the
  // second one that evicts rendered rows. A superset of variants does match a
  // superset of articles, but getCompanyDetail then truncates to
  // ARTICLE_LIMIT = 50 AFTER ordering by relevance_score DESC, published_at
  // DESC, so a wider match set can and does push rows that render today out of
  // the rendered top 50. See the note above the getCompanyVariants() call
  // below for the measured size of that effect.
  const ordered: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  // getCompanyVariants(headName) is passed through UNGATED, on purpose.
  //
  // It can emit a bare first token that folds onto a contaminated sibling:
  // head "Trump Media" emits "Trump", and DJT also carries a separate "Trump"
  // row. Gating it looks right and is wrong. Measured over all 17 live tickers
  // that carry 2+ companies rows (2026-08-18): 5 clusters have a head variant
  // colliding with an off-entity sibling, and gating them would remove 93
  // articles from the 14-day window - of which 64 are TSMC on Taiwan
  // Semiconductor, 26 Peloton on Peloton Interactive, 1 Samsung Electronics on
  // Samsung, 1 Gemini on Gemini Space Station. Those are the SAME company under
  // a short form the suffix stripper cannot fold; only DJT's 1 article is a
  // genuine wrong-company hit. Net: gating costs 92 correct articles to remove
  // 1 incorrect one.
  //
  // So the gate polices what this expansion ADDS, and the pre-existing
  // head-variant behavior is left byte-identical. That makes the MATCHED
  // article set a strict superset of today's.
  //
  // CORRECTED. This used to add "nothing that renders now stops rendering".
  // It does not follow from the superset property, and it is not true.
  // getCompanyDetail truncates the matched set to ARTICLE_LIMIT = 50 after
  // ordering by relevance_score DESC, published_at DESC, so widening the match
  // set evicts rows from the rendered page. Measured on prod 2026-08-19 across
  // the 430 resolvable heads behind the /company list page's default top-500:
  // 1,807 rows enter the rendered top 50 and 159 rows leave it, spread over 39
  // of the 430 heads, against 9,785 rows rendering today. Net +1,648.
  //
  // The 159 are not arbitrary. 64 lose outright on relevance_score, 94 tie on
  // score and lose on published_at, and the one remaining row ties on both
  // ordering keys against a DUPLICATE of itself: identical title, source,
  // timestamp and score. So 158 of 159 are displaced by strictly better rows
  // and the last is displaced by its own duplicate. That is the argument for
  // shipping the widening. It is an argument, not the absence of an effect.
  // Do not restore the old claim.
  for (const v of getCompanyVariants(headName)) push(v);
  for (const form of baseForms) for (const v of casingForms(form)) push(v);
  // Degenerate input (empty / whitespace-only head). Emit the raw head anyway
  // so buildCompanyContainsOr never returns "" and the caller never issues a
  // `.or()` with an empty argument. Matches today's behavior, where
  // getCompanyVariants("") returns [""].
  if (ordered.length === 0) ordered.push(headName);

  const variants: string[] = [];
  let predicateBytes = 0;
  let dropped = 0;
  for (const v of ordered) {
    const bytes = encodedTermBytes(v);
    if (variants.length >= maxVariants || predicateBytes + bytes > maxBytes) {
      dropped += 1;
      continue;
    }
    variants.push(v);
    predicateBytes += bytes;
  }

  return {
    variants,
    baseForms,
    excluded,
    headKey,
    truncated: dropped > 0,
    droppedVariantCount: dropped,
    predicateBytes,
  };
}
