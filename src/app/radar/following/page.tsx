"use client";

/**
 * Radar / Following — an editorial dispatch of developments across what
 * the user follows (topics, entities, industries, activities). Follows
 * match the ALREADY-INGESTED corpus only; nothing here triggers
 * per-follow external fetches.
 *
 * HONESTY RULES enforced on this surface:
 *  - Descriptive copy ONLY. Every headline/summary is the article's own
 *    text; kickers are follow names; this page never writes evaluative
 *    words (bullish/leaning/compounding) about a follow. The data layer
 *    (radar-following.ts) does not even load sentiment.
 *  - Honest thin states: a quiet follow collapses into "Also watching";
 *    an empty week says so plainly and invites adding a follow. Nothing
 *    is padded with filler.
 *
 * Layout: dark summary strip (view toggle: By topic / By activity /
 * Timeline), lead development (Newsreader, kicker, gold hairline),
 * asymmetric secondary pairs, then the quiet-follow collapse.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { RadarTabs } from "@/components/radar/RadarTabs";
import type { FollowArticle } from "@/lib/radar-following";
import { ArticleMemoActions } from "@/components/radar/ArticleMemoActions";
import { EvidenceMap } from "@/components/radar/EvidenceMap";

interface FollowSummary {
  id: string;
  follow_type: "ticker" | "company" | "industry" | "activity" | "topic";
  target: string;
  display_name: string | null;
  muted: boolean;
}

interface Development {
  follow: FollowSummary;
  articles: FollowArticle[];
}

type ViewMode = "topic" | "activity" | "timeline" | "map";
const VIEW_STORAGE_KEY = "radar-following-view";

const STARTER_TOPICS = [
  "AI infrastructure capex",
  "GLP-1 drugs",
  "Grid and power demand",
  "Semiconductor export controls",
  "Private credit",
];
const INDUSTRY_OPTIONS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
];
const ACTIVITY_OPTIONS = [
  "Mergers & Acquisitions", "Private Equity", "Venture Capital",
  "IPO & Capital Markets", "Earnings & Results", "Macro & Policy", "Geopolitics",
  "Regulation & Legal", "Fundraising", "Crypto & Digital Assets",
  "Leadership & Operations",
];

const SERIF = "var(--font-playfair-display), serif";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function followLabel(f: FollowSummary): string {
  return (f.display_name ?? f.target).trim() || f.target;
}

const TYPE_LABEL: Record<FollowSummary["follow_type"], string> = {
  ticker: "Ticker",
  company: "Company",
  industry: "Industry",
  activity: "Activity",
  topic: "Topic",
};

export default function FollowingPage() {
  const [developments, setDevelopments] = useState<Development[] | null>(null);
  const [follows, setFollows] = useState<FollowSummary[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("topic");
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<FollowSummary["follow_type"]>("topic");
  const [addText, setAddText] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [mapFollowId, setMapFollowId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "topic" || stored === "activity" || stored === "timeline" || stored === "map") {
      setView(stored);
    }
  }, []);
  const changeView = (v: ViewMode) => {
    setView(v);
    window.localStorage.setItem(VIEW_STORAGE_KEY, v);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/radar/following-feed");
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setUnavailable(Boolean(json.unavailable));
      const devs: Development[] = json.developments ?? [];
      setDevelopments(devs);
      setFollows(devs.map((d) => d.follow));
    } catch {
      setDevelopments([]);
      setFollows([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const addFollow = async (followType: FollowSummary["follow_type"], target: string) => {
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch("/api/radar/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_type: followType, target }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAddError(json.error ?? "Could not add the follow.");
        return;
      }
      setAddText("");
      await load();
    } catch {
      setAddError("Could not add the follow.");
    } finally {
      setAddBusy(false);
    }
  };

  const removeFollow = async (id: string) => {
    await fetch(`/api/radar/follows?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  };
  const toggleMute = async (id: string, muted: boolean) => {
    await fetch("/api/radar/follows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, muted }),
    });
    await load();
  };

  // ── Derived shapes ──
  const active = useMemo(
    () => (developments ?? []).filter((d) => !d.follow.muted && d.articles.length > 0),
    [developments],
  );
  const quiet = useMemo(
    () => (developments ?? []).filter((d) => d.follow.muted || d.articles.length === 0),
    [developments],
  );
  const allArticles = useMemo(() => {
    const seen = new Set<string>();
    const out: { article: FollowArticle; follow: FollowSummary }[] = [];
    for (const d of active) {
      for (const a of d.articles) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        out.push({ article: a, follow: d.follow });
      }
    }
    return out.sort(
      (x, y) =>
        new Date(y.article.published_at ?? 0).getTime() -
        new Date(x.article.published_at ?? 0).getTime(),
    );
  }, [active]);

  const lead = allArticles[0] ?? null;
  const secondaries = allArticles.slice(1, 7);

  const byActivity = useMemo(() => {
    const groups = new Map<string, { article: FollowArticle; follow: FollowSummary }[]>();
    for (const entry of allArticles) {
      const tags = entry.article.activity_types?.length
        ? entry.article.activity_types
        : ["Other developments"];
      const tag = tags[0];
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(entry);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [allArticles]);

  const isEmpty = !loading && follows.length === 0;

  return (
    <AppShell pageTitle="Radar">
      <div className="motion-page-enter p-6 max-w-[1080px]">
        <RadarTabs active="following" />

        {loading ? null : isEmpty ? (
          <FirstRun
            onAdd={addFollow}
            busy={addBusy}
            error={addError}
            unavailable={unavailable}
          />
        ) : (
          <>
            {/* Dark summary strip: counts + view toggle. Numbers are real. */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-espresso px-5 py-4 text-cream dark:bg-elevated dark:border dark:border-border-default">
              <div className="font-sans text-[13px]">
                <span className="font-semibold">{follows.length}</span> followed ·{" "}
                <span className="font-semibold">{allArticles.length}</span> developments
                this week
                {quiet.length > 0 && (
                  <span className="opacity-70"> · {quiet.length} quiet</span>
                )}
              </div>
              <div className="flex items-center gap-1 font-sans text-[12px]">
                {(
                  [
                    ["topic", "By topic"],
                    ["activity", "By activity"],
                    ["timeline", "Timeline"],
                    ["map", "Map"],
                  ] as [ViewMode, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => changeView(key)}
                    className={
                      "rounded-md px-2.5 py-1 transition-colors " +
                      (view === key
                        ? "bg-gold text-espresso font-semibold"
                        : "text-cream/70 hover:text-cream dark:text-text-secondary")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Manage row: follow chips + add. */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
              {follows.map((f) => (
                <span
                  key={f.id}
                  className={
                    "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-sans text-[12px] " +
                    (f.muted
                      ? "border-border-subtle text-text-faint"
                      : "border-border-default text-text-secondary")
                  }
                  title={`${TYPE_LABEL[f.follow_type]}: ${f.target}`}
                >
                  {followLabel(f)}
                  <button
                    onClick={() => toggleMute(f.id, !f.muted)}
                    className="text-text-faint hover:text-text-primary"
                    title={f.muted ? "Unmute" : "Mute"}
                  >
                    {f.muted ? "◌" : "●"}
                  </button>
                  <button
                    onClick={() => removeFollow(f.id)}
                    className="text-text-faint hover:text-signal-dn"
                    title="Unfollow"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                onClick={() => setAddOpen((v) => !v)}
                className="rounded-full border border-dashed border-border-default px-2.5 py-1 font-sans text-[12px] text-text-muted hover:border-gold hover:text-text-primary"
              >
                + Follow
              </button>
            </div>
            {addOpen && (
              <AddFollowForm
                addType={addType}
                setAddType={setAddType}
                addText={addText}
                setAddText={setAddText}
                busy={addBusy}
                error={addError}
                onSubmit={(t, target) => void addFollow(t, target)}
              />
            )}

            {allArticles.length === 0 ? (
              <div className="rounded-xl border border-border-subtle bg-elevated px-5 py-6">
                <p className="font-sans text-[13px] text-text-muted">
                  Nothing matched what you follow in the last 7 days. That is the
                  honest answer, not a gap in coverage display. Add a broader
                  follow, an industry, or a topic to widen the net.
                </p>
              </div>
            ) : view === "map" ? (
              <MapView
                developments={active}
                mapFollowId={mapFollowId}
                setMapFollowId={setMapFollowId}
              />
            ) : view === "timeline" ? (
              <TimelineView entries={allArticles} />
            ) : view === "activity" ? (
              <ActivityView groups={byActivity} />
            ) : (
              <>
                {lead && <LeadDevelopment entry={lead} />}
                {secondaries.length > 0 && (
                  <div className="motion-stagger mt-6 grid gap-4 md:grid-cols-2">
                    {secondaries.map((entry, i) => (
                      <SecondaryCard
                        key={entry.article.id}
                        entry={entry}
                        wide={i % 3 === 0}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Quiet follows: honest collapse, never padded. */}
            {quiet.length > 0 && (
              <div className="mt-8 border-t border-border-subtle pt-4">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
                  Also watching
                </p>
                <p className="mt-2 font-sans text-[13px] text-text-muted">
                  {quiet.map((d, i) => (
                    <span key={d.follow.id}>
                      {i > 0 && " · "}
                      {followLabel(d.follow)}
                      {d.follow.muted ? " (muted)" : ""}
                    </span>
                  ))}
                </p>
                <p className="mt-1 font-sans text-[12px] text-text-faint">
                  No developments matched these in the last 7 days.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ── Sub-components ── */

function Kicker({ follow }: { follow: FollowSummary }) {
  return (
    <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
      {followLabel(follow)}
      <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">
        {TYPE_LABEL[follow.follow_type]}
      </span>
    </p>
  );
}

function SourceLine({ article }: { article: FollowArticle }) {
  // View-source lives in the shared hover action row (ArticleMemoActions),
  // matching the live-feed affordance, not a static link here.
  return (
    <p className="mt-2 font-sans text-[12px] text-text-faint">
      {[article.source, timeAgo(article.published_at)].filter(Boolean).join(" · ")}
    </p>
  );
}

function LeadDevelopment({
  entry,
}: {
  entry: { article: FollowArticle; follow: FollowSummary };
}) {
  return (
    <article className="group border-t-2 pb-2" style={{ borderTopColor: "var(--gold)" }}>
      <div className="pt-4">
        <Kicker follow={entry.follow} />
        <h2
          className="mt-2 text-text-primary"
          style={{ fontFamily: SERIF, fontSize: "26px", lineHeight: 1.25, fontWeight: 600 }}
        >
          {entry.article.title}
        </h2>
        {entry.article.summary && (
          <p
            className="mt-2 max-w-[640px] text-text-secondary"
            style={{ fontFamily: SERIF, fontSize: "15px", lineHeight: 1.55 }}
          >
            {entry.article.summary}
          </p>
        )}
        <SourceLine article={entry.article} />
        <ArticleMemoActions article={entry.article} />
      </div>
    </article>
  );
}

function SecondaryCard({
  entry,
  wide,
}: {
  entry: { article: FollowArticle; follow: FollowSummary };
  wide: boolean;
}) {
  return (
    <article
      className={
        "group card-hover-lift rounded-lg border border-border-subtle bg-elevated px-4 py-3.5 " +
        (wide ? "md:col-span-2 md:flex md:items-baseline md:gap-6" : "")
      }
    >
      <div className={wide ? "md:flex-1" : ""}>
        <Kicker follow={entry.follow} />
        <h3
          className="mt-1.5 text-text-primary"
          style={{ fontFamily: SERIF, fontSize: wide ? "18px" : "15px", lineHeight: 1.35, fontWeight: 600 }}
        >
          {entry.article.title}
        </h3>
        <SourceLine article={entry.article} />
        <ArticleMemoActions article={entry.article} />
      </div>
    </article>
  );
}

function TimelineView({
  entries,
}: {
  entries: { article: FollowArticle; follow: FollowSummary }[];
}) {
  return (
    <ol className="space-y-0">
      {entries.map((entry) => (
        <li
          key={entry.article.id}
          className="flex items-baseline gap-4 border-b border-border-subtle py-3"
        >
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-faint">
            {timeAgo(entry.article.published_at)}
          </span>
          <div className="group">
            <Kicker follow={entry.follow} />
            <p
              className="mt-0.5 text-text-primary"
              style={{ fontFamily: SERIF, fontSize: "14px", lineHeight: 1.4 }}
            >
              {entry.article.title}
            </p>
            <ArticleMemoActions article={entry.article} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActivityView({
  groups,
}: {
  groups: [string, { article: FollowArticle; follow: FollowSummary }[]][];
}) {
  return (
    <div className="space-y-7">
      {groups.map(([tag, entries]) => (
        <section key={tag}>
          <h3 className="mb-3 border-b border-border-subtle pb-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            {tag}
            <span className="ml-2 font-normal text-text-faint">{entries.length}</span>
          </h3>
          <div className="motion-stagger grid gap-4 md:grid-cols-2">
            {entries.slice(0, 6).map((entry, i) => (
              <SecondaryCard key={entry.article.id} entry={entry} wide={i === 0 && entries.length > 2} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MapView({
  developments,
  mapFollowId,
  setMapFollowId,
}: {
  developments: Development[];
  mapFollowId: string | null;
  setMapFollowId: (id: string) => void;
}) {
  const selected =
    developments.find((d) => d.follow.id === mapFollowId) ?? developments[0];
  if (!selected) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {developments.map((d) => (
          <button
            key={d.follow.id}
            onClick={() => setMapFollowId(d.follow.id)}
            className={
              "rounded-full border px-2.5 py-1 font-sans text-[12px] " +
              (d.follow.id === selected.follow.id
                ? "border-gold font-semibold text-text-primary"
                : "border-border-default text-text-muted hover:text-text-primary")
            }
          >
            {followLabel(d.follow)}
            <span className="ml-1 text-text-faint">{d.articles.length}</span>
          </button>
        ))}
      </div>
      <EvidenceMap
        centerLabel={followLabel(selected.follow)}
        articles={selected.articles.map((a) => ({
          ...a,
          source: a.source ?? undefined,
          summary: a.summary ?? undefined,
          url: a.url ?? undefined,
          published_at: a.published_at ?? undefined,
          industry_verticals: a.industry_verticals ?? undefined,
          activity_types: a.activity_types ?? undefined,
        }))}
      />
    </div>
  );
}

function AddFollowForm({
  addType,
  setAddType,
  addText,
  setAddText,
  busy,
  error,
  onSubmit,
}: {
  addType: FollowSummary["follow_type"];
  setAddType: (t: FollowSummary["follow_type"]) => void;
  addText: string;
  setAddText: (v: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: (t: FollowSummary["follow_type"], target: string) => void;
}) {
  const chipOptions =
    addType === "industry" ? INDUSTRY_OPTIONS : addType === "activity" ? ACTIVITY_OPTIONS : null;
  return (
    <div className="mb-6 rounded-xl border border-border-subtle bg-elevated px-4 py-4">
      <div className="flex gap-1 font-sans text-[12px]">
        {(["topic", "ticker", "company", "industry", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAddType(t)}
            className={
              "rounded-md px-2.5 py-1 " +
              (addType === t
                ? "bg-espresso text-cream dark:bg-overlay dark:text-foreground font-semibold"
                : "text-text-muted hover:text-text-primary")
            }
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {chipOptions ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chipOptions.map((opt) => (
            <button
              key={opt}
              disabled={busy}
              onClick={() => onSubmit(addType, opt)}
              className="rounded-full border border-border-default px-2.5 py-1 font-sans text-[12px] text-text-secondary hover:border-gold hover:text-text-primary disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (addText.trim()) onSubmit(addType, addText.trim());
          }}
        >
          <input
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder={
              addType === "topic"
                ? "A theme in your words, e.g. AI infrastructure capex"
                : addType === "ticker"
                  ? "Ticker symbol, e.g. NVDA"
                  : "Company name"
            }
            className="flex-1 rounded-md border border-border-default bg-transparent px-3 py-1.5 font-sans text-[13px] text-text-primary outline-none focus:border-gold"
          />
          <button
            type="submit"
            disabled={busy || !addText.trim()}
            className="rounded-md bg-espresso px-3 py-1.5 font-sans text-[13px] font-semibold text-cream disabled:opacity-50 dark:bg-overlay dark:text-foreground"
          >
            {busy ? "Adding…" : "Follow"}
          </button>
        </form>
      )}
      {error && (
        <p className="mt-2 font-sans text-[12px] text-signal-dn">{error}</p>
      )}
    </div>
  );
}

function FirstRun({
  onAdd,
  busy,
  error,
  unavailable,
}: {
  onAdd: (t: FollowSummary["follow_type"], target: string) => Promise<void>;
  busy: boolean;
  error: string | null;
  unavailable: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <div className="mx-auto max-w-[560px] py-10 text-center">
      <h2
        className="text-text-primary"
        style={{ fontFamily: SERIF, fontSize: "24px", fontWeight: 600 }}
      >
        Follow what you actually care about
      </h2>
      <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
        Radar watches the ingested news flow for the themes, companies, and
        corners of the market you name, and dispatches the developments here.
        Nothing is fetched on your behalf; you are reading the same corpus the
        briefs read, filtered to what you follow.
      </p>
      {unavailable && (
        <p className="mt-3 font-sans text-[12px] text-signal-warn">
          Follows storage is not set up yet (migration pending); adds will fail
          until it is applied.
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {STARTER_TOPICS.map((topic) => (
          <button
            key={topic}
            disabled={busy}
            onClick={() => void onAdd("topic", topic)}
            className="rounded-full border border-border-default px-3 py-1.5 font-sans text-[13px] text-text-secondary hover:border-gold hover:text-text-primary disabled:opacity-50"
          >
            {topic}
          </button>
        ))}
      </div>
      <form
        className="mx-auto mt-5 flex max-w-[420px] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void onAdd("topic", text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or a theme in your own words"
          className="flex-1 rounded-md border border-border-default bg-transparent px-3 py-2 font-sans text-[13px] text-text-primary outline-none focus:border-gold"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-md bg-espresso px-3.5 py-2 font-sans text-[13px] font-semibold text-cream disabled:opacity-50 dark:bg-overlay dark:text-foreground"
        >
          {busy ? "Adding…" : "Follow"}
        </button>
      </form>
      {error && <p className="mt-3 font-sans text-[12px] text-signal-dn">{error}</p>}
      <p className="mt-6 font-sans text-[12px] text-text-faint">
        Watchlist and Calls are ready when you are; the tabs above work even
        while this page is empty.
      </p>
    </div>
  );
}
