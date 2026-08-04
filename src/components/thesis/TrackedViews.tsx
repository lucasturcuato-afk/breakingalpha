"use client";

/**
 * TrackedViews — the thesis workspace folded into Calls as a demoted,
 * inline section. Deliberately QUIET: the primary Calls experience is
 * the user's graded calls; this section sits below them, default
 * collapsed, and never uses the hard Right/Wrong scored-object
 * language. Every state chip here is an evidence leaning
 * (verdictDisplayLabel: "Leaning supportive" / "Leaning against" /
 * "Inconclusive" / "Developing"), LLM-judged, never a graded verdict,
 * and the header says so.
 *
 * Detail expands IN PLACE: selecting a thesis opens the existing
 * ThesisDetailPanel (evidence feed, why-this-thesis, notes, generate
 * memo, archive) in a two-pane layout inside this section; the Review
 * Timeline (thesis_verdicts history) is a disclosure under the panel.
 * No route change, no teleport. The standalone /radar/theses page now
 * redirects here; deep links land via initialThesisId.
 *
 * Relocated, not removed: data flows are the thesis board's own
 * (/api/theses + neutralizeThesis, /api/user-thesis-states archive and
 * restore, per-thesis article fetch with sector fallback,
 * thesis_viewed / thesis_dismissed events). The board-only chrome
 * (kanban, stats row, system-intelligence panel, conviction filter
 * tabs) is intentionally not reproduced in this subordinate surface;
 * its APIs and tables are untouched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { ThesisList } from "@/components/thesis/ThesisList";
import { ThesisDetailPanel } from "@/components/thesis/thesis-detail-panel";
import type { ThesisItem } from "@/components/thesis";
import { mapThesisRow } from "@/lib/thesis-mapper";
import { neutralizeThesis, verdictDisplayLabel } from "@/lib/track-record-live-score";
import { trackClientEvent } from "@/lib/track-event";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface RelatedArticle {
  id: string;
  title: string;
  source?: string;
  ingested_at?: string;
  published_at?: string;
  summary?: string;
  sentiment?: string;
  sector?: string;
  url?: string;
}

interface UserThesisState {
  id: string;
  thesis_id: string;
  status: "active" | "archived" | "watching";
}

export interface VerdictRow {
  id: string;
  verdict: string;
  graded_at: string;
  confidence: number | null;
  notes: string | null;
  model_version: string | null;
}

function verdictDotColor(verdict: string): string {
  if (verdict === "confirmed") return "bg-signal-up";
  if (verdict === "invalidated") return "bg-signal-dn";
  return "bg-signal-warn";
}
function verdictTextColor(verdict: string): string {
  if (verdict === "confirmed") return "text-signal-up";
  if (verdict === "invalidated") return "text-signal-dn";
  return "text-signal-warn";
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

/** Review timeline: the thesis_verdicts history for one thesis. Same
 *  presentation as the Tracker detail page; leanings-neutral labels.
 *  Exported for the preview harness. */
