"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserProfile } from "@/hooks/useUserProfile";
import {
  applyLens,
  newestAgeHours,
  timeAgo,
  trendCounts,
  TREND_LIMIT,
  TREND_MIN_ARTICLES,
  TREND_MIN_SOURCES,
  TREND_SELECT,
  TREND_STALE_AFTER_HOURS,
  type TrendLens,
  type TrendSignal,
} from "@/lib/trend-signals";
import { FIXTURE_ALLOWED } from "./fixture-gate";
import { TrendSignalCard } from "./trend-signal-card";
import styles from "./trends.module.css";
import { BackHeader } from "@/components/mobile";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";
import { ASK_POLE_HREF } from "@/components/shell/mobile-tab-bar";

/**
 * Mobile Trends. The theme list.
 *
 * This is a NEW FILE beside `src/app/trends/page.tsx`, never an edit to it.
 * That route is propose-only under CLAUDE.md, it is 1231 lines, and it owns
 * the desktop list, the signal modal, the sector and activity filter rows and
 * the signed-out preview. Nothing here imports it and nothing there imports
 * this. The two lists read the same table through the same predicate and
 * coexist at two paths.
 *
 * Everything shared is pure and lives in `@/lib/trend-signals`: the row shape,
 * the fetch predicate, the level cutoffs, the relative clock and the counts.
 * One home, so the two surfaces cannot drift about what "Critical" means.
 */

const PAD = "var(--v3-pad)";

export type TrendsStage = "ready" | "loading" | "error" | "empty" | "stale";

/**
 * What the server page hands down when, and only when, the gate is open.
 *
 * The rows are built on the server and passed as data rather than imported
 * here, so `fixture.ts` never enters the client graph and its invented prose
 * never reaches a production chunk. `signals` is already the right rows for the
 * stage: the page calls the stale builder for "stale" and passes an empty list
 * for "empty", "loading" and "error".
 */
export interface TrendsPreview {
  stage: TrendsStage;
  signals: TrendSignal[];
  /** The fixture's fixed anchor, never a wall clock. See `./fixture`. */
  now: number;
}

/**
 * The clock rides with the rows, and exists only when there are rows.
 *
 * Every derivation on this screen needs a "now", and none of them run before
 * the rows land. Carrying the instant on the ready state means the live path
 * can read the real clock inside the fetch effect, which is not render and so
 * cannot differ between the server pass and hydration, while the fixture path
 * uses its fixed anchor. Neither path reads a clock during render.
 */
type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; signals: TrendSignal[]; now: number };

const EMPTY: TrendSignal[] = [];

const LENSES: { value: TrendLens; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "mine", label: "My sectors" },
];

