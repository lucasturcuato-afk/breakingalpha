// Server-only KPI data access for the /internal dashboard (Phase B).
//
// Reads the read-only aggregate views created in
// supabase/migrations/20260602160000_internal_dashboard_phase_b_views.sql using
// the service-role client. The views are granted to service_role only and sit
// behind requireAdmin() in app/internal/page.tsx. All ratios are computed in the
// SQL views; this layer only fetches and coerces.
import { createClient } from "@supabase/supabase-js";

export type TimeWindow = "7d" | "30d";
export type Segment = "All" | "USC" | "other";

export interface KpiSummary {
  segment_domain: string;
  total_users: number;
  weekly_actives: number; // event-based, 7d
  active_30d: number; // event-based, 30d
  logged_in_7d: number; // secondary: last_sign_in_at
  logged_in_30d: number; // secondary
  new_users_7d: number;
  new_users_30d: number;
  brief_open_users_7d: number;
  brief_opens_7d: number;
  memos_all_time: number;
  memos_7d: number;
  memos_30d: number;
  users_with_watchlist: number;
  retention_4w_pct: number | null;
  waitlist_count: number | null; // global, populated on 'All' only
  distinct_companies_researched: number | null; // global, 'All' only

  // ── Added by the loop-fix migration, and NULL until a human applies it. ──
  //
  // backend/migrations/UNAPPLIED-2026-08-30-loop-fixes.sql ships in the same
  // branch as this file but is deliberately not applied, so this code runs
  // against BOTH view shapes. Every field below is nullable for that reason,
  // and the page renders a notice rather than a wrong number when they are
  // null. Do not make them required until the migration has been run.
  tenured_users: number | null;
  waps_tenured_pct: number | null; // brief openers / users older than the window
  waps_active_pct: number | null; // brief openers / weekly actives
  watchlist_tenured_pct: number | null;
  brief_open_days_median_7d: number | null; // habit measure, 1 to 7
  retention_4w_cohort: number | null; // the denominator, printed on the card
  window_start_utc: string | null;
  window_end_utc: string | null;
  computed_at: string | null;

  // ── Legacy, present only BEFORE the migration is applied. ──
  // Kept so the page can fall back and say so, rather than rendering 0.
  waps_pct: number | null;
  watchlist_pct: number | null;
  brief_opens_per_active: number | null;
}

/** Present on the row only once the loop-fix migration has been applied. */
export function loopFixApplied(s: KpiSummary): boolean {
  return s.computed_at !== null && s.waps_tenured_pct !== null;
}

export interface RetentionCohort {
  cohort_week: string;
  segment_domain: string;
  cohort_size: number;
  active_last_7d: number;
  retention_pct: number | null;
  weeks_since_signup: number;
  /** NULL until the loop-fix migration is applied. */
  window_closed: boolean | null;
  cohort_size_observed: number | null;
}

export interface ActivationCohort {
  cohort_week: string;
  segment_domain: string;
  cohort_size: number;
  onboarded_7d: number;
  onboarded_7d_pct: number | null;
  activated_7d: number;
  activated_7d_pct: number | null;
  /** NULL until the loop-fix migration is applied. A right-censored cohort is
   *  not a low number, it is not a number yet. */
  window_closed: boolean | null;
  window_closes_at: string | null;
  cohort_size_observed: number | null;
}

