"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { onRadarLanded } from "@/lib/radar-landed";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createBrowserClientAsync } from "@/lib/supabase-browser";
import dynamic from "next/dynamic";
import {
  LayoutGrid,
  Clock,
  Globe,
  AlignLeft,
  FileText,
  Briefcase,
  Search,
  TrendingUp,
  Star,
  Radar as RadarIcon,
  LineChart,
  Sparkles,
  Settings,
  LogOut,
  Bell,
  X,
  Pencil,
  Check,
} from "lucide-react";
import { Wordmark } from "@/components/ui/wordmark";
import { UserAvatar } from "./user-avatar";
import type { User } from "@supabase/supabase-js";

/**
 * The reorder/hide panel is loaded on demand, not with the shell.
 *
 * It renders only when `customizeMode` is true. That starts false and only
 * flips on a click of the pencil control, which itself renders only at `lg`
 * and only for a signed-in reader. Its `@dnd-kit` dependency was therefore
 * shipping in the AppShell entry chunk that every shell route loads, at every
 * width, on every cold load, for a panel that is behind a click. `ssr: false`
 * because there is nothing to server-render: the branch is closed on first
 * paint, so the initial HTML is byte-identical to before at every width.
 */
const SidebarCustomize = dynamic(
  () => import("./sidebar-customize").then((m) => m.SidebarCustomize),
  { ssr: false },
);

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  liveDot?: boolean;
  kind: "main" | "research";
}

// Canonical sections — order here is the default. Keys (id) are stable
// identifiers persisted to user_profiles.sidebar_section_order.
const DEFAULT_SECTIONS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: <LayoutGrid size={16} />, kind: "main" },
  { id: "morning-brief", label: "Morning Brief", href: "/morning-brief", icon: <Clock size={16} />, liveDot: true, kind: "main" },
  { id: "evening-wrap", label: "Evening Wrap", href: "/evening-wrap", icon: <Globe size={16} />, kind: "main" },
  { id: "live-feed", label: "Live Feed", href: "/live-feed", icon: <AlignLeft size={16} />, kind: "main" },
  { id: "radar", label: "Radar", href: "/radar", icon: <RadarIcon size={16} />, kind: "research" },
  { id: "deal-flow", label: "Deal Flow", href: "/deal-flow", icon: <Briefcase size={16} />, kind: "research" },
  { id: "company", label: "Company Intel", href: "/company", icon: <Search size={16} />, kind: "research" },
  { id: "trends", label: "Trends", href: "/trends", icon: <TrendingUp size={16} />, kind: "research" },
  { id: "intelligence", label: "Intelligence", href: "/intelligence", icon: <Sparkles size={16} />, kind: "research" },
];

const DEFAULT_ORDER: string[] = DEFAULT_SECTIONS.map((s) => s.id);

interface SectionPrefs {
  order: string[];
  hidden: string[];
}

function isValidPrefs(x: unknown): x is SectionPrefs {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return (
    Array.isArray(v.order) &&
    v.order.every((o) => typeof o === "string") &&
    Array.isArray(v.hidden) &&
    v.hidden.every((h) => typeof h === "string")
  );
}

interface Notification {
  id: string;
  identifier: string;
  type: string;
  title: string;
  body?: string | null;
  read: boolean;
  created_at: string;
}

// Mirrors the dedupe applied on the /watchlist page (page.tsx) so the
// sidebar badge matches the page's "TRACKING" count even when the
// underlying watchlist table contains duplicate rows for the same
// identifier+type pair (cleanup of those rows is tracked separately).
function dedupeWatchlistCount(rows: Array<{ identifier: string | null; type: string | null }>): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.identifier || !r.type) continue;
    seen.add(`${r.identifier.toUpperCase()}::${r.type}`);
  }
  return seen.size;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface SidebarProps {
  unreadCount?: number;
}

