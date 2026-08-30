// Founders-only internal analytics dashboard (Phase B).
//
// Pure Server Component. requireAdmin() runs first and fail-closes with a 404
// for anyone not on ADMIN_EMAILS, so no KPI query runs for a non-admin. All
// numbers come server-side from the service-role client reading the read-only
// KPI views; there is no client-side data fetching and no public metrics
// endpoint. Window (?w=7d|30d) and segment (?seg=all|usc|other) are read from
// query params so the page stays a Server Component and a refresh is a reload.
// All ratios are computed in SQL; this file only renders. Not linked in nav.
import { requireAdmin } from "@/lib/require-admin";
import {
  fetchKpiSummary,
  fetchRetentionCohorts,
  fetchActivation,
  fetchInstrumentationHealth,
  fetchCohortOptions,
  fetchKpiSummaryForCohort,
  type TimeWindow,
  type Segment,
  loopFixApplied,
  type CohortOption,
} from "@/lib/internal-kpis";

const COHORT_ALL = "All";

/** Human label for a cohort key. "unattributed" is a real bucket, not an error. */
function cohortLabel(o: CohortOption): string {
  if (o.cohort_key === "unattributed") return `unattributed (${o.member_count})`;
  const parts = [o.cohort_institution, o.cohort_batch, o.cohort_source].filter(
    Boolean,
  );
  return `${parts.join(" / ")} (${o.member_count})`;
}

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{value}</div>
      {sub ? <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{sub}</div> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{children}</div>
    </section>
  );
}

