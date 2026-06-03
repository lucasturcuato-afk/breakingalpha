// Server-only KPI data access for the /internal dashboard.
//
// Reads the read-only aggregate views created in
// supabase/migrations/20260602120000_internal_dashboard_kpi_views.sql using the
// service-role client. The views are granted to service_role only, so this code
// path is the single way the numbers are reachable, and it sits behind
// requireAdmin() in app/internal/page.tsx.
import { createClient } from "@supabase/supabase-js";

export type TimeWindow = "7d" | "30d";

export interface KpiSummary {
  total_users: number;
  active_7d: number;
  active_30d: number;
  new_users_7d: number;
  new_users_30d: number;
  waitlist_count: number;
  weekly_actives: number;
  brief_open_users_7d: number;
  brief_opens_7d: number;
  retention_4w_pct: number | null;
  memos_all_time: number;
  memos_7d: number;
  memos_30d: number;
  distinct_companies_researched: number;
  users_with_watchlist: number;
}

export interface RetentionCohort {
  cohort_week: string;
  cohort_size: number;
  active_last_7d: number;
  retention_pct: number | null;
  weeks_since_signup: number;
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

export async function fetchKpiSummary(): Promise<KpiSummary> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_summary")
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`internal_kpi_summary query failed: ${error?.message ?? "no data"}`);
  }
  const r = data as Record<string, unknown>;
  return {
    total_users: num(r.total_users),
    active_7d: num(r.active_7d),
    active_30d: num(r.active_30d),
    new_users_7d: num(r.new_users_7d),
    new_users_30d: num(r.new_users_30d),
    waitlist_count: num(r.waitlist_count),
    weekly_actives: num(r.weekly_actives),
    brief_open_users_7d: num(r.brief_open_users_7d),
    brief_opens_7d: num(r.brief_opens_7d),
    retention_4w_pct: numOrNull(r.retention_4w_pct),
    memos_all_time: num(r.memos_all_time),
    memos_7d: num(r.memos_7d),
    memos_30d: num(r.memos_30d),
    distinct_companies_researched: num(r.distinct_companies_researched),
    users_with_watchlist: num(r.users_with_watchlist),
  };
}

export async function fetchRetentionCohorts(): Promise<RetentionCohort[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("internal_kpi_retention_cohorts")
    .select("*")
    .order("cohort_week", { ascending: true });
  if (error || !data) {
    throw new Error(`internal_kpi_retention_cohorts query failed: ${error?.message ?? "no data"}`);
  }
  return (data as Record<string, unknown>[]).map((r) => ({
    cohort_week: String(r.cohort_week),
    cohort_size: num(r.cohort_size),
    active_last_7d: num(r.active_last_7d),
    retention_pct: numOrNull(r.retention_pct),
    weeks_since_signup: num(r.weeks_since_signup),
  }));
}

/** Safe percentage helper for ratio KPIs. Returns 0 when the denominator is 0. */
export function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Safe ratio (e.g. opens per active). Returns 0 when the denominator is 0. */
export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}
