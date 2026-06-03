// Founders-only internal analytics dashboard (Phase A).
//
// Pure Server Component. requireAdmin() runs first and fail-closes with a 404
// for anyone not on ADMIN_EMAILS, so no KPI query runs for a non-admin. All
// numbers are fetched server-side via the service-role client; there is no
// client-side data fetching and no public metrics endpoint. The 7d/30d window
// is read from the ?w= query param so the page stays a Server Component and a
// refresh is just a reload. Not linked anywhere in the app navigation.
import { requireAdmin } from "@/lib/require-admin";
import {
  fetchKpiSummary,
  fetchRetentionCohorts,
  pct,
  ratio,
  type TimeWindow,
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
      <div className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{children}</div>
    </section>
  );
}

export default async function InternalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  // Gate FIRST. Nothing below runs for a non-admin.
  await requireAdmin();

  const sp = await searchParams;
  const win: TimeWindow = sp.w === "30d" ? "30d" : "7d";

  const [s, cohorts] = await Promise.all([
    fetchKpiSummary(),
    fetchRetentionCohorts(),
  ]);

  // Ratio KPIs derived from raw view counts.
  const wapsPct = pct(s.brief_open_users_7d, s.total_users); // weekly brief openers / total
  const watchlistPct = pct(s.users_with_watchlist, s.total_users);
  const briefOpensPerActive = ratio(s.brief_opens_7d, s.weekly_actives);

  // Window-sensitive figures.
  const newUsersInWindow = win === "30d" ? s.new_users_30d : s.new_users_7d;
  const memosInWindow = win === "30d" ? s.memos_30d : s.memos_7d;
  const winLabel = win === "30d" ? "30d" : "7d";

  const retention4w =
    s.retention_4w_pct === null ? "n/a" : `${s.retention_4w_pct}%`;

  // Auto-assembled pitch line from live numbers.
  const pitch = `${s.weekly_actives} weekly actives, ${retention4w} four-week retention, and ${s.waitlist_count} on the waitlist across ${s.total_users} signups.`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            Internal Dashboard
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Phase A &middot; founders only &middot; live from production
          </p>
        </div>
        <div className="flex rounded-lg border border-neutral-200 p-1 text-sm dark:border-neutral-800">
          <a
            href="/internal?w=7d"
            className={
              "rounded-md px-3 py-1 " +
              (win === "7d"
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 dark:text-neutral-300")
            }
          >
            7d
          </a>
          <a
            href="/internal?w=30d"
            className={
              "rounded-md px-3 py-1 " +
              (win === "30d"
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 dark:text-neutral-300")
            }
          >
            30d
          </a>
        </div>
      </div>

      <p className="mt-6 rounded-xl border border-neutral-900 bg-neutral-900 p-5 text-base font-medium text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900">
        {pitch}
      </p>

      <Section title="Demand">
        <Stat label="Total users" value={s.total_users} />
        <Stat label="Active (7d)" value={s.active_7d} sub="signed in, last 7 days" />
        <Stat label="Active (30d)" value={s.active_30d} sub="signed in, last 30 days" />
        <Stat
          label={`New users (${winLabel})`}
          value={newUsersInWindow}
          sub="window-sensitive"
        />
        <Stat label="Waitlist" value={s.waitlist_count} sub="oauth-gated signups" />
      </Section>

      <Section title="Engagement">
        <Stat
          label="WAPS"
          value={`${wapsPct}%`}
          sub="weekly brief openers / total (7d)"
        />
        <Stat
          label="Weekly actives"
          value={s.weekly_actives}
          sub="distinct event users (7d)"
        />
        <Stat
          label="4-week retention"
          value={retention4w}
          sub="joined 4w+ ago, active last 7d"
        />
        <Stat
          label="Brief opens / active"
          value={briefOpensPerActive}
          sub="in-app opens (7d)"
        />
      </Section>

      <Section title="Depth">
        <Stat
          label="Memos generated"
          value={s.memos_all_time}
          sub="all time (event log)"
        />
        <Stat
          label={`Memos (${winLabel})`}
          value={memosInWindow}
          sub="window-sensitive"
        />
        <Stat
          label="Companies researched"
          value={s.distinct_companies_researched}
          sub="undercount, see note"
        />
        <Stat
          label="% with a watchlist"
          value={`${watchlistPct}%`}
          sub={`${s.users_with_watchlist} of ${s.total_users}`}
        />
      </Section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Retention cohorts
        </h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">Signup week</th>
                <th className="px-4 py-2 font-medium">Weeks ago</th>
                <th className="px-4 py-2 font-medium tabular-nums">Cohort</th>
                <th className="px-4 py-2 font-medium tabular-nums">Active (7d)</th>
                <th className="px-4 py-2 font-medium tabular-nums">Retention</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr
                  key={c.cohort_week}
                  className="border-t border-neutral-100 dark:border-neutral-800"
                >
                  <td className="px-4 py-2">{c.cohort_week}</td>
                  <td className="px-4 py-2 tabular-nums">{c.weeks_since_signup}</td>
                  <td className="px-4 py-2 tabular-nums">{c.cohort_size}</td>
                  <td className="px-4 py-2 tabular-nums">{c.active_last_7d}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {c.retention_pct === null ? "n/a" : `${c.retention_pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 space-y-1 text-xs text-neutral-400 dark:text-neutral-500">
        <p>
          Notes: WAPS and brief-open metrics count in-app brief page opens
          (morning_brief_opened / evening_wrap_opened), not email opens. Memos
          generated uses the user_events log; companies researched is a known
          undercount because memo outputs do not persist a target company id
          today (Phase B). Refresh reloads the page; numbers are live.
        </p>
      </div>
    </main>
  );
}