function Toggle({
  current,
  options,
}: {
  current: string;
  options: { label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="flex rounded-lg border border-neutral-200 p-1 text-sm dark:border-neutral-800">
      {options.map((o) => (
        <a
          key={o.label}
          href={o.href}
          className={
            "rounded-md px-3 py-1 " +
            (o.active
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-600 dark:text-neutral-300")
          }
        >
          {o.label}
        </a>
      ))}
    </div>
  );
}

const SEG_LABEL: Record<Segment, string> = { All: "All", USC: "USC", other: "non-USC" };
const SEG_PARAM: Record<Segment, string> = { All: "all", USC: "usc", other: "other" };

function pctStr(v: number | null): string {
  return v === null ? "n/a" : `${v}%`;
}

export default async function InternalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; seg?: string; cohort?: string }>;
}) {
  // Gate FIRST. Nothing below runs for a non-admin.
  await requireAdmin();

  const sp = await searchParams;
  const win: TimeWindow = sp.w === "30d" ? "30d" : "7d";
  const segment: Segment = sp.seg === "usc" ? "USC" : sp.seg === "other" ? "other" : "All";
  const cohortParam = sp.cohort && sp.cohort !== COHORT_ALL ? sp.cohort : null;

  const [baseSummary, cohorts, activation, health, cohortOptions] = await Promise.all([
    fetchKpiSummary(segment),
    fetchRetentionCohorts(segment),
    fetchActivation(segment),
    fetchInstrumentationHealth(),
    fetchCohortOptions(),
  ]);

  // Cohort scoping is a FILTER, not a redefinition: the scoped view's metric
  // expressions are copied verbatim from internal_kpi_summary. When no cohort is
  // selected, or the cohort migration has not been applied, this page renders
  // exactly what it renders today from exactly the same view.
  //
  // cohortOptions === null means the migration is unapplied. That is rendered as
  // an explicit notice rather than an empty dropdown, because a filter that
  // silently offers nothing looks functional while measuring nothing.
  const cohortCaptureAvailable = cohortOptions !== null;
  const scoped = cohortParam ? await fetchKpiSummaryForCohort(cohortParam) : null;
  const s = scoped ?? baseSummary;
  const cohortMissing = cohortParam !== null && scoped === null;

  const winLabel = win === "30d" ? "30d" : "7d";
  const newUsersInWindow = win === "30d" ? s.new_users_30d : s.new_users_7d;
  const activeInWindow = win === "30d" ? s.active_30d : s.weekly_actives;
  const loggedInWindow = win === "30d" ? s.logged_in_30d : s.logged_in_7d;
  const memosInWindow = win === "30d" ? s.memos_30d : s.memos_7d;
  const retention4w = pctStr(s.retention_4w_pct);
  const isAll = segment === "All";

  // The most quotable sentence on the page, so it carries the honest
  // denominator. It used to read "N weekly actives of 199 users", which is a
  // ratio against every signup ever and falls as the product grows. Tenured
  // users are those who existed for the whole window and have actually had a
  // chance to show up.
  const loopFixed = loopFixApplied(s);
  const tenured = s.tenured_users;
  const wapsShown = loopFixed ? s.waps_tenured_pct : s.waps_pct;
  const pitch = `${SEG_LABEL[segment]}: ${s.weekly_actives} weekly actives of ${
    tenured === null ? `${s.total_users} users` : `${tenured} tenured users`
  }, ${retention4w} four-week retention${
    s.retention_4w_cohort === null ? "" : ` on ${s.retention_4w_cohort}`
  }, WAPS ${pctStr(wapsShown)}${
    loopFixed ? "" : " (pre-migration denominator, see notice above)"
  }${isAll && s.waitlist_count !== null ? `, ${s.waitlist_count} on the waitlist` : ""}.`;

  // D12. The helper text under the activation table used to hard-code
  // "the 2026-04-27 cohort is the reliable read". That stopped being the
  // largest cohort and the sentence became false while still rendering. The
  // referent is computed now, so it follows the data instead of rotting.
  // window_closed arrives with the loop-fix migration; before it, no row can be
  // called complete and the fallback sentence says so.
  const largestComplete = activation
    .filter((a) => a.window_closed === true)
    .reduce<(typeof activation)[number] | null>(
      (best, a) => (best === null || a.cohort_size > best.cohort_size ? a : best),
      null,
    );

  // Toggle hrefs preserve the other dimensions, cohort included.
  const cohortQ = cohortParam ? `&cohort=${encodeURIComponent(cohortParam)}` : "";
  const segOptions = (["All", "USC", "other"] as Segment[]).map((seg) => ({
    label: SEG_LABEL[seg],
    href: `/internal?w=${win}&seg=${SEG_PARAM[seg]}${cohortQ}`,
    active: segment === seg,
  }));
  const winOptions = (["7d", "30d"] as TimeWindow[]).map((w) => ({
    label: w,
    href: `/internal?w=${w}&seg=${SEG_PARAM[segment]}${cohortQ}`,
    active: win === w,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Internal Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Phase B &middot; founders only &middot; live from production &middot; real users (founders and test excluded)
          </p>
        </div>
        <div className="flex gap-2">
          <Toggle current={SEG_PARAM[segment]} options={segOptions} />
          <Toggle current={win} options={winOptions} />
        </div>
      </div>

      {/*
        Cohort filter. A plain GET form so this page stays a Server Component
        with no client-side data fetching, matching how the window and segment
        toggles already work. Selecting a cohort scopes the stat cards only.
      */}
      <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="w" value={win} />
        <input type="hidden" name="seg" value={SEG_PARAM[segment]} />
        <label
          htmlFor="cohort"
          className="text-sm font-medium text-neutral-500 dark:text-neutral-400"
        >
          Cohort
        </label>
        <select
          id="cohort"
          name="cohort"
          defaultValue={cohortParam ?? COHORT_ALL}
          disabled={!cohortCaptureAvailable}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        >
          <option value={COHORT_ALL}>All cohorts</option>
          {(cohortOptions ?? []).map((o) => (
            <option key={o.cohort_key} value={o.cohort_key}>
              {cohortLabel(o)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!cohortCaptureAvailable}
          className="rounded-lg border border-neutral-200 px-3 py-1 text-sm text-neutral-600 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300"
        >
          Apply
        </button>
        {cohortParam ? (
          <a
            href={`/internal?w=${win}&seg=${SEG_PARAM[segment]}`}
            className="text-sm text-neutral-500 underline dark:text-neutral-400"
          >
            clear
          </a>
        ) : null}
      </form>

      {!cohortCaptureAvailable ? (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Cohort capture is wired in the application but the schema migration is
          NOT applied, so there is nothing to filter by yet. Apply
          backend/migrations/UNAPPLIED-2026-08-28-signup-cohort-capture.sql to
          turn this on. Until then every number below is unfiltered.
        </p>
      ) : null}

      {cohortMissing ? (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          No rows for cohort <code>{cohortParam}</code>. Showing UNFILTERED
          numbers. Treat this as a failure, not an empty cohort: a cohort listed
          in the filter must return a row.
        </p>
      ) : null}

      {cohortParam && !cohortMissing ? (
        <p className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          Scoped to cohort <code>{cohortParam}</code>. This scopes the STAT CARDS
          only. The activation, retention and instrumentation tables below are
          still on the {SEG_LABEL[segment]} segment and are NOT cohort-filtered,
          so do not read them as belonging to this cohort. Waitlist and Companies
          researched are global and show n/a under a cohort scope.
        </p>
      ) : null}

      {!loopFixed ? (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          The loop-fix migration is NOT applied, so several cards below are still
          on their old definitions. Brief opens are NOT deduped, so the open count
          counts page mounts rather than opens. WAPS and percent-with-a-watchlist
          still divide by every signup ever, which falls as the product grows.
          Companies researched still reads a column that is empty on every memo
          row. Apply backend/migrations/UNAPPLIED-2026-08-30-loop-fixes.sql, then
          run node scripts/invariants.mjs.
        </p>
      ) : null}

      <p className="mt-6 rounded-xl border border-neutral-900 bg-neutral-900 p-5 text-base font-medium text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900">
        {pitch}
      </p>

      <Section title="Demand">
        <Stat label="Total users" value={s.total_users} sub={SEG_LABEL[segment]} />
        <Stat label={`Active (${winLabel})`} value={activeInWindow} sub="fired an event in window" />
        <Stat label={`New users (${winLabel})`} value={newUsersInWindow} sub="window-sensitive" />
        <Stat
          label="Waitlist"
          value={s.waitlist_count === null ? "n/a" : s.waitlist_count}
          sub={isAll ? "oauth-gated, global" : "All only"}
        />
      </Section>

      <Section title="Engagement">
        {/* WAPS over TENURED users, not over every signup ever. The old
            denominator fell as the product grew: 98 of 199 users signed up
            inside the window and exactly one opened a brief, dragging the
            printed number from 10.9 to 6.0 with no change in behavior. */}
        <Stat
          label="WAPS"
          value={pctStr(wapsShown)}
          sub={
            loopFixed
              ? `${s.brief_open_users_7d} of ${tenured} tenured (7d)`
              : `${s.brief_open_users_7d} of ${s.total_users} all signups, MIGRATION NOT APPLIED`
          }
        />
        <Stat label="Weekly actives" value={s.weekly_actives} sub="distinct event users (7d)" />
        <Stat
          label="4-week retention"
          value={retention4w}
          sub={
            s.retention_4w_cohort === null
              ? "joined 4w+ ago, active last 7d"
              : `of ${s.retention_4w_cohort} joined 4w+ ago`
          }
        />
        {/* REPLACES "Brief opens / active". That card divided an inflated event
            count by active readers and printed 15.36; one account produced 195
            of 215 counted opens by remounting. Days is the honest habit unit:
            a reader who opened four times in one sitting had one day, not four. */}
        <Stat
          label="Brief-open days / week"
          value={
            s.brief_open_days_median_7d === null
              ? "n/a"
              : `${s.brief_open_days_median_7d} of 7`
          }
          sub={
            loopFixed
              ? `median across ${s.brief_open_users_7d} openers (7d)`
              : "needs the loop-fix migration"
          }
        />
      </Section>

      <Section title="Depth">
        <Stat label="Memos generated" value={s.memos_all_time} sub="all time (event log)" />
        <Stat label={`Memos (${winLabel})`} value={memosInWindow} sub="window-sensitive" />
        <Stat
          label="Companies researched"
          value={s.distinct_companies_researched === null ? "n/a" : s.distinct_companies_researched}
          sub={isAll ? "global, distinct memo target companies" : "All only"}
        />
        <Stat
          label="% with a watchlist"
          value={pctStr(loopFixed ? s.watchlist_tenured_pct : s.watchlist_pct)}
          sub={
            loopFixed
              ? `${s.users_with_watchlist} of ${tenured} tenured`
              : `${s.users_with_watchlist} of ${s.total_users} all signups, MIGRATION NOT APPLIED`
          }
        />
      </Section>

      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        Secondary (reachability, not engagement): {loggedInWindow} users had a sign-in in the last {winLabel} ({SEG_LABEL[segment]}). Active above is first-party-event based, which is the trusted engagement signal.
      </p>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Activation funnel ({SEG_LABEL[segment]})
        </h2>
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
          Within 7 days of each user&apos;s own signup. Activated = first brief open or first memo. Onboarded is the earlier setup stage. Recent weeks have small cohorts. {largestComplete
            ? `The largest cohort whose 7-day window has closed is ${largestComplete.cohort_week} (n=${largestComplete.cohort_size}); read that one.`
            : "No cohort has a closed 7-day window yet, so every row below is still accruing."}
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">Signup week</th>
                <th className="px-4 py-2 font-medium tabular-nums">Cohort</th>
                <th className="px-4 py-2 font-medium tabular-nums">Onboarded 7d</th>
                <th className="px-4 py-2 font-medium tabular-nums">Activated 7d</th>
              </tr>
            </thead>
            <tbody>
              {activation.map((a) => (
                <tr key={a.cohort_week} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-2">
                    {a.cohort_week}
                    {a.window_closed === false ? (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">
                        censored
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{a.cohort_size}</td>
                  <td className="px-4 py-2 tabular-nums">{pctStr(a.onboarded_7d_pct)}</td>
                  <td className="px-4 py-2 tabular-nums">{pctStr(a.activated_7d_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Retention cohorts ({SEG_LABEL[segment]})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">Signup week</th>
                <th className="px-4 py-2 font-medium tabular-nums">Weeks ago</th>
                <th className="px-4 py-2 font-medium tabular-nums">Cohort</th>
                <th className="px-4 py-2 font-medium tabular-nums">Active (7d)</th>
                <th className="px-4 py-2 font-medium tabular-nums">Retention</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.cohort_week} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-2">
                    {c.cohort_week}
                    {c.window_closed === false ? (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">
                        censored
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{c.weeks_since_signup}</td>
                  <td className="px-4 py-2 tabular-nums">{c.cohort_size}</td>
                  <td className="px-4 py-2 tabular-nums">{c.active_last_7d}</td>
                  <td className="px-4 py-2 tabular-nums">{pctStr(c.retention_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Instrumentation health
        </h2>
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
          Per event type, across all users. A silent event (no fires in 7d) is highlighted: it usually means a tracking regression, not real disuse.
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium tabular-nums">Days ago</th>
                <th className="px-4 py-2 font-medium tabular-nums">7d</th>
                <th className="px-4 py-2 font-medium tabular-nums">30d</th>
                <th className="px-4 py-2 font-medium tabular-nums">All</th>
              </tr>
            </thead>
            <tbody>
              {health.map((h) => {
                const silent = h.events_7d === 0;
                return (
                  <tr
                    key={h.event_type}
                    className={
                      "border-t border-neutral-100 dark:border-neutral-800 " +
                      (silent ? "bg-amber-50 dark:bg-amber-950/30" : "")
                    }
                  >
                    <td className="px-4 py-2">
                      {h.event_type}
                      {silent ? <span className="ml-2 text-amber-600 dark:text-amber-400">silent</span> : null}
                    </td>
                    <td className="px-4 py-2">{h.last_seen}</td>
                    <td className="px-4 py-2 tabular-nums">{h.days_since_last}</td>
                    <td className="px-4 py-2 tabular-nums">{h.events_7d}</td>
                    <td className="px-4 py-2 tabular-nums">{h.events_30d}</td>
                    <td className="px-4 py-2 tabular-nums">{h.events_all}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 space-y-1 text-xs text-neutral-400 dark:text-neutral-500">
        <p>
          Notes: real users only (founders and internal/test accounts excluded). Active and retention are first-party-event based, not last_sign_in_at. WAPS and brief-open metrics count in-app brief page opens (morning_brief_opened / evening_wrap_opened), not email opens. Companies researched counts distinct memo target companies, case-normalized. Segment is an email-domain proxy (USC = usc.edu and marshall.usc.edu); club-level segmentation needs new signup capture. Refresh reloads; numbers are live.
        </p>
      </div>
    </main>
  );
}
