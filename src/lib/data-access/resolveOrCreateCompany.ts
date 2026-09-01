import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAlias, type ResolverRow } from "@/lib/data-access/aliasResolver";
import { namesAgree } from "@/lib/name-agreement";
import { normalizeLookupKey } from "@/lib/normalize-lookup-key";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * On-demand company resolution + creation (server-only).
 *
 * When a user lands on /company/<slug> for a ticker/name not yet in the
 * `companies` table, the page renders EmptyState. This helper resolves the
 * query against the live table (the same path the page uses), and only on a
 * genuine miss resolves a real symbol+name via Finnhub and inserts ONE minimal
 * row through the SERVICE-ROLE client (companies writes are RLS-locked to
 * service-role after #409).
 *
 * Dedup is the hazard, not auth: companies is UNIQUE on exact `name` only (no
 * ticker / normalized-name unique), so a bare insert recreates the duplicate
 * rows the entity-dedup just cleaned up. We mirror the backend
 * entity-resolution guards before inserting:
 *   - ticker guard: the resolved symbol may already exist under a different
 *     surface name -> reuse that canonical, register an alias, no insert.
 *   - normalized-name guard: an existing canonical may live under a name
 *     variant -> match via the aliases.lookup_key index (and companies.name),
 *     reuse it, register an alias, no insert.
 * Only when all guards miss do we insert, then register the canonical name and
 * the user's surface form as aliases so future variants collapse here.
 */

export type CompanyLite = { id: string; name: string; ticker: string | null };

export type ResolveOutcome =
  | { status: "exists"; company: CompanyLite; created: false }
  | { status: "created"; company: CompanyLite; created: true }
  | { status: "not_found"; company: null; created: false };

const FINNHUB_TIMEOUT_MS = 5000;
// Tickers can carry a class/exchange dot (BRK.B, SHELL.AS); allow it here so
// the exact-symbol match and "looks like a ticker" gate stay honest.
const TICKER_RE = /^[A-Z][A-Z.]{0,6}$/;

type FinnhubItem = {
  symbol: string;
  displaySymbol: string;
  description: string;
  type: string;
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function lite(row: ResolverRow | CompanyLite): CompanyLite {
  return { id: row.id, name: row.name, ticker: row.ticker ?? null };
}

/** One Finnhub /search call -> {symbol, name}, or null. Mirrors the watchlist
 * route precedent. Filters to listed equity types and requires a real symbol. */
async function finnhubResolve(
  query: string,
): Promise<{ symbol: string; name: string } | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;

  let data: { result?: FinnhubItem[] };
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${key}`,
      { signal: AbortSignal.timeout(FINNHUB_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    data = (await res.json()) as { result?: FinnhubItem[] };
  } catch {
    return null;
  }

  const results = (data?.result ?? []).filter(
    (r) => r.type === "Common Stock" || r.type === "ETP",
  );
  if (results.length === 0) return null;

  const upper = query.trim().toUpperCase();
  const exact = results.find(
    (r) =>
      r.symbol?.toUpperCase() === upper ||
      r.displaySymbol?.toUpperCase() === upper,
  );
  // If the query looks like a ticker, REQUIRE an exact symbol hit so we never
  // insert a fuzzy "best guess" row. Otherwise take the top listed result.
  const looksLikeTicker = TICKER_RE.test(upper);
  const pick = exact ?? (looksLikeTicker ? null : results[0]);
  if (!pick) return null;

  // NAME AGREEMENT on the fuzzy branch. /search always ranks SOMETHING first,
  // so results[0] for a name query is a guess, not a match: it is what pairs
  // "Revolut" with Revolution Medicines and "Motive" with O'Reilly
  // Automotive. An exact symbol hit is already identity and skips the check.
  //
  // A veto, never a re-rank. Scanning down the list for the first agreeing
  // candidate looks like a free rescue and is not: measured against live
  // /search, "Fidelity" rescues from FIS to FDBC, a Pennsylvania community
  // bank, and "Vanguard" to a Taiwanese issuer that is not a SEC registrant.
  // Trading one wrong answer for a more plausible wrong answer is a loss.
  // Same policy as backend/edgar/name_agreement.py.
  if (!exact && !namesAgree(query, pick.description).agrees) return null;

  const symbol = (pick.displaySymbol || pick.symbol || "").trim().toUpperCase();
  const name = pick.description ? titleCase(pick.description.trim()) : "";
  if (!symbol || !name) return null;
  return { symbol, name };
}

async function fetchCompanyById(
  svc: SupabaseClient,
  id: string,
): Promise<CompanyLite | null> {
  const { data } = await svc
    .from("companies")
    .select("id, name, ticker")
    .eq("id", id)
    .maybeSingle();
  return data ? lite(data as CompanyLite) : null;
}

async function fetchCompanyByTicker(
  svc: SupabaseClient,
  ticker: string,
): Promise<CompanyLite | null> {
  // Direct ticker select (not resolveAlias) so dotted symbols like BRK.B that
  // fail resolveAlias's strict ticker regex are still caught. Highest mention
  // wins, tie-broken by id, mirroring the resolver's ranking.
  const { data } = await svc
    .from("companies")
    .select("id, name, ticker")
    .eq("ticker", ticker)
    .order("mention_count", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(1);
  const row = (data as CompanyLite[] | null)?.[0];
  return row ? lite(row) : null;
}

/** Conflict-safe alias registration on (lookup_key, canonical_id). Never
 * clobbers an existing alias's mention_count (ignoreDuplicates). */
async function registerAlias(
  svc: SupabaseClient,
  surfaceForm: string,
  canonicalId: string,
): Promise<void> {
  const surface = surfaceForm.trim();
  if (!surface) return;
  const lookup_key = normalizeLookupKey(surface);
  if (!lookup_key) return;
  await svc.from("aliases").upsert(
    {
      surface_form: surface,
      lookup_key,
      canonical_id: canonicalId,
      mention_count: 0,
    },
    { onConflict: "lookup_key,canonical_id", ignoreDuplicates: true },
  );
}

export async function resolveOrCreateCompany(
  rawQuery: string,
): Promise<ResolveOutcome> {
  const query = rawQuery.trim();
  if (!query) return { status: "not_found", company: null, created: false };

  const svc = getServiceSupabase();

  // (0) Ticker fast-path: dotted/plain tickers (BRK.B, SHELL.AS) that
  // resolveAlias's strict /^[A-Z]{1,5}$/ regex routes to the name branch. A
  // direct ticker hit short-circuits and skips a wasted Finnhub call on every
  // visit to an already-indexed international/class-share ticker.
  const upperQuery = query.toUpperCase();
  if (TICKER_RE.test(upperQuery)) {
    const tickerFastHit = await fetchCompanyByTicker(svc, upperQuery);
    if (tickerFastHit) {
      return { status: "exists", company: tickerFastHit, created: false };
    }
  }

  // (1) Existence check: the same resolver the page uses (ticker -> name).
  const hit = await resolveAlias(svc, query);
  if (hit) return { status: "exists", company: lite(hit.canonical), created: false };

  // (2) Resolve a real symbol+name. No Finnhub match -> caller keeps EmptyState.
  const resolved = await finnhubResolve(query);
  if (!resolved) return { status: "not_found", company: null, created: false };
  const { symbol, name } = resolved;

  // (3a) Dedup guard - ticker. Adopting a row purely because it carries this
  // symbol is how an existing cross-wire SPREADS: prod holds a row named
  // 'Fidelity' with ticker FIS, so a search for "Fidelity National
  // Information Services" resolved FIS here, adopted that row, and wrote the
  // full correct name into aliases as a surface form of the wrong company.
  // Both of those aliases are in prod today. Require the stored row's name to
  // agree with the name Finnhub returned before reusing it.
  const byTicker = await fetchCompanyByTicker(svc, symbol);
  if (byTicker) {
    if (!namesAgree(byTicker.name, name).agrees) {
      // Refuse rather than insert a second holder of this symbol. The cost is
      // an EmptyState the user can retry, not a wrong company and not a
      // permanent alias pointing at one.
      return { status: "not_found", company: null, created: false };
    }
    await registerAlias(svc, query, byTicker.id);
    return { status: "exists", company: byTicker, created: false };
  }

  // (3b) Dedup guard - normalized name (aliases lookup_key index, then name).
  const lookupKey = normalizeLookupKey(name);
  const { data: aliasRows } = await svc
    .from("aliases")
    .select("canonical_id")
    .eq("lookup_key", lookupKey)
    .limit(1);
  const aliasCanonicalId = (aliasRows as { canonical_id: string }[] | null)?.[0]
    ?.canonical_id;
  if (aliasCanonicalId) {
    const existing = await fetchCompanyById(svc, aliasCanonicalId);
    if (existing) {
      await registerAlias(svc, query, existing.id);
      return { status: "exists", company: existing, created: false };
    }
  }
  const byName = await resolveAlias(svc, name);
  if (byName) {
    await registerAlias(svc, query, byName.canonical.id);
    return { status: "exists", company: lite(byName.canonical), created: false };
  }

  // (4) Genuinely new: insert ONE row via service-role. UNIQUE(name) is the
  // synchronization primitive; on a race (23505) re-select by name.
  const { data: inserted, error } = await svc
    .from("companies")
    .insert({ name, ticker: symbol, mention_count: 0 })
    .select("id, name, ticker")
    .maybeSingle();

  let company: CompanyLite | null = inserted ? lite(inserted as CompanyLite) : null;
  let raced = false;
  if (error) {
    if (error.code === "23505") {
      raced = true;
      const { data: existing } = await svc
        .from("companies")
        .select("id, name, ticker")
        .eq("name", name)
        .maybeSingle();
      company = existing ? lite(existing as CompanyLite) : null;
    } else {
      throw error;
    }
  }
  if (!company) return { status: "not_found", company: null, created: false };

  // Register the canonical name and (if distinct) the user's surface form so
  // future lookups under either collapse to this row.
  await registerAlias(svc, name, company.id);
  if (normalizeLookupKey(query) !== lookupKey) {
    await registerAlias(svc, query, company.id);
  }

  return raced
    ? { status: "exists", company, created: false }
    : { status: "created", company, created: true };
}