export function TrendsScreen({ preview = null }: { preview?: TrendsPreview | null }) {
  const [lens, setLens] = useState<TrendLens>("all");
  const [live, setLive] = useState<LoadState>({ status: "loading" });
  const { profile, loading: profileLoading } = useUserProfile();

  /* Re-gated HERE, not only on the page. `MOBILE_REDESIGN_DEV_PATHS` in
     `src/proxy.ts` does not gate production at all: `isPublicPath` is consulted
     only when there is no user, so a signed-in reader skips the allowlist and
     reaches this route on a production deployment. This check and the page's
     are the whole defence, so this component refuses to render anything it was
     handed unless the gate is open, whatever the page decided. Fails closed:
     production always takes the loader below, so a production reader sees
     loading until real rows arrive, never three invented themes and never a
     sentence about a tape nobody read. */
  const gated = FIXTURE_ALLOWED ? preview : null;
  const fixtureStage = gated?.stage ?? null;

  useEffect(() => {
    if (fixtureStage !== null) return;
    let cancelled = false;
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase
      .from("trend_clusters")
      .select(TREND_SELECT)
      .gte("article_count", TREND_MIN_ARTICLES)
      .gte("source_count", TREND_MIN_SOURCES)
      .order("created_at", { ascending: false })
      /* `created_at` is not unique: one pipeline run stamps every cluster it
         writes with the same value, so a LIMIT over it alone is free to keep a
         different subset on each call. Same tiebreak PR #640 put on the three
         other truncating reads. */
      .order("id", { ascending: true })
      .limit(TREND_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          /* A failed read is an error, never an empty list. The desktop route
             logs the failure and falls through to "No trend clusters yet",
             which states a fact about the tape on the strength of no data at
             all. This screen says the read failed, because that is what
             happened. */
          console.error("[trends-mobile] fetch failed:", error?.message ?? "no rows returned");
          setLive({ status: "error" });
          return;
        }
        setLive({
          status: "ready",
          /* The real clock, read here rather than during render. This callback
             runs in an effect on the client only, so there is no server pass to
             disagree with and every label below is measured from one instant. */
          now: Date.now(),
          signals: (data as Record<string, unknown>[]).map((row) => ({
            id: String(row.id),
            label: (row.label as string) || "Untitled signal",
            headline: (row.headline as string | null) ?? null,
            tagline: (row.tagline as string | null) ?? null,
            article_count: (row.article_count as number) ?? 0,
            source_count: (row.source_count as number) ?? 0,
            strength_score: (row.strength_score as number) ?? 0,
            top_themes: asStrings(row.top_themes),
            top_sectors: asStrings(row.top_sectors),
            top_companies: asStrings(row.top_companies),
            created_at: (row.created_at as string | null) ?? null,
          })),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureStage]);

  const state: LoadState = useMemo(() => {
    if (fixtureStage === null) return live;
    if (fixtureStage === "loading") return { status: "loading" };
    if (fixtureStage === "error") return { status: "error" };
    /* "empty" and "stale" are not special-cased here any more. The page built
       the rows that belong to the stage, so this only has to say which status
       carries them. */
    return { status: "ready", signals: gated?.signals ?? [], now: gated?.now ?? 0 };
  }, [fixtureStage, gated, live]);

  /* Memoised so the empty case is one stable array rather than a fresh literal
     on every render, which would make every derivation below recompute. */
  const signals = useMemo(
    () => (state.status === "ready" ? state.signals : EMPTY),
    [state],
  );
  /* Zero is never rendered: every consumer of `now` sits inside a
     `state.status === "ready"` branch, and that branch always carries a real
     instant. */
  const now = state.status === "ready" ? state.now : 0;
  const counts = useMemo(() => trendCounts(signals, now), [signals, now]);
  const sectors = useMemo(
    () => (profile?.sectors ?? []).map((s) => s.toLowerCase()),
    [profile?.sectors],
  );
  const visible = useMemo(() => applyLens(signals, lens, sectors), [signals, lens, sectors]);
  const ageHours = useMemo(() => newestAgeHours(signals, now), [signals, now]);
  const isStale = ageHours !== null && ageHours >= TREND_STALE_AFTER_HOURS;
  const newestLabel = useMemo(() => {
    if (ageHours === null) return "";
    return timeAgo(new Date(now - ageHours * 3600000).toISOString(), now);
  }, [ageHours, now]);

  return (
    <div
      data-parity="trends"
      className={styles.enter}
      style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}
    >
      {/* Back to Ask. The prototype's control goes back to the Ask directory
          at `:2130`, and this points at the Ask pole's own destination,
          exactly the precedent `mobile-tab-bar.tsx` set for Watch: aim at the
          live surface rather than at a route that would 404.

          THAT SENTENCE WAS ALREADY TRUE AND THE VALUE WAS STILL WRONG. The
          href was the literal `/intelligence`, where the pole pointed when
          this was written; PR #736 moved the pole to /ask and the literal did
          not move with it. The comment described a dependency the code did not
          have. It has it now: `ASK_POLE_HREF` comes from the pole table, so
          the next pole move carries these three controls with it.

          AND A FIXED DESTINATION WAS STILL NOT A BACK. `search-data.ts:79`
          jumps a reader straight here, and the pole owns /trends-mobile
          without anything on /ask linking to it, so an arrival from Ask is one
          of several entrances rather than the only one. A chevron that always
          lands on Ask is a lateral jump for the rest of them. `historyAware`
          steps back to the actual previous entry and keeps `ASK_POLE_HREF` for
          the cold entry, where `history.back()` is a no-op. The row is
          `BackHeader`'s now, which is where that rule lives, once.

          `boxSizing` is carried through rather than dropped: content-box
          matches the prototype's own box model, and the app sets border-box
          globally, which would eat the 1px rule out of the 48px row and land
          the bar a pixel short of the drawn height. The other BackHeader
          screens build at border-box, so the difference is passed explicitly
          instead of being normalised away by this consolidation. */}
      <BackHeader
        href={ASK_POLE_HREF}
        label="Ask"
        historyAware
        boxSizing="content-box"
      />

      <div style={{ padding: `14px ${PAD} 0` }}>
        <h1
          style={{
            margin: 0,
            font: `700 24px/1.14 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Trends
        </h1>
        {/* Both figures are read from the rows. The prototype types "34 active,
            3 moved this week" into markup, which the handoff forbids, and
            `trend_clusters` has no field for movement of any kind, so "moved"
            becomes "new" and is counted off `created_at`. */}
        <p
          style={{
            margin: "7px 0 0",
            font: `400 12.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-secondary)",
          }}
        >
          {state.status === "ready"
            ? `Clustered signals across the index. ${counts.total} active, ${counts.newThisWeek} new this week.`
            : "Clustered signals across the index."}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          padding: `14px ${PAD}`,
        }}
      >
        {LENSES.map((l) => (
          <LensChip
            key={l.value}
            label={l.label}
            /* No count until the rows are in. A chip reading "Critical 0"
               while the read is still in flight is a claim about the tape
               made with nothing to read it from. */
            count={state.status === "ready" ? lensCount(l.value, counts) : null}
            active={lens === l.value}
            disabled={state.status !== "ready"}
            onSelect={() => setLens(l.value)}
          />
        ))}
      </div>

      <div
        style={{
          /* The shell does NOT reserve the tab bar, whatever app-shell.tsx:172
             looks like. `<main>` carries
             `pb-[calc(var(--mobile-tabbar-height)+env(safe-area-inset-bottom))]`
             below md, but the overflow comes from inside PageTransition and
             the padding never lands in the scroll extent.

             Measured on this page, at 390 with the fixture, after scrolling to
             the bottom. With `24px` alone: last card bottom 791, tab bar top
             785, scrollHeight 844 against a clientHeight of 844, so the card
             sits 6px under the bar and the page cannot scroll to free it. With
             the reserve below: last card bottom 761 against the same bar top
             of 785, 24px of clearance, scrollHeight 874.

             A code review asked for the reserve to come out as a double count.
             It is not one. The numbers above are why it stays. */
          padding: `0 ${PAD} calc(24px + var(--mobile-tabbar-height) + env(safe-area-inset-bottom))`,
        }}
      >
        {state.status === "loading" ? <TrendsLoading /> : null}
        {state.status === "error" ? <TrendsError /> : null}

        {state.status === "ready" ? (
          <>
            {isStale ? <StaleNotice newestLabel={newestLabel} /> : null}
            {signals.length === 0 ? (
              <Notice
                title="No trend clusters yet"
                body="Signals appear here once the pipeline has clustered enough coverage to name a theme."
              />
            ) : visible.length === 0 && lens === "mine" && sectors.length === 0 ? (
              /* An unread profile is not an unset one. Until /api/user-profile
                 answers, `sectors` is empty for a reader who has sectors set,
                 and telling them to go set them would be a claim made with
                 nothing to read it from. */
              profileLoading ? (
                <Notice
                  title="Reading your sectors"
                  body="This lens follows the sectors on your profile."
                />
              ) : (
                <Notice
                  title="Your sectors are not set yet"
                  body="Set them on your profile and this lens follows them."
                />
              )
            ) : visible.length === 0 ? (
              <Notice title="Nothing under this lens" body="Another lens may carry it." />
            ) : (
              visible.map((s, i) => (
                <TrendSignalCard
                  key={s.id}
                  signal={s}
                  now={now}
                  first={i === 0}
                />
              ))
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function lensCount(
  lens: TrendLens,
  counts: ReturnType<typeof trendCounts>,
): number | null {
  if (lens === "all") return counts.total;
  if (lens === "critical") return counts.critical;
  if (lens === "high") return counts.high;
  if (lens === "medium") return counts.medium;
  /* "My sectors" carries no count in the design and cannot carry one honestly
     here either: the count would depend on a profile that may not have loaded
     yet, and a figure that changes under the reader is worse than none. */
  return null;
}

function LensChip({
  label,
  count,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  count: number | null;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      style={{
        /* content-box, as the prototype draws it: 44px of content plus the 1px
           rule top and bottom. Under the app's global border-box the rule
           would come out of the tap target and leave it at the floor rather
           than above it. */
        boxSizing: "content-box",
        flex: "none",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        border: `1px solid ${active ? "var(--c-ink)" : "var(--c-border)"}`,
        font: `${active ? 600 : 500} 12px/1 ${FONT_SANS}`,
        color: active ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: active ? "var(--c-surface)" : "transparent",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {count === null ? label : `${label} ${count}`}
    </button>
  );
}

function TrendsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Reading the clusters</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            marginTop: i === 0 ? 0 : "11px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-card)",
            overflow: "hidden",
          }}
        >
          <div style={{ height: "2px", backgroundColor: "var(--c-border)" }} />
          <div style={{ padding: "14px 15px" }}>
            <Skeleton className="h-[16px] w-[74px]" />
            <Skeleton className="mt-[10px] h-[16px] w-[128px]" />
            <Skeleton className="mt-[11px] h-[20px] w-full" />
            <Skeleton className="mt-[6px] h-[20px] w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendsError() {
  return (
    <Notice
      title="The clusters did not load"
      body="The read failed, so nothing here is a statement about today. Reload to try again."
    />
  );
}

function StaleNotice({ newestLabel }: { newestLabel: string }) {
  return (
    <div
      style={{
        marginBottom: "11px",
        padding: "11px 13px",
        border: "1px solid var(--c-border)",
        borderRadius: "9px",
        backgroundColor: "var(--c-well)",
        font: `400 12px/1.5 ${FONT_SANS}`,
        color: "var(--c-secondary)",
      }}
    >
      {`Newest cluster is ${newestLabel}. Nothing has been written since.`}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: "34px 6px", textAlign: "center" }}>
      <p
        style={{
          margin: 0,
          font: `700 15px/1.35 ${FONT_DISPLAY}`,
          color: "var(--c-ink)",
        }}
      >
        {title}
      </p>
      <p
        style={{
          margin: "7px auto 0",
          maxWidth: "280px",
          font: `400 12px/1.5 ${FONT_SANS}`,
          color: "var(--c-secondary)",
        }}
      >
        {body}
      </p>
    </div>
  );
}

function asStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}
