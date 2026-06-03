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
  type TimeWindow,
  type Segment,
} from "@/lib/internal-kpis";

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
  searchParams: Promise<{ w?: string; seg?: string }>;
}) {
  // Gate FIRST. Nothing below runs for a non-admin.
  await requireAdmin();

  const sp = await searchParams;
  const win: TimeWindow = sp.w === "30d" ? "30d" : "7d";
  const segment: Segment = sp.seg === "usc" ? "USC" : sp.seg === "other" ? "other" : "All";

  const [s, cohorts, activation, health] = await Promise.all([
    fetchKpiSummary(segment),
    fetchRetentionCohorts(segment),
    fetchActivation(segment),
    fetchInstrumentationHealth(),
  ]);

  const winLabel = win === "30d" ? "30d" : "7d";
  const newUsersInWindow = win === "30d" ? s.new_users_30d : s.new_users_7d;
  const activeInWindow = win === "30d" ? s.active_30d : s.weekly_actives;
  const loggedInWindow = win === "30d" ? s.logged_in_30d : s.logged_in_7d;
  const memosInWindow = win === "30d" ? s.memos_30d : s.memos_7d;
  const retention4w = pctStr(s.retention_4w_pct);
  const isAll = segment === "All";

  const pitch = `${SEG_LABEL[segment]}: ${s.weekly_actives} weekly actives of ${s.total_users} users, ${retention4w} four-week retention, WAPS ${pctStr(s.waps_pct)}${isAll && s.waitlist_count !== null ? `, ${s.waitlist_count} on the waitlist` : ""}.`;

  // Toggle hrefs preserve the other dimension.
  const segOptions = (["All", "USC", "other"] as Segment[]).map((seg) => ({
    label: SEG_LABEL[seg],
    href: `/internal?w=${win}&seg=${SEG_PARAM[seg]}`,
    active: segment === seg,
  }));
  const winOptions = (["7d", "30d"] as TimeWindow[]).map((w) => ({
    label: w,
    href: `/internal?w=${w}&seg=${SEG_PARAM[segment]}`,
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
        <Stat label="WAPS" value={pctStr(s.waps_pct)} sub="weekly brief openers / total (7d)" />
        <Stat label="Weekly actives" value={s.weekly_actives} sub="distinct event users (7d)" />
        <Stat label="4-week retention" value={retention4w} sub="joined 4w+ ago, active last 7d" />
        <Stat
          label="Brief opens / active"
          value={s.brief_opens_per_active === null ? "n/a" : s.brief_opens_per_active}
          sub="in-app opens (7d)"
        />
      </Section>

      <Section title="Depth">
        <Stat label="Memos generated" value={s.memos_all_time} sub="all time (event log)" />
        <Stat label={`Memos (${winLabel})`} value={memosInWindow} sub="window-sensitive" />
        <Stat
          label="Companies researched"
          value={s.distinct_companies_researched === null ? "n/a" : s.distinct_companies_researched}
          sub={isAll ? "global, capture fix deferred (D5a)" : "All only"}
        />
        <Stat label="% with a watchlist" value={pctStr(s.watchlist_pct)} sub={`${s.users_with_watchlist} of ${s.total_users}`} />
      </Section>

      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        Secondary (reachability, not engagement): {loggedInWindow} users had a sign-in in the last {winLabel} ({SEG_LABEL[segment]}). Active above is first-party-event based, which is the trusted engagement signal.
      </p>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Activation funnel ({SEG_LABEL[segment]})
        </h2>
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
          Within 7 days of each user&apos;s own signup. Activated = first brief open or first memo. Onboarded is the earlier setup stage. Recent weeks have small cohorts; the 2026-04-27 cohort is the reliable read.
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
                  <td className="px-4 py-2">{a.cohort_week}</td>
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
                  <td className="px-4 py-2">{c.cohort_week}</td>
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
          Notes: real users only (founders and internal/test accounts excluded). Active and retention are first-party-event based, not last_sign_in_at. WAPS and brief-open metrics count in-app brief page opens (morning_brief_opened / evening_wrap_opened), not email opens. Companies researched keeps the Phase A definition; reliable capture is deferred to D5a. Segment is an email-domain proxy (USC = usc.edu and marshall.usc.edu); club-level segmentation needs new signup capture. Refresh reloads; numbers are live.
        </p>
      </div>
    </main>
  );
}