export interface InstrumentationHealth {
  event_type: string;
  last_seen: string;
  days_since_last: number;
  events_7d: number;
  events_30d: number;
  events_all: number;
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** PostgREST serializes numeric/round() as strings; coerce defensively. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchKpiSummary(segment: Segment): Promise<KpiSummary> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_summary")
    .select("*")
    .eq("segment_domain", segment)
    .single();
  if (error || !data) {
    throw new Error(`internal_kpi_summary query failed: ${error?.message ?? "no data"}`);
  }
  const r = data as Record<string, unknown>;
  return {
    segment_domain: String(r.segment_domain),
    total_users: num(r.total_users),
    weekly_actives: num(r.weekly_actives),
    active_30d: num(r.active_30d),
    logged_in_7d: num(r.logged_in_7d),
    logged_in_30d: num(r.logged_in_30d),
    new_users_7d: num(r.new_users_7d),
    new_users_30d: num(r.new_users_30d),
    brief_open_users_7d: num(r.brief_open_users_7d),
    brief_opens_7d: num(r.brief_opens_7d),
    memos_all_time: num(r.memos_all_time),
    memos_7d: num(r.memos_7d),
    memos_30d: num(r.memos_30d),
    users_with_watchlist: num(r.users_with_watchlist),
    retention_4w_pct: numOrNull(r.retention_4w_pct),
    tenured_users: numOrNull(r.tenured_users),
    waps_tenured_pct: numOrNull(r.waps_tenured_pct),
    waps_active_pct: numOrNull(r.waps_active_pct),
    watchlist_tenured_pct: numOrNull(r.watchlist_tenured_pct),
    brief_open_days_median_7d: numOrNull(r.brief_open_days_median_7d),
    retention_4w_cohort: numOrNull(r.retention_4w_cohort),
    window_start_utc: r.window_start_utc == null ? null : String(r.window_start_utc),
    window_end_utc: r.window_end_utc == null ? null : String(r.window_end_utc),
    computed_at: r.computed_at == null ? null : String(r.computed_at),
    waps_pct: numOrNull(r.waps_pct),
    watchlist_pct: numOrNull(r.watchlist_pct),
    brief_opens_per_active: numOrNull(r.brief_opens_per_active),
    waitlist_count: numOrNull(r.waitlist_count),
    distinct_companies_researched: numOrNull(r.distinct_companies_researched),
  };
}

/**
 * A signup cohort available to filter by, straight off dim_users.
 * See backend/migrations/UNAPPLIED-2026-08-28-signup-cohort-capture.sql.
 */
export interface CohortOption {
  cohort_key: string;
  cohort_source: string | null;
  cohort_institution: string | null;
  cohort_batch: string | null;
  member_count: number;
}

/** PostgREST reports an unknown table/view rather than throwing a PG error. */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    /could not find the table|does not exist/i.test(err.message ?? "")
  );
}

/**
 * Cohorts present in the data, or NULL when the cohort migration has not been
 * applied yet.
 *
 * NULL and [] mean different things and callers must not conflate them. NULL is
 * "the schema does not have this yet, show the filter as unavailable". [] is
 * "the schema is there and nobody has a cohort", which is a real, reportable
 * state. Returning [] for an unapplied migration would make the filter look
 * functional while measuring nothing.
 */
export async function fetchCohortOptions(): Promise<CohortOption[] | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_cohort_members")
    .select("*")
    .order("member_count", { ascending: false });
  if (error) {
    if (isMissingRelation(error)) return null;
    throw new Error(`internal_kpi_cohort_members query failed: ${error.message}`);
  }
  return (data as Record<string, unknown>[]).map((r) => ({
    cohort_key: String(r.cohort_key),
    cohort_source: r.cohort_source === null ? null : String(r.cohort_source),
    cohort_institution:
      r.cohort_institution === null ? null : String(r.cohort_institution),
    cohort_batch: r.cohort_batch === null ? null : String(r.cohort_batch),
    member_count: num(r.member_count),
  }));
}

/**
 * The same summary metrics, scoped to one cohort.
 *
 * This reads a SEPARATE view whose metric expressions are copied verbatim from
 * internal_kpi_summary. No card definition changes; only the grouping key does.
 * waitlist_count and distinct_companies_researched are absent by design: both
 * are global and not attributable to a cohort, so they surface as null and the
 * page renders "n/a", exactly as it already does on the USC and non-USC rows.
 */
