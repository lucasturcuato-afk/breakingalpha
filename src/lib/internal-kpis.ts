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
  waps_pct: number | null;
  watchlist_pct: number | null;
  brief_opens_per_active: number | null;
  retention_4w_pct: number | null;
  waitlist_count: number | null; // global, populated on 'All' only
  distinct_companies_researched: number | null; // global, 'All' only
}

export interface RetentionCohort {
  cohort_week: string;
  segment_domain: string;
  cohort_size: number;
  active_last_7d: number;
  retention_pct: number | null;
  weeks_since_signup: number;
}

export interface ActivationCohort {
  cohort_week: string;
  segment_domain: string;
  cohort_size: number;
  onboarded_7d: number;
  onboarded_7d_pct: number | null;
  activated_7d: number;
  activated_7d_pct: number | null;
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
    waps_pct: numOrNull(r.waps_pct),
    watchlist_pct: numOrNull(r.watchlist_pct),
    brief_opens_per_active: numOrNull(r.brief_opens_per_active),
    retention_4w_pct: numOrNull(r.retention_4w_pct),
    waitlist_count: numOrNull(r.waitlist_count),
    distinct_companies_researched: numOrNull(r.distinct_companies_researched),
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