export function ReviewTimeline({ verdicts }: { verdicts: VerdictRow[] | null }) {
  if (verdicts === null) {
    return <p className="font-sans text-[12px] text-text-faint">Loading review history…</p>;
  }
  if (verdicts.length === 0) {
    return (
      <p className="font-sans text-[12px] text-text-muted">
        No verdicts yet, awaiting first review.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {verdicts.map((v) => (
        <div key={v.id} className="relative border-l-2 border-border-base pl-5 pb-3 last:border-l-0">
          <div className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${verdictDotColor(v.verdict)}`} />
          <div className="mb-0.5 flex items-center gap-2">
            <span className={`font-sans text-[11px] font-semibold ${verdictTextColor(v.verdict)}`}>
              {verdictDisplayLabel(capitalize(v.verdict))}
            </span>
            <span className="font-sans text-[10px] text-text-muted">{formatDateTime(v.graded_at)}</span>
            {v.confidence !== null && (
              <span className="font-sans text-[10px] text-text-faint">
                conf: {Math.round(v.confidence * 100)}%
              </span>
            )}
          </div>
          {v.notes && (
            <p className="mt-0.5 font-sans text-[11.5px] leading-snug text-text-secondary">{v.notes}</p>
          )}
          {v.model_version && (
            <span className="font-sans text-[9px] text-text-faint">{v.model_version}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function TrackedViews({
  initialThesisId = null,
  initialOpen = false,
}: {
  /** Deep link (?thesis=): opens the section and selects this thesis. */
  initialThesisId?: string | null;
  /** ?views=open: opens the section without a specific selection. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(initialThesisId) || initialOpen);
  const [theses, setTheses] = useState<ThesisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialThesisId);
  const [relatedArticles, setRelatedArticles] = useState<Record<string, RelatedArticle[]>>({});
  const [userThesisStates, setUserThesisStates] = useState<UserThesisState[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [verdictsByThesis, setVerdictsByThesis] = useState<Record<string, VerdictRow[]>>({});
  const [leaningById, setLeaningById] = useState<Record<string, string | null>>({});
  const sectionRef = useRef<HTMLElement | null>(null);

  // live_verdict is not part of the canonical ThesisItem shape; fetch
  // the per-thesis leaning directly (same public read the old Calls
  // strip used) so rows can show their honest evidence leaning.
  const fetchLeanings = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from("theses").select("id, live_verdict");
      const map: Record<string, string | null> = {};
      for (const row of (data as { id: string; live_verdict: string | null }[] | null) ?? []) {
        map[row.id] = row.live_verdict;
      }
      setLeaningById(map);
    } catch {
      setLeaningById({});
    }
  }, []);

  const fetchTheses = useCallback(async () => {
    try {
      const res = await fetch("/api/theses");
      // A 500 whose body is {error: ...} used to fall through here: data.theses
      // was undefined, the guard below skipped silently, error stayed null, and
      // the surface rendered "No tracked views right now" -- reporting a failed
      // request as an empty workspace.
      if (!res.ok) throw new Error(`theses request failed: ${res.status}`);
      const data = await res.json();
      if (!data.theses || !Array.isArray(data.theses)) {
        throw new Error("theses response missing the theses array");
      }
      // Display-only neutralisation, same as the old board surface.
      setTheses(data.theses.map(mapThesisRow).map(neutralizeThesis));
    } catch (e) {
      console.error("Failed to fetch theses:", e);
      setError("Failed to load tracked views");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserThesisStates = useCallback(async () => {
    try {
      const res = await fetch("/api/user-thesis-states");
      const data = await res.json();
      if (data.states && Array.isArray(data.states)) {
        setUserThesisStates(data.states as UserThesisState[]);
      }
    } catch {
      setUserThesisStates([]);
    }
  }, []);

  // Load only once the section is opened; a closed disclosure costs nothing.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    void fetchTheses();
    void fetchUserThesisStates();
    void fetchLeanings();
  }, [open, fetchTheses, fetchUserThesisStates, fetchLeanings]);

  // Deep link: bring the section into view once it has content.
  useEffect(() => {
    if (!initialThesisId || loading) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const fetchArticlesForThesis = useCallback(
    async (thesis: ThesisItem) => {
      if (relatedArticles[thesis.id]) return;
      try {
        const supabase = getSupabase();
        const ids = thesis.supporting_article_ids;
        if (ids && ids.length > 0) {
          const { data } = await supabase
            .from("articles")
            .select("id, title, source, ingested_at, published_at, summary, sentiment, sector, url")
            .in("id", ids);
          if (data && data.length > 0) {
            setRelatedArticles((prev) => ({ ...prev, [thesis.id]: data }));
            return;
          }
        }
        const { data } = await supabase
          .from("articles")
          .select("id, title, source, ingested_at, published_at, summary, sentiment, sector, url")
          .eq("sector", thesis.sector)
          .order("ingested_at", { ascending: false })
          .limit(8);
        setRelatedArticles((prev) => ({ ...prev, [thesis.id]: data || [] }));
      } catch (e) {
        console.error("Failed to fetch articles for thesis:", e);
      }
    },
    [relatedArticles],
  );

  const fetchVerdicts = useCallback(
    async (thesisId: string) => {
      if (verdictsByThesis[thesisId]) return;
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("thesis_verdicts")
          .select("id, verdict, graded_at, confidence, notes, model_version")
          .eq("thesis_id", thesisId)
          .order("graded_at", { ascending: true });
        setVerdictsByThesis((prev) => ({ ...prev, [thesisId]: (data as VerdictRow[] | null) ?? [] }));
      } catch {
        setVerdictsByThesis((prev) => ({ ...prev, [thesisId]: [] }));
      }
    },
    [verdictsByThesis],
  );

  const userArchivedIds = useMemo(() => {
    const ids = new Set<string>();
    userThesisStates.forEach((s) => {
      if (s.status === "archived") ids.add(s.thesis_id);
    });
    return ids;
  }, [userThesisStates]);

  const activeTheses = useMemo(
    () => theses.filter((t) => !userArchivedIds.has(t.id)),
    [theses, userArchivedIds],
  );
  const archivedTheses = useMemo(
    () => theses.filter((t) => userArchivedIds.has(t.id)),
    [theses, userArchivedIds],
  );
  const displayTheses = showArchived ? archivedTheses : activeTheses;

  // Selection: honor the deep link, else first visible thesis.
  useEffect(() => {
    if (displayTheses.length === 0) return;
    const current = displayTheses.find((t) => t.id === selectedId) ?? theses.find((t) => t.id === selectedId);
    if (!current) {
      setSelectedId(displayTheses[0].id);
      void fetchArticlesForThesis(displayTheses[0]);
    } else {
      void fetchArticlesForThesis(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayTheses.length, selectedId]);

  const selected = theses.find((t) => t.id === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setTimelineOpen(false);
    const thesis = theses.find((t) => t.id === id);
    if (thesis) {
      void fetchArticlesForThesis(thesis);
      trackClientEvent("thesis_viewed", {
        thesis_id: thesis.id,
        sector: thesis.sector,
        conviction: thesis.conviction,
      });
    }
  };

  // The panel does the real POST to /api/user-thesis-states; this
  // callback handles optimistic UI + selection advance + the event.
  const handleArchive = (id: string) => {
    const thesis = theses.find((t) => t.id === id);
    setUserThesisStates((prev) => {
      const existing = prev.find((s) => s.thesis_id === id);
      if (existing) {
        return prev.map((s) => (s.thesis_id === id ? { ...s, status: "archived" as const } : s));
      }
      return [...prev, { id: `optimistic-${id}`, thesis_id: id, status: "archived" as const }];
    });
    const remaining = activeTheses.filter((t) => t.id !== id);
    setSelectedId(remaining[0]?.id ?? null);
    if (thesis) {
      trackClientEvent("thesis_dismissed", {
        thesis_id: id,
        sector: thesis.sector,
        new_status: "archived",
      });
    }
  };

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch("/api/user-thesis-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis_id: id, status: "active" }),
      });
      if (!res.ok) throw new Error("Failed to restore");
      setUserThesisStates((prev) =>
        prev.map((s) => (s.thesis_id === id ? { ...s, status: "active" as const } : s)),
      );
    } catch (e) {
      console.error("Failed to restore thesis:", e);
    }
  };

  const toggleTimeline = () => {
    setTimelineOpen((v) => {
      const next = !v;
      if (next && selectedId) void fetchVerdicts(selectedId);
      return next;
    });
  };

  const selectedLeaning = selected
    ? verdictDisplayLabel(leaningById[selected.id] ?? "Awaiting verdict")
    : null;

  return (
    <section ref={sectionRef} className="mt-8 scroll-mt-14 border-t border-border-subtle pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Tracked views
          <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">
            system theses · evidence leanings, LLM-judged · never graded verdicts
          </span>
        </span>
        <span className="font-sans text-[12px] text-text-faint">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="motion-rise-in mt-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-sans text-[12px] text-text-faint">
              Judged by evidence review, not benchmark attribution. A leaning is
              not a verdict; graded calls above are the record.{" "}
              <Link
                href="/radar/track-record"
                className="text-gold hover:text-gold-dark font-semibold whitespace-nowrap"
              >
                Full evidence tracker →
              </Link>
            </p>
            <div className="flex items-center gap-1 font-sans text-[11px]">
              {(
                [
                  [false, `Active · ${activeTheses.length}`],
                  [true, `Archived · ${archivedTheses.length}`],
                ] as [boolean, string][]
              ).map(([archived, label]) => (
                <button
                  key={label}
                  onClick={() => setShowArchived(archived)}
                  className={
                    "rounded-md px-2 py-0.5 " +
                    (showArchived === archived
                      ? "bg-overlay font-semibold text-text-primary"
                      : "text-text-faint hover:text-text-primary")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="rounded-lg border border-border-subtle bg-elevated px-4 py-4 font-sans text-[12px] text-text-faint">
              Loading tracked views…
            </p>
          ) : error ? (
            <p className="rounded-lg border border-border-subtle bg-elevated px-4 py-4 font-sans text-[12px] text-signal-warn">
              {error}
            </p>
          ) : displayTheses.length === 0 ? (
            <p className="rounded-lg border border-border-subtle bg-elevated px-4 py-4 font-sans text-[12px] text-text-muted">
              {showArchived
                ? "Nothing archived."
                : "No tracked views right now. System theses appear here as the pipeline generates them."}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-[1fr_1.6fr]" style={{ height: "540px" }}>
              <div className="min-h-0 overflow-y-auto">
                <ThesisList
                  theses={displayTheses}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  filter="all"
                  isArchiveView={showArchived}
                  onRestore={handleRestore}
                  leaningById={leaningById}
                />
              </div>
              <div className="flex min-h-0 flex-col gap-2">
                <div className="min-h-0 flex-1">
                  <ThesisDetailPanel
                    thesis={selected}
                    articles={selected ? (relatedArticles[selected.id] ?? []) : []}
                    onArchive={handleArchive}
                    activeSignalCount={activeTheses.length}
                  />
                </div>
                {selected && (
                  <div className="rounded-lg border border-border-subtle bg-elevated px-3.5 py-2.5">
                    <button
                      onClick={toggleTimeline}
                      className="flex w-full items-baseline justify-between gap-3 text-left"
                      aria-expanded={timelineOpen}
                    >
                      <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                        Review timeline
                        {selectedLeaning && (
                          <span className="ml-2 font-normal normal-case tracking-normal italic text-text-faint">
                            currently {selectedLeaning.toLowerCase()}
                          </span>
                        )}
                      </span>
                      <span className="font-sans text-[11px] text-text-faint">
                        {timelineOpen ? "Hide" : "Show"}
                      </span>
                    </button>
                    {timelineOpen && (
                      <div className="motion-rise-in mt-2 max-h-[220px] overflow-y-auto">
                        <ReviewTimeline verdicts={verdictsByThesis[selected.id] ?? null} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default TrackedViews;
