"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Search,
  Building2,
  Lock,
  Star,
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import { getSectorStyle } from "@/lib/sector-colors";
import { ThemeTags } from "@/components/company/ThemeTags";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { canonicalize, timeAgo } from "@/lib/company-intel";
import { zeroMatchTarget } from "@/lib/company-search-target";
import { useLiveMood } from "@/hooks/useLiveMood";

// Shape of /api/companies response items. Locally redeclared to avoid importing
// from a route file across the client boundary.
interface ApiCompany {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  mention_count: number;
  last_updated: string | null;
  key_themes: string[] | null;
  alias_count?: number;
}

// Row shape rendered in the directory table. We carry the raw API id so
// keyboard nav and the action menu can navigate to /company/[id].
interface CompanyRow {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  themes: string[];
  mentions: number;
  lastUpdated: string | null;
  aliasCount: number;
}

// Convert a display name to the URL slug expected by the [id] detail route.
// The detail route's slugToCompanyName does the inverse (replace hyphens with
// spaces, lowercase, look up in CANONICAL or title-case). Names with native
// hyphens roundtrip imperfectly; that limitation is shared with the existing
// detail route and is mitigated by the CANONICAL map.
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

// Map API rows to the rendered row shape, applying canonicalize() for display
// normalization and collapsing rows that canonicalize to the same display name
// (e.g. "Robinhood" + "Robinhood Markets Inc" -> one row).
function dedupeAndMapApiCompanies(rows: ApiCompany[]): CompanyRow[] {
  const map = new Map<string, CompanyRow>();
  for (const row of rows) {
    const display = canonicalize(row.name);
    const key = display.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.mentions += row.mention_count;
      // Sum alias counts across deduped rows. After W2-A backfill every
      // companies row has at least one alias, so an N-row dedup gives at
      // least N aliasCount, plus any organic typo / variant aliases on top.
      existing.aliasCount += row.alias_count ?? 0;
      // Backfill ticker / sector from a later row in the same cluster
      // when the seed lacks them. Real example: the "Google" row (mc=78,
      // ticker=NULL) outranks "Alphabet" (mc=47, ticker=GOOGL) in the
      // mention-ordered API response; without this, the displayed row
      // shows "--" for ticker even though the canonical Alphabet row
      // has GOOGL on file.
      if (!existing.ticker && row.ticker) existing.ticker = row.ticker;
      if (!existing.sector && row.sector) existing.sector = row.sector;
      // Preserve the highest-mention row's id and metadata; merge themes.
      if (row.key_themes) {
        for (const t of row.key_themes) {
          if (!existing.themes.includes(t)) existing.themes.push(t);
        }
      }
      if (row.last_updated && (!existing.lastUpdated || row.last_updated > existing.lastUpdated)) {
        existing.lastUpdated = row.last_updated;
      }
    } else {
      map.set(key, {
        id: row.id,
        name: display,
        ticker: row.ticker,
        sector: row.sector,
        themes: row.key_themes ?? [],
        mentions: row.mention_count,
        lastUpdated: row.last_updated,
        aliasCount: row.alias_count ?? 0,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.mentions - a.mentions);
}

const INDUSTRY_VERTICALS = [
  "Technology",
  "Healthcare & Biotech",
  "Energy & Oil/Gas",
  "Financial Services",
  "Consumer & Retail",
  "Industrials & Manufacturing",
  "Aerospace & Defense",
  "Real Estate",
  "Media & Telecom",
  "Materials & Mining",
  "Agriculture",
] as const;

// Explicit mapping from article sector strings (old and new taxonomy) to INDUSTRY_VERTICALS.
// Uses a deterministic lookup instead of fuzzy keyword matching to avoid false positives.
const SECTOR_TO_VERTICAL: Record<string, string> = {
  "Technology": "Technology",
  "Healthcare & Biotech": "Healthcare & Biotech",
  "Energy & Oil/Gas": "Energy & Oil/Gas",
  "Financial Services": "Financial Services",
  "Consumer & Retail": "Consumer & Retail",
  "Aerospace & Defense": "Aerospace & Defense",
  "Real Estate": "Real Estate",
  "Technology M&A & Investment Banking": "Technology",
  "Venture Capital & Startup Funding": "Financial Services",
  "Private Equity & Buyouts": "Financial Services",
  "Public Markets & Earnings": "Financial Services",
  "Fintech & Crypto": "Financial Services",
  "M&A & Investment Banking": "Financial Services",
  "Energy & Climate": "Energy & Oil/Gas",
  "Real Estate & Infrastructure": "Real Estate",
  "Real Estate & REITs": "Real Estate",
};

// Layer 1: ground-truth vertical for well-known companies. Keyed by lowercase display name.
const COMPANY_VERTICAL_OVERRIDES: Record<string, string> = {
  "anthropic": "Technology",
  "anthropic pbc": "Technology",
  "openai": "Technology",
  "xai": "Technology",
  "coreweave": "Technology",
  "alphabet": "Technology",
  "google": "Technology",
  "microsoft": "Technology",
  "apple": "Technology",
  "amazon": "Technology",
  "meta": "Technology",
  "nvidia": "Technology",
  "intel": "Technology",
  "samsung": "Technology",
  "ibm": "Technology",
  "broadcom": "Technology",
  "arm": "Technology",
  "arm holdings": "Technology",
  "tesla": "Technology",
  "uber": "Technology",
  "palantir": "Technology",
  "palantir technologies": "Technology",
  "roblox": "Technology",
  "sifive": "Technology",
  "polymarket": "Technology",
  "tcs": "Technology",
  "tata consultancy services": "Technology",
  "spacex": "Aerospace & Defense",
  "lockheed martin": "Aerospace & Defense",
  "boeing": "Aerospace & Defense",
  "northrop grumman": "Aerospace & Defense",
  "nasa": "Aerospace & Defense",
  "blackstone": "Financial Services",
  "blackstone group": "Financial Services",
  "goldman sachs": "Financial Services",
  "tpg": "Financial Services",
  "federal reserve": "Financial Services",
  "federal reserve board": "Financial Services",
  "jpmorgan": "Financial Services",
  "jpmorgan chase": "Financial Services",
  "morgan stanley": "Financial Services",
  "bank of america": "Financial Services",
  "citigroup": "Financial Services",
  "nordea bank": "Financial Services",
  "nordea bank abp": "Financial Services",
  "cango": "Financial Services",
  "cango inc": "Financial Services",
  "kreditbee": "Financial Services",
  "bloomberg": "Media & Telecom",
  "techcrunch": "Media & Telecom",
  "paramount": "Media & Telecom",
  "warner bros": "Media & Telecom",
  "warner brothers": "Media & Telecom",
  "comcast": "Media & Telecom",
  "disney": "Media & Telecom",
  "delta": "Industrials & Manufacturing",
  "volkswagen": "Industrials & Manufacturing",
  "ford": "Industrials & Manufacturing",
  "general motors": "Industrials & Manufacturing",
  "exxonmobil": "Energy & Oil/Gas",
  "chevron": "Energy & Oil/Gas",
  "bp": "Energy & Oil/Gas",
  "shell": "Energy & Oil/Gas",
  "hologic": "Healthcare & Biotech",
  "hologic inc": "Healthcare & Biotech",
  "pfizer": "Healthcare & Biotech",
  "johnson & johnson": "Healthcare & Biotech",
  "unitedhealth": "Healthcare & Biotech",
  "peloton": "Consumer & Retail",
  "slice": "Consumer & Retail",
  "nike": "Consumer & Retail",
  "walmart": "Consumer & Retail",
};

type SortKey = "name" | "ticker" | "sector" | "mentions" | "lastUpdated";
type SortDir = "asc" | "desc";

const SIGNED_OUT_VISIBLE_ROWS = 6;
const SKELETON_ROW_COUNT = 28;

export default function CompanyIntelPage() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([]);
  const [verticalMatchMode, setVerticalMatchMode] = useState<"any" | "all">("any");
  const [isSignedOut, setIsSignedOut] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("mentions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  // Watchlist state. Keyed by lowercase identifier; value is the watchlist row id
  // (needed for DELETE). Populated on mount via GET /api/watchlist when signed in.
  const [watchlist, setWatchlist] = useState<Map<string, string>>(new Map());


  // Refs for keyboard nav: keep latest closures without re-binding the listener.
  const rowsRef = useRef<CompanyRow[]>([]);
  const highlightedRef = useRef(0);
  // Per-row DOM refs keyed by row.id. Used by the scrollIntoView effect to
  // bring the highlighted row into view when j/k navigates off-screen.
  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map());

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsSignedOut(user === null);
    }).catch(() => setIsSignedOut(true));
  }, []);

  // Load the user's watchlist once on mount (signed-in only). Map keyed by
  // lowercase identifier so the per-row star toggle can detect membership in O(1).
  useEffect(() => {
    if (isSignedOut) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        if (!res.ok) return;
        const json = (await res.json()) as {
          entries?: Array<{ id: string; identifier: string; type: string }>;
        };
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const e of json.entries ?? []) {
          if (e.type === "company") next.set(e.identifier.toLowerCase(), e.id);
        }
        setWatchlist(next);
      } catch {
        // soft-fail: directory still renders without watchlist data
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedOut]);

  // Debounce the raw search input by 200ms. Two effects below depend on
  // debouncedSearch (full load when < 2 chars; server query when >= 2).
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handle);
  }, [search]);

  // Top-N load: runs on mount and whenever debouncedSearch transitions back to < 2 chars.
  useEffect(() => {
    if (debouncedSearch.trim().length >= 2) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/companies?limit=500");
        const json = (await res.json()) as { companies?: ApiCompany[]; error?: string };
        if (!cancelled) setCompanies(dedupeAndMapApiCompanies(json.companies ?? []));
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to load companies:", e);
          setCompanies([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  // Server-side search when query >= 2 chars. The 200ms debounce above already
  // throttles network calls; this effect just maps debouncedSearch -> fetch.
  useEffect(() => {
    const trimmed = debouncedSearch.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/companies?q=${encodeURIComponent(trimmed)}&limit=50`);
        const json = (await res.json()) as { companies?: ApiCompany[]; error?: string };
        if (!cancelled) setCompanies(dedupeAndMapApiCompanies(json.companies ?? []));
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to search companies:", e);
          setCompanies([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  // Vertical filter (chips). Two-layer mapping: ground-truth overrides for
  // well-known companies, sector-derived fallback for the long tail.
  const verticalFiltered = useMemo(() => {
    if (selectedVerticals.length === 0) return companies;
    return companies.filter((c) => {
      const nameLower = c.name.toLowerCase();
      const override = COMPANY_VERTICAL_OVERRIDES[nameLower];
      const effective: Set<string> = override
        ? new Set([override])
        : new Set(
            (c.sector ? [c.sector] : [])
              .map((s) => SECTOR_TO_VERTICAL[s])
              .filter((v): v is string => Boolean(v)),
          );
      return verticalMatchMode === "all"
        ? selectedVerticals.every((v) => effective.has(v))
        : selectedVerticals.some((v) => effective.has(v));
    });
  }, [companies, selectedVerticals, verticalMatchMode]);

  // Client-side sort. Default mention_count desc; clicking a header toggles asc/desc.
  const sortedRows = useMemo(() => {
    const arr = [...verticalFiltered];
    arr.sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "name":
          av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case "ticker":
          av = (a.ticker ?? "").toLowerCase(); bv = (b.ticker ?? "").toLowerCase(); break;
        case "sector":
          av = (a.sector ?? "").toLowerCase(); bv = (b.sector ?? "").toLowerCase(); break;
        case "lastUpdated":
          av = a.lastUpdated ?? ""; bv = b.lastUpdated ?? ""; break;
        case "mentions":
        default:
          av = a.mentions; bv = b.mentions; break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [verticalFiltered, sortKey, sortDir]);

  // Final visible rows. For signed-out users the table still renders all rows,
  // but rows past SIGNED_OUT_VISIBLE_ROWS are visually locked (overlay below).
  const visibleRows = sortedRows;

  // Keep refs in sync so the keydown handler always sees the latest data
  // without re-binding (prevents listener thrash on every keystroke).
  useEffect(() => { rowsRef.current = visibleRows; }, [visibleRows]);
  useEffect(() => { highlightedRef.current = highlightedIndex; }, [highlightedIndex]);

  // Reset highlighted row when the filtered set changes (search, sector toggle, sort).
  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedSearch, selectedVerticals, verticalMatchMode, sortKey, sortDir]);

  // Watchlist toggle with optimistic update. Looks up the current row in the
  // watchlist map by lowercased name; POST to add, DELETE to remove.
  const toggleWatchlist = useCallback(async (row: CompanyRow) => {
    if (isSignedOut) { setShowSignIn(true); return; }
    if (!row) return;
    const key = row.name.toLowerCase();
    const existingId = watchlist.get(key);
    // Race guard: ignore re-clicks while a previous toggle is still in flight.
    // Without this, a fast second click sees existingId="__pending__", falls
    // through to the else branch (POST again), backend duplicate-check returns
    // 400, rollback restores "__pending__", then the original POST resolution
    // overwrites it with the real id, leaving the row in the watchlist with no
    // visible removal. Standard async-toggle bug.
    if (existingId === "__pending__") return;
    // Optimistic update
    setWatchlist((prev) => {
      const next = new Map(prev);
      if (existingId) next.delete(key);
      else next.set(key, "__pending__");
      return next;
    });
    try {
      if (existingId && existingId !== "__pending__") {
        const res = await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: existingId }),
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      } else {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: row.name,
            type: "company",
            display_name: row.name,
          }),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const json = (await res.json()) as { entry?: { id: string } };
        if (json.entry?.id) {
          setWatchlist((prev) => {
            const next = new Map(prev);
            next.set(key, json.entry!.id);
            return next;
          });
        }
      }
    } catch (e) {
      console.error("Watchlist toggle failed:", e);
      // Rollback
      setWatchlist((prev) => {
        const next = new Map(prev);
        if (existingId) next.set(key, existingId);
        else next.delete(key);
        return next;
      });
    }
  }, [isSignedOut, watchlist]);

  // Keep the latest toggleWatchlist reachable from the keydown handler without
  // re-binding the global listener every render.
  const toggleWatchlistRef = useRef(toggleWatchlist);
  useEffect(() => { toggleWatchlistRef.current = toggleWatchlist; }, [toggleWatchlist]);

  // Keyboard nav scoped to the directory: j / k navigate, w toggles watchlist,
  // Enter opens the detail page. Bails when focus is inside an input or
  // textarea so the search input still accepts those characters.
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Skip-link-aware: don't intercept keys when focus is on an in-page anchor.
      if (document.activeElement?.matches('a[href^="#"]')) return;
      const rows = rowsRef.current;
      if (rows.length === 0) return;
      const i = highlightedRef.current;
      if (e.key === "j") {
        e.preventDefault();
        setHighlightedIndex((cur) => Math.min(cur + 1, rows.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setHighlightedIndex((cur) => Math.max(cur - 1, 0));
      } else if (e.key === "w") {
        e.preventDefault();
        const target = rows[i];
        if (target) toggleWatchlistRef.current(target);
      } else if (e.key === "Enter") {
        const target = rows[i];
        if (target) router.push(`/company/${encodeURIComponent(slugify(target.name))}`);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setHighlightedIndex(-1);
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [router]);

  // Auto-scroll the highlighted row into view when j/k pushes it off-screen.
  // block: "nearest" only scrolls when the row is actually outside the viewport,
  // avoiding gratuitous scroll on already-visible rows. behavior: "auto" (not
  // smooth) is intentional -- rapid j-mash with smooth animation feels laggy.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    const row = rowsRef.current[highlightedIndex];
    if (!row) return;
    const el = rowRefs.current.get(row.id);
    el?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [highlightedIndex]);

  const onHeaderClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "ticker" || key === "sector" ? "asc" : "desc");
    }
  };

  const resetFilters = () => {
    setSearch("");
    setSelectedVerticals([]);
    setVerticalMatchMode("any");
  };

  const lockCutoff = isSignedOut ? SIGNED_OUT_VISIBLE_ROWS : visibleRows.length;

  return (
    <AppShell pageTitle="Company Intel" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      <div className="h-[calc(100vh-var(--topbar-height)-var(--moodbar-height))] overflow-y-auto p-6">
        <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
          Company Intel
        </h2>
        <p className="font-sans text-[13px] text-text-secondary mb-5">
          Companies in your news feed. Click any row to open the detail page.
        </p>

        {/* Preview nudge banner */}
        {isSignedOut && (
          <div className="mb-5 px-4 py-3 rounded-xl border border-gold/20 flex items-center justify-between" style={{ backgroundColor: "var(--gold-muted)" }}>
            <p className="font-sans text-[12px] text-text-secondary">
              Previewing company intelligence. Sign in to search, filter, and track companies.
            </p>
            <button
              type="button"
              onClick={() => setShowSignIn(true)}
              className="flex-shrink-0 ml-4 font-sans text-[12px] font-semibold cursor-pointer"
              style={{ color: "var(--espresso)" }}
            >
              Sign in free
            </button>
          </div>
        )}

        {/* Search */}
        {isSignedOut ? (
          <div className="relative mb-4 flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border-base bg-parchment-mid">
            <Lock size={13} className="text-text-faint" />
            <span className="font-sans text-[12px] text-text-faint">Search available after sign in</span>
          </div>
        ) : (
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const q = search.trim();
                if (!q) return;
                // Matched-row behavior preserved: open the highlighted/top match.
                const rows = rowsRef.current;
                if (rows.length > 0) {
                  const i = highlightedRef.current;
                  const target = rows[i >= 0 ? i : 0];
                  if (target) router.push(`/company/${encodeURIComponent(slugify(target.name))}`);
                  return;
                }
                /* Zero matches. The rule is in
                   `src/lib/company-search-target.ts` with its measurements: a
                   query that matched nothing only gets a navigation when
                   `/company/<query>` can terminate on a company, either
                   because the resolve retry's ticker push is one the route can
                   look up, or because CANONICAL points at a name this search
                   never ran. It lives in a module because the version that
                   lived here could only be tested by retyping it. */
                const target = zeroMatchTarget(q);
                if (target) router.push(target);
              }}
              placeholder="Search companies by name or ticker..."
              className="pl-9 font-sans"
            />
          </div>
        )}

        {/* Industry vertical filter chips + Match Any/All toggle */}
        {isSignedOut ? (
          <div className="mb-5 flex items-center gap-1.5">
            <Lock size={12} className="text-text-faint" />
            <span className="font-sans text-[12px] text-text-faint">Sector filters available after sign in</span>
          </div>
        ) : (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="font-sans text-[10px] text-text-muted">Sector</p>
              <button
                type="button"
                onClick={() => setVerticalMatchMode((m) => (m === "any" ? "all" : "any"))}
                className="font-sans text-[10px] px-2 py-0.5 rounded-full border border-gold-border bg-gold-muted text-gold-dark cursor-pointer"
                title="Toggle Match Any / Match All"
              >
                Match {verticalMatchMode}
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {INDUSTRY_VERTICALS.map((v) => {
                const isActive = selectedVerticals.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() =>
                      setSelectedVerticals((prev) =>
                        prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                      )
                    }
                    className={cn(
                      "px-3 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border",
                      isActive
                        ? "border-gold bg-gold-muted text-gold"
                        : "border-border-base bg-white text-text-muted hover:text-text-primary",
                    )}
                  >
                    {v}
                  </button>
                );
              })}
              {selectedVerticals.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedVerticals([]); setVerticalMatchMode("any"); }}
                  className="px-3 py-1 font-sans text-[10px] text-text-muted hover:text-text-primary cursor-pointer transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Directory table */}
        {loading ? (
          <DirectoryTableSkeleton />
        ) : visibleRows.length === 0 ? (
          <div>
            <EmptyState
              icon={<Building2 size={32} />}
              title={search.trim() || selectedVerticals.length > 0 ? "No companies match your filters" : "No companies indexed yet"}
              description={search.trim() || selectedVerticals.length > 0 ? "Try a different search term or clear sector filters." : "Check back after the next update."}
              action={(search.trim() || selectedVerticals.length > 0) ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-3 py-1.5 rounded-lg border border-border-base bg-white font-sans text-[10px] font-bold text-text-muted hover:text-text-primary cursor-pointer"
                >
                  Reset filters
                </button>
              ) : undefined}
            />
          </div>
        ) : (
          <div className="relative bg-white border border-border-base rounded-xl overflow-x-auto">
            <table className="w-full table-fixed text-left border-collapse min-w-[900px]">
              <thead className="bg-parchment-mid border-b border-border-base">
                <tr className="font-sans text-[10px] text-text-muted dark:text-text-secondary">
                  <th className="w-8 px-2 py-2"></th>
                  <SortHeader label="Ticker" k="ticker" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} className="w-20 px-2 py-2" />
                  <SortHeader label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} className="px-2 py-2 min-w-[200px]" />
                  <SortHeader label="Sector" k="sector" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} className="px-2 py-2" />
                  <th className="px-2 py-2">Themes</th>
                  <SortHeader label="Mentions" k="mentions" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} className="px-2 py-2" />
                  <SortHeader label="Last seen" k="lastUpdated" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} className="px-2 py-2" />
                  <th className="w-10 px-2 py-2 text-center">Aliases</th>
                  <th className="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, idx) => {
                  const isLocked = isSignedOut && idx >= SIGNED_OUT_VISIBLE_ROWS;
                  const isHighlighted = idx === highlightedIndex;
                  const isWatched = watchlist.has(row.name.toLowerCase());
                  return (
                    <tr
                      key={row.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(row.id, el);
                        else rowRefs.current.delete(row.id);
                      }}
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => {
                        if (isLocked) { setShowSignIn(true); return; }
                        router.push(`/company/${encodeURIComponent(slugify(row.name))}`);
                      }}
                      className={cn(
                        "border-b border-border-base/60 last:border-b-0 cursor-pointer transition-colors",
                        isHighlighted ? "bg-gold-muted/40 border-l-2 border-l-gold" : "border-l-2 border-l-transparent",
                        !isHighlighted && "hover:bg-parchment-mid",
                        isLocked && "pointer-events-none",
                      )}
                    >
                      {/* Watchlist star */}
                      <td className="w-8 px-2 py-2" onClick={(e) => { e.stopPropagation(); if (!isLocked) toggleWatchlist(row); }}>
                        <button
                          type="button"
                          tabIndex={-1}
                          className={cn(
                            "p-1 rounded cursor-pointer transition-colors",
                            isWatched ? "text-gold" : "text-text-faint hover:text-gold",
                          )}
                          aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                        >
                          <Star size={13} fill={isWatched ? "currentColor" : "none"} />
                        </button>
                      </td>
                      {/* Ticker */}
                      <td className="w-20 px-2 py-2 font-sans text-[11px] font-bold text-espresso">
                        {row.ticker ?? <span className="text-text-faint">--</span>}
                      </td>
                      {/* Name */}
                      <td className="px-2 py-2 min-w-0">
                        <span className="font-display text-[13px] font-bold text-espresso truncate block">
                          {row.name}
                        </span>
                      </td>
                      {/* Sector chip */}
                      <td className="px-2 py-2">
                        {row.sector ? (
                          <span
                            style={getSectorStyle(row.sector)}
                            className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                          >
                            {row.sector}
                          </span>
                        ) : (
                          <span className="font-sans text-[10px] text-text-faint">--</span>
                        )}
                      </td>
                      {/* Themes: width-measured cluster -- whole tags that fit,
                          remainder collapses into "+N". See ThemeTags. */}
                      <td className="px-2 py-2 overflow-hidden">
                        <ThemeTags themes={row.themes} />
                      </td>
                      {/* Mentions */}
                      <td className="px-2 py-2">
                        <span className="font-data text-[10px] text-gold bg-gold-muted border border-gold-border px-1.5 py-0.5 rounded-md">
                          {row.mentions}x
                        </span>
                      </td>
                      {/* Last seen */}
                      <td className="px-2 py-2 font-sans text-[10px] text-text-muted whitespace-nowrap">
                        {row.lastUpdated ? timeAgo(row.lastUpdated) : <span className="text-text-faint">--</span>}
                      </td>
                      {/* Alias count: distinct surface forms collapsed onto this canonical (per W2-A read-path PR #195) */}
                      <td className="w-10 px-2 py-2 text-center">
                        <span className="font-sans text-[10px] text-gold/60">{row.aliasCount}</span>
                      </td>
                      {/* Action menu */}
                      <td className="w-8 px-2 py-2 text-center" onClick={(e) => { e.stopPropagation(); if (!isLocked) router.push(`/company/${encodeURIComponent(slugify(row.name))}`); }}>
                        <button
                          type="button"
                          tabIndex={-1}
                          className="p-1 rounded text-text-faint hover:text-text-primary cursor-pointer"
                          aria-label="Open detail page"
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Sign-in lock overlay past row 6 (signed-out users only). */}
            {isSignedOut && visibleRows.length > lockCutoff && (
              <>
                <div
                  className="pointer-events-none absolute left-0 right-0 bottom-12 h-24"
                  style={{ background: "linear-gradient(to bottom, transparent, var(--cream))" }}
                />
                <div
                  className="absolute left-0 right-0 bottom-0 flex items-center justify-between px-4 py-3 border-t"
                  style={{ borderColor: "rgba(201,146,42,0.3)", backgroundColor: "var(--gold-muted)" }}
                >
                  <div className="flex items-center gap-2">
                    <Lock size={14} style={{ color: "var(--gold)" }} />
                    <span className="font-sans text-[13px] font-semibold text-espresso">
                      Sign in to see all {visibleRows.length} companies
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSignIn(true)}
                    className="font-sans text-[12px] font-semibold cursor-pointer"
                    style={{ color: "var(--gold)" }}
                  >
                    Sign in
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Keyboard hint */}
        {!isSignedOut && !loading && visibleRows.length > 0 && (
          <p className="mt-3 font-sans text-[10px] text-text-faint">
            j / k navigate &middot; w toggle watchlist &middot; Enter open &middot; Esc clear
          </p>
        )}
      </div>

      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        headline="Sign in to unlock Company Intel"
        message="Create a free account to search, filter, track watchlists, and generate company memos."
      />
    </AppShell>
  );
}

// --- Helpers ---------------------------------------------------------------

interface SortHeaderProps {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
}

function SortHeader({ label, k, sortKey, sortDir, onClick, className }: SortHeaderProps) {
  const isActive = sortKey === k;
  return (
    <th className={cn("cursor-pointer select-none", className)} onClick={() => onClick(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      </span>
    </th>
  );
}

function DirectoryTableSkeleton() {
  return (
    <div className="bg-white border border-border-base rounded-xl overflow-hidden">
      <div className="bg-parchment-mid border-b border-border-base px-3 py-2">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="divide-y divide-border-base/60">
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 flex-1 max-w-[200px]" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}