export function Sidebar({ unreadCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<
    | { id: string; name: string; email: string; role: string }
    | null
    | undefined
  >(undefined);
  // Raw Supabase auth user, threaded into <UserAvatar /> so the sidebar
  // and the topbar both render from the same auth record (no race between
  // two independent `getUser()` fetches).
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifLoaded, setNotifLoaded] = useState(false);

  const [customizeMode, setCustomizeMode] = useState(false);
  const [prefs, setPrefs] = useState<SectionPrefs>({ order: DEFAULT_ORDER, hidden: [] });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const unreadBadge = unreadNotifCount > 9 ? "9+" : unreadNotifCount > 0 ? String(unreadNotifCount) : null;

  // Async now: the Supabase package is imported on demand rather than sitting
  // in this route's entry chunk. Every consumer below already ran inside an
  // effect and already rendered a loading state until the client answered, so
  // awaiting one more promise changes the timing and nothing else.
  const getSupabase = useCallback(() => createBrowserClientAsync(), []);

  // ── Auth + initial loads ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    getSupabase().then((supabase) => {
      if (cancelled) return;
      supabase.auth.getUser().then(({ data: { user: authUser } }) => {
        if (cancelled) return;
        if (!authUser) {
          setUser(null);
          setAuthUser(null);
          return;
        }
        setAuthUser(authUser);
        setUser({
          id: authUser.id,
          name: authUser.user_metadata?.full_name || authUser.email?.split("@")[0] || "User",
          email: authUser.email || "",
          role: authUser.user_metadata?.role || "Analyst",
        });
        supabase
          .from("watchlist")
          .select("identifier, type")
          .eq("user_id", authUser.id)
          .then(({ data }) => {
            if (data && !cancelled) setWatchlistCount(dedupeWatchlistCount(data));
          });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [getSupabase]);

  // Realtime subscription for watchlist count badge. Also listens for a
  // window-level "watchlist:changed" event as a fallback so client-driven
  // mutations (e.g. company detail page toggle) can request an immediate
  // refetch when realtime delivery is delayed or muted.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    let cancelled = false;
    // Held so cleanup can tear down whatever the async body managed to set up,
    // whether it ran before or after the effect was torn down.
    let teardown: (() => void) | undefined;
    getSupabase().then((supabase) => {
      if (cancelled) return;
      const refetch = () => {
        supabase
          .from("watchlist")
          .select("identifier, type")
          .eq("user_id", userId)
          .then(({ data }) => {
            if (data && !cancelled) setWatchlistCount(dedupeWatchlistCount(data));
          });
      };
      const channel = supabase
        .channel(`watchlist-count-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "watchlist", filter: `user_id=eq.${userId}` },
          refetch,
        )
        .subscribe();

      window.addEventListener("watchlist:changed", refetch);
      teardown = () => {
        window.removeEventListener("watchlist:changed", refetch);
        supabase.removeChannel(channel);
      };
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [user?.id, getSupabase]);

  // Load saved section order/visibility
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      // No user yet (or signed out) — defer marking loaded to avoid a
      // cascading render inside the effect body.
      queueMicrotask(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
      return () => {
        cancelled = true;
      };
    }
    const userId = user.id;
    getSupabase().then((supabase) => {
      if (cancelled) return;
      supabase
      .from("user_profiles")
      .select("sidebar_section_order")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setPrefsLoaded(true);
          return;
        }
        const raw = (data as { sidebar_section_order?: unknown } | null)?.sidebar_section_order;
        if (isValidPrefs(raw)) {
          // Radar replaced three sections; remap saved ids so user order survives.
          const LEGACY_TO_RADAR = new Set(["thesis-board", "track-record", "watchlist"]);
          const remap = (ids: string[]) => {
            const out: string[] = [];
            for (const o of ids) {
              const mapped = LEGACY_TO_RADAR.has(o) ? "radar" : o;
              if (!out.includes(mapped)) out.push(mapped);
            }
            return out;
          };
          const known = new Set(DEFAULT_ORDER);
          const filteredOrder = remap(raw.order).filter((o) => known.has(o));
          const missing = DEFAULT_ORDER.filter((o) => !filteredOrder.includes(o));
          const filteredHidden = remap(raw.hidden).filter((h) => known.has(h));
          setPrefs({ order: [...filteredOrder, ...missing], hidden: filteredHidden });
        }
        setPrefsLoaded(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, getSupabase]);

  // Debounced persist on prefs change. 500ms debounce per spec.
  useEffect(() => {
    if (!user?.id || !prefsLoaded) return;
    // Skip if prefs haven't been touched (stay null on the DB side)
    const isDefault =
      prefs.hidden.length === 0 &&
      prefs.order.length === DEFAULT_ORDER.length &&
      prefs.order.every((id, i) => id === DEFAULT_ORDER[i]);

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const userId = user.id;
    persistTimerRef.current = setTimeout(() => {
      const payload = isDefault ? null : prefs;
      getSupabase().then((supabase) => {
        supabase
          .from("user_profiles")
          .update({ sidebar_section_order: payload, updated_at: new Date().toISOString() })
          .eq("id", userId)
          .then(({ error }) => {
            if (error) {
              console.warn("[sidebar] section order persist failed:", error.message);
            }
          });
      });
    }, 500);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [prefs, user?.id, prefsLoaded, getSupabase]);

  // ── Notifications (drawer variant — preserved from v4a) ────────────────
  useEffect(() => {
    if (!user) return; // undefined (loading) or null (signed out) — skip
    fetch("/api/watchlist-notifications")
      .then((r) => r.ok ? r.json() : { notifications: [] })
      .then((d) => {
        setNotifications(d.notifications ?? []);
        setNotifLoaded(true);
      })
      .catch(() => setNotifLoaded(true));
  }, [user?.id]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read: true } : n)
    );
    fetch("/api/watchlist-notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    fetch("/api/watchlist-notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unreadIds }),
    }).catch(() => {});
  }, [notifications]);

  // ── Derived nav ─────────────────────────────────────────────────────────
  const sectionsById = useMemo(() => {
    const map = new Map<string, NavItem>();
    for (const s of DEFAULT_SECTIONS) map.set(s.id, s);
    return map;
  }, []);

  const orderedSections = useMemo(
    () =>
      prefs.order
        .map((id) => sectionsById.get(id))
        .filter((s): s is NavItem => !!s),
    [prefs.order, sectionsById],
  );

  const visibleSections = useMemo(
    () => orderedSections.filter((s) => !prefs.hidden.includes(s.id)),
    [orderedSections, prefs.hidden],
  );

  // The panel resolves the drag itself and hands back the reordered ids, so
  // no `@dnd-kit` symbol (not even `arrayMove`) is imported here. Importing
  // one would pull the whole package back into the shell chunk.
  const handleReorder = useCallback((_activeId: string, _overId: string, nextOrder: string[]) => {
    setPrefs((prev) => ({ ...prev, order: nextOrder }));
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setPrefs((prev) => {
      const hidden = prev.hidden.includes(id)
        ? prev.hidden.filter((h) => h !== id)
        : [...prev.hidden, id];
      return { ...prev, hidden };
    });
  }, []);

  const resetSections = useCallback(() => {
    setPrefs({ order: DEFAULT_ORDER, hidden: [] });
  }, []);

  const userName = user?.name || "User";
  const userRole = user?.role || "";

  // Render groupings — preserves "Main" / "Research" labels for non-customize mode.
  const mainItems = visibleSections.filter((s) => s.kind === "main");
  const researchItems = visibleSections.filter((s) => s.kind === "research");

  return (
    <>
      <aside className="fixed left-0 top-0 bottom-0 w-[64px] lg:w-[var(--sidebar-width)] bg-sidebar-bg border-r border-border-base flex flex-col z-40">
        {/* Logo area: full wordmark at lg+, hidden at icon-only width to avoid clipping */}
        <div className="border-b border-border-base px-4 py-4 hidden lg:flex items-center justify-center">
          <Wordmark size="lg" />
        </div>
        {/* Icon-only spacer to keep vertical rhythm at tablet */}
        <div className="lg:hidden h-[57px] border-b border-border-base" />

        {/* Nav body. Tighter padding at icon-only width so 16px icons clear gracefully. */}
        <nav className="flex-1 overflow-y-auto px-2 lg:px-3 py-3.5 space-y-5">
          {!!user && (
            <div className="hidden lg:flex items-center justify-between px-3">
              <span className="font-sans text-[11px] font-semibold text-text-faint">
                {customizeMode ? "Customise sections" : "Sections"}
              </span>
              <button
                type="button"
                onClick={() => setCustomizeMode((v) => !v)}
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-md",
                  "transition-colors duration-[var(--duration-base)] cursor-pointer",
                  customizeMode
                    ? "bg-gold text-cream [&_svg]:text-cream"
                    : "text-text-faint hover:bg-parchment-mid hover:text-espresso",
                )}
                aria-label={customizeMode ? "Done customising" : "Customise sidebar"}
              >
                {customizeMode ? <Check size={13} /> : <Pencil size={12} />}
              </button>
            </div>
          )}

          {customizeMode && !!user ? (
            // Customize/reorder UI is desktop-only; the icon-only width has no
            // room for drag handles or hide toggles. dnd-kit setup unchanged.
            <div className="hidden lg:block">
              <SidebarCustomize
                items={orderedSections}
                order={prefs.order}
                hidden={prefs.hidden}
                onReorder={handleReorder}
                onToggleHidden={toggleHidden}
                onReset={resetSections}
              />
            </div>
          ) : (
            <>
              {mainItems.length > 0 && (
                <NavGroup
                  label="Workspace"
                  items={mainItems}
                  pathname={pathname}
                  unreadCount={unreadCount}
                />
              )}
              {researchItems.length > 0 && (
                <NavGroup
                  label="Research"
                  items={researchItems}
                  pathname={pathname}
                  watchlistCount={watchlistCount}
                />
              )}
            </>
          )}
        </nav>

        {/* Bell button. Label hides at icon-only; bell icon stays clickable.
            Unread badge collapses to a corner dot at icon-only so users still
            see there is unread state without the explicit count. */}
        {!!user && (
          <div className="px-2 lg:px-3 pb-2">
            <button
              type="button"
              onClick={() => setNotifDrawerOpen(true)}
              data-tour="notifications-bell"
              className="flex items-center justify-center lg:justify-start gap-2 w-full px-2 lg:px-3 py-2 rounded-lg text-text-muted hover:bg-parchment-mid hover:text-espresso transition-colors cursor-pointer relative"
              aria-label="Notifications"
            >
              <Bell size={15} />
              <span className="hidden lg:inline font-sans text-[13px] font-medium flex-1 text-left">Notifications</span>
              {unreadBadge && (
                <>
                  <span
                    className={cn(
                      "hidden lg:flex",
                      "min-w-[18px] h-[18px] rounded-md",
                      "bg-gold text-cream",
                      "items-center justify-center px-1",
                      "font-sans text-[9px] font-bold",
                    )}
                  >
                    {unreadBadge}
                  </span>
                  {/* Icon-only indicator: small gold dot at top-right of bell */}
                  <span
                    aria-hidden="true"
                    className="lg:hidden absolute top-1 right-1 w-2 h-2 rounded-full bg-gold border border-sidebar-bg"
                  />
                </>
              )}
            </button>
          </div>
        )}

        {/* User footer.
            Desktop (lg+): full row with avatar, name, role, settings, sign-out.
            Tablet (icon-only): avatar centered, name/role/buttons hidden.
            Settings link still reachable via avatar click on tablet. */}
        <div className="border-t border-border-base px-2 lg:px-3 py-3.5">
          {user === null ? (
            <button
              type="button"
              onClick={() => { window.location.href = "/auth"; }}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-xl font-sans text-[12px] lg:text-[13px] font-semibold cursor-pointer transition-all bg-espresso text-cream"
              aria-label="Sign in"
            >
              <span className="hidden lg:inline">Sign in free →</span>
              <span className="lg:hidden">→</span>
            </button>
          ) : !!user ? (
            // `group` on the tile so the actions group can reveal on hover.
            // focus-within ensures keyboard tab navigation also reveals the
            // controls (otherwise tabbing into Settings or Sign out from the
            // keyboard would target invisible buttons).
            <div className="group flex items-center justify-center lg:justify-start gap-2.5 bg-parchment-mid border border-border-base rounded-lg px-2 lg:px-3 py-2.5">
              <Link href="/settings/profile" aria-label={`${userName} settings`} data-tour="settings-link" className="lg:hidden">
                <UserAvatar variant="sidebar" user={authUser ?? null} />
              </Link>
              <div className="hidden lg:flex items-center gap-2.5 flex-1 min-w-0">
                <UserAvatar variant="sidebar" user={authUser ?? null} />
                <div className="flex-1 min-w-0">
                  <p className="font-sans text-[12px] font-bold text-text-primary truncate">
                    {userName}
                  </p>
                  <p className="font-sans text-[10px] text-text-muted truncate">{userRole}</p>
                </div>
                {/* Settings + sign out: hidden by default, fade in on hover or
                    keyboard focus. Reclaims the row width for the user name so
                    longer names ("Noah Hanning") are not truncated at 220px. */}
                <div className="hidden group-hover:flex focus-within:flex items-center gap-2 flex-shrink-0">
                  <Link href="/settings/profile" aria-label="Settings" data-tour="settings-link-desktop">
                    <Settings size={14} className="text-text-faint hover:text-text-muted transition-colors" />
                  </Link>
                  <button
                    type="button"
                    title="Sign out"
                    aria-label="Sign out"
                    className="text-text-faint hover:text-signal-dn transition-colors cursor-pointer"
                    onClick={async () => {
                      const supabase = await getSupabase();
                      await supabase.auth.signOut();
                      window.location.href = "/";
                    }}
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              </div>
            </div>
          ) : null /* loading state: render nothing */}
        </div>
      </aside>

      {/* Notification drawer overlay */}
      {notifDrawerOpen && (
        <div
          className="fixed inset-0 z-[9000] bg-espresso/25"
          onClick={() => setNotifDrawerOpen(false)}
        />
      )}
      <div
        className="fixed top-0 right-0 bottom-0 z-[9001] overflow-hidden flex flex-col bg-elevated border-l border-border-base"
        style={{
          width: notifDrawerOpen ? '320px' : '0',
          maxWidth: '100vw',
          transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: notifDrawerOpen ? '-4px 0 24px rgba(0,0,0,0.1)' : 'none',
        }}
        aria-label="Notification panel"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border-base flex-shrink-0 whitespace-nowrap">
          <span className="font-sans text-[13px] font-bold text-text-primary">Notifications</span>
          <div className="flex items-center gap-2">
            {unreadNotifCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer px-1"
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotifDrawerOpen(false)}
              className="cursor-pointer text-text-faint hover:text-text-muted p-0.5"
              aria-label="Close notifications"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {!notifLoaded ? (
            <div className="px-4 py-5 font-sans text-[11px] text-text-faint">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="font-sans text-[12px] text-text-secondary mb-1">No notifications yet.</p>
              <p className="font-sans text-[11px] text-text-faint">Price alerts and brief updates will appear here.</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={cn(
                  "px-4 py-3 border-b border-border-base",
                  !n.read && "bg-gold-muted/30 cursor-pointer",
                  n.read && "cursor-default",
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.read && (
                    <span className="w-1.5 h-1.5 rounded-full bg-gold mt-1.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-sans text-[12px] leading-snug", n.read ? "text-text-secondary font-medium" : "text-text-primary font-semibold")}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="font-sans text-[11px] text-text-secondary mt-0.5 leading-snug">
                        {n.body}
                      </p>
                    )}
                    <p className="font-sans text-[9px] text-text-faint mt-1">
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  unreadCount,
  watchlistCount,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  unreadCount?: number;
  watchlistCount?: number;
}) {
  // Peripheral confirmation that a tracked call landed in Radar. A brief wash
  // on the row, not a banner and not a count bump: the badge here is the
  // watchlist count, and incrementing it for a call would put a wrong number on
  // screen. See src/lib/radar-landed.ts.
  const [radarLanded, setRadarLanded] = useState(false);
  useEffect(() => {
    return onRadarLanded(() => {
      setRadarLanded(false);
      // Next frame, so a second commit re-triggers the animation instead of
      // being swallowed by the class already being present.
      requestAnimationFrame(() => setRadarLanded(true));
      window.setTimeout(() => setRadarLanded(false), 700);
    });
  }, []);

  return (
    <div>
      {/* Eyebrow header: hidden at icon-only width to avoid unreadable wrapping. */}
      <p className="hidden lg:block px-3 mb-1.5 font-sans text-[11px] font-semibold text-text-faint">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const isLiveFeed = item.href === "/live-feed";
          const isWatchlist = item.href === "/radar";

          // Live-feed unread or watchlist count at icon-only width: render as
          // a small corner dot so users still see "there is something" without
          // a numeric chip that does not fit a 64px column.
          const hasIconBadge =
            (isLiveFeed && (unreadCount ?? 0) > 0) ||
            (isWatchlist && (watchlistCount ?? 0) > 0);

          return (
            <li key={item.id}>
              <Link
                href={item.href}
                title={item.label}
                data-tour={`${item.id}-link`}
                className={cn(
                  "flex items-center gap-2.5 px-2 lg:px-3 py-[9px] rounded-lg",
                  "justify-center lg:justify-start",
                  "font-sans text-[13px] font-medium",
                  "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                  "relative border-l-2 border-transparent",
                  isActive
                    ? "bg-espresso text-cream [&_svg]:text-gold dark:bg-elevated dark:text-foreground dark:border-border-default"
                    : "text-text-muted [&_svg]:text-text-faint hover:bg-parchment-mid hover:text-espresso hover:border-l-gold [&:hover_svg]:text-gold-dark dark:text-text-secondary dark:hover:bg-overlay",
                  isWatchlist && radarLanded && "radar-nav-pulse",
                )}
              >
                {item.icon}
                <span className="hidden lg:inline flex-1">{item.label}</span>
                {item.liveDot && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-signal-up animate-pulse" />
                    <span
                      className={cn(
                        "hidden lg:inline text-[9px] font-bold uppercase",
                        isActive ? "text-signal-up" : "text-signal-up",
                      )}
                    >
                      Live
                    </span>
                  </span>
                )}
                {/* Full numeric badge at lg+ */}
                {isLiveFeed && (unreadCount ?? 0) > 0 && (
                  <span className="hidden lg:flex min-w-[18px] h-[18px] items-center justify-center rounded-md bg-gold text-cream text-[9px] font-bold px-1">
                    {(unreadCount ?? 0) > 99 ? "99+" : unreadCount}
                  </span>
                )}
                {isWatchlist && (watchlistCount ?? 0) > 0 && (
                  <span className="hidden lg:flex min-w-[18px] h-[18px] items-center justify-center rounded-md bg-gold text-cream text-[9px] font-bold px-1">
                    {(watchlistCount ?? 0) > 99 ? "99+" : watchlistCount}
                  </span>
                )}
                {/* Icon-only width: small gold dot in the upper-right of the row */}
                {hasIconBadge && (
                  <span
                    aria-hidden="true"
                    className="lg:hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-gold border border-sidebar-bg"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