export async function fetchKpiSummaryForCohort(
  cohortKey: string,
): Promise<KpiSummary | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_summary_by_cohort")
    .select("*")
    .eq("cohort_key", cohortKey)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null;
    throw new Error(`internal_kpi_summary_by_cohort query failed: ${error.message}`);
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    segment_domain: String(r.cohort_key),
    total_users: num(r.total_users),
    weekly_actives: num(r.weekly_actives),
    active_30d: num(r.active_30d),
    logged_in_7d: num(r.logged_in_7d),
    logged_in_30d: num(r.logged_in_30d),
    new_users_7d: num(r.new_users_7d),
    new_users_30d: num(r.new_users_30d),
    brief_open_users_7d: num(r.brief_open_users_7d),
    brief_opens_7d: num(r.brief_opens_7d),
    memos_all_time: num(r.memos_all_time),
    memos_7d: num(r.memos_7d),
    memos_30d: num(r.memos_30d),
    users_with_watchlist: num(r.users_with_watchlist),
    retention_4w_pct: numOrNull(r.retention_4w_pct),
    tenured_users: numOrNull(r.tenured_users),
    waps_tenured_pct: numOrNull(r.waps_tenured_pct),
    waps_active_pct: numOrNull(r.waps_active_pct),
    watchlist_tenured_pct: numOrNull(r.watchlist_tenured_pct),
    brief_open_days_median_7d: numOrNull(r.brief_open_days_median_7d),
    retention_4w_cohort: numOrNull(r.retention_4w_cohort),
    window_start_utc: r.window_start_utc == null ? null : String(r.window_start_utc),
    window_end_utc: r.window_end_utc == null ? null : String(r.window_end_utc),
    computed_at: r.computed_at == null ? null : String(r.computed_at),
    waps_pct: numOrNull(r.waps_pct),
    watchlist_pct: numOrNull(r.watchlist_pct),
    brief_opens_per_active: numOrNull(r.brief_opens_per_active),
    waitlist_count: null,
    distinct_companies_researched: null,
  };
}

export async function fetchRetentionCohorts(segment: Segment): Promise<RetentionCohort[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_retention_cohorts")
    .select("*")
    .eq("segment_domain", segment)
    .order("cohort_week", { ascending: true });
  if (error || !data) {
    throw new Error(`internal_kpi_retention_cohorts query failed: ${error?.message ?? "no data"}`);
  }
  return (data as Record<string, unknown>[]).map((r) => ({
    cohort_week: String(r.cohort_week),
    segment_domain: String(r.segment_domain),
    cohort_size: num(r.cohort_size),
    active_last_7d: num(r.active_last_7d),
    retention_pct: numOrNull(r.retention_pct),
    weeks_since_signup: num(r.weeks_since_signup),
    window_closed: typeof r.window_closed === "boolean" ? r.window_closed : null,
    cohort_size_observed: numOrNull(r.cohort_size_observed),
  }));
}

export async function fetchActivation(segment: Segment): Promise<ActivationCohort[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_activation")
    .select("*")
    .eq("segment_domain", segment)
    .order("cohort_week", { ascending: true });
  if (error || !data) {
    throw new Error(`internal_kpi_activation query failed: ${error?.message ?? "no data"}`);
  }
  return (data as Record<string, unknown>[]).map((r) => ({
    cohort_week: String(r.cohort_week),
    segment_domain: String(r.segment_domain),
    cohort_size: num(r.cohort_size),
    onboarded_7d: num(r.onboarded_7d),
    onboarded_7d_pct: numOrNull(r.onboarded_7d_pct),
    activated_7d: num(r.activated_7d),
    activated_7d_pct: numOrNull(r.activated_7d_pct),
    window_closed: typeof r.window_closed === "boolean" ? r.window_closed : null,
    window_closes_at: r.window_closes_at == null ? null : String(r.window_closes_at),
    cohort_size_observed: numOrNull(r.cohort_size_observed),
  }));
}

export async function fetchInstrumentationHealth(): Promise<InstrumentationHealth[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_instrumentation_health")
    .select("*")
    .order("days_since_last", { ascending: false });
  if (error || !data) {
    throw new Error(`internal_kpi_instrumentation_health query failed: ${error?.message ?? "no data"}`);
  }
  return (data as Record<string, unknown>[]).map((r) => ({
    event_type: String(r.event_type),
    last_seen: String(r.last_seen),
    days_since_last: num(r.days_since_last),
    events_7d: num(r.events_7d),
    events_30d: num(r.events_30d),
    events_all: num(r.events_all),
  }));
}
