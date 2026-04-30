"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  Trophy,
  Sparkles,
  Settings,
  LogOut,
  Bell,
  X,
  GripVertical,
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Check,
} from "lucide-react";
import { Wordmark } from "@/components/ui/wordmark";

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
  { id: "thesis-board", label: "Thesis Board", href: "/thesis-board", icon: <FileText size={16} />, kind: "research" },
  { id: "deal-flow", label: "Deal Flow", href: "/deal-flow", icon: <Briefcase size={16} />, kind: "research" },
  { id: "company", label: "Company Intel", href: "/company", icon: <Search size={16} />, kind: "research" },
  { id: "trends", label: "Trends", href: "/trends", icon: <TrendingUp size={16} />, kind: "research" },
  { id: "track-record", label: "Track Record", href: "/track-record", icon: <Trophy size={16} />, kind: "research" },
  { id: "watchlist", label: "Watchlist", href: "/watchlist", icon: <Star size={16} />, kind: "research" },
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

  const getSupabase = useCallback(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Auth + initial loads ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (!authUser) {
        setUser(null);
        return;
      }
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
          if (data) setWatchlistCount(dedupeWatchlistCount(data));
        });
    });
  }, [getSupabase]);

  // Realtime subscription for watchlist count badge
  useEffect(() => {
    if (!user?.id) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`watchlist-count-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watchlist", filter: `user_id=eq.${user.id}` },
        () => {
          supabase
            .from("watchlist")
            .select("identifier, type")
            .eq("user_id", user.id)
            .then(({ data }) => {
              if (data) setWatchlistCount(dedupeWatchlistCount(data));
            });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
    const supabase = getSupabase();
    supabase
      .from("user_profiles")
      .select("sidebar_section_order")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setPrefsLoaded(true);
          return;
        }
        const raw = (data as { sidebar_section_order?: unknown } | null)?.sidebar_section_order;
        if (isValidPrefs(raw)) {
          const known = new Set(DEFAULT_ORDER);
          const filteredOrder = raw.order.filter((o) => known.has(o));
          const missing = DEFAULT_ORDER.filter((o) => !filteredOrder.includes(o));
          const filteredHidden = raw.hidden.filter((h) => known.has(h));
          setPrefs({ order: [...filteredOrder, ...missing], hidden: filteredHidden });
        }
        setPrefsLoaded(true);
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
    persistTimerRef.current = setTimeout(() => {
      const supabase = getSupabase();
      const payload = isDefault ? null : prefs;
      supabase
        .from("user_profiles")
        .update({ sidebar_section_order: payload, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .then(({ error }) => {
          if (error) {
            console.warn("[sidebar] section order persist failed:", error.message);
          }
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

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPrefs((prev) => {
      const oldIdx = prev.order.indexOf(String(active.id));
      const newIdx = prev.order.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      return { ...prev, order: arrayMove(prev.order, oldIdx, newIdx) };
    });
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
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const userRole = user?.role || "";

  // Render groupings — preserves "Main" / "Research" labels for non-customize mode.
  const mainItems = visibleSections.filter((s) => s.kind === "main");
  const researchItems = visibleSections.filter((s) => s.kind === "research");

  return (
    <>
      <aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-sidebar-bg border-r border-border-base flex flex-col z-40">
        {/* Logo area */}
        <div className="border-b border-border-base px-4 py-4 flex items-center justify-center">
          <Wordmark size="lg" />
        </div>

        {/* Nav body */}
        <nav className="flex-1 overflow-y-auto px-3 py-3.5 space-y-5">
          {!!user && (
            <div className="flex items-center justify-between px-3">
              <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={prefs.order} strategy={verticalListSortingStrategy}>
                <ul className="space-y-0.5">
                  {orderedSections.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      hidden={prefs.hidden.includes(item.id)}
                      onToggleHidden={() => toggleHidden(item.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
              <button
                type="button"
                onClick={resetSections}
                className={cn(
                  "flex items-center gap-2 w-full mt-3 px-3 py-2 rounded-lg",
                  "font-sans text-[11px] font-medium",
                  "text-text-muted hover:bg-parchment-mid hover:text-espresso",
                  "transition-colors duration-[var(--duration-base)] cursor-pointer",
                )}
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            </DndContext>
          ) : (
            <>
              {mainItems.length > 0 && (
                <NavGroup
                  label="Main"
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

        {/* Bell button */}
        {!!user && (
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => setNotifDrawerOpen(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-text-muted hover:bg-parchment-mid hover:text-espresso transition-colors cursor-pointer relative"
              aria-label="Notifications"
            >
              <Bell size={15} />
              <span className="font-sans text-[13px] font-medium flex-1 text-left">Notifications</span>
              {unreadBadge && (
                <span
                  className={cn(
                    "min-w-[18px] h-[18px] rounded-md",
                    "bg-gold text-cream",
                    "flex items-center justify-center px-1",
                    "font-sans text-[9px] font-bold",
                  )}
                >
                  {unreadBadge}
                </span>
              )}
            </button>
          </div>
        )}

        {/* User footer */}
        <div className="border-t border-border-base px-3 py-3.5">
          {user === null ? (
            <button
              type="button"
              onClick={() => { window.location.href = "/auth"; }}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-xl font-sans text-[13px] font-semibold cursor-pointer transition-all bg-espresso text-cream"
            >
              Sign in free →
            </button>
          ) : !!user ? (
            <div className="flex items-center gap-2.5 bg-parchment-mid border border-border-base rounded-lg px-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-espresso flex items-center justify-center flex-shrink-0">
                <span className="font-display text-[11px] font-bold text-gold">
                  {userInitials}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-sans text-[12px] font-bold text-text-primary truncate">
                  {userName}
                </p>
                <p className="font-sans text-[10px] text-text-muted">{userRole}</p>
              </div>
              <Link href="/settings/profile" aria-label="Settings">
                <Settings size={14} className="text-text-faint hover:text-text-muted transition-colors" />
              </Link>
              <button
                type="button"
                title="Sign out"
                aria-label="Sign out"
                className="text-text-faint hover:text-signal-dn transition-colors cursor-pointer"
                onClick={async () => {
                  const supabase = getSupabase();
                  await supabase.auth.signOut();
                  window.location.href = "/";
                }}
              >
                <LogOut size={14} />
              </button>
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

function SortableRow({
  item,
  hidden,
  onToggleHidden,
}: {
  item: NavItem;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 px-2 py-[7px] rounded-lg bg-parchment-mid/60 border border-border-base",
        "dark:bg-elevated dark:border-border-default",
        isDragging && "opacity-70",
        hidden && "opacity-60",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1 rounded-md cursor-grab active:cursor-grabbing text-text-faint hover:text-text-muted touch-none"
        aria-label={`Drag ${item.label}`}
      >
        <GripVertical size={12} />
      </button>
      <span
        className={cn(
          "flex items-center gap-2 flex-1 min-w-0 font-sans text-[12px] font-medium text-text-primary",
          hidden && "line-through text-text-faint",
        )}
      >
        <span className="[&_svg]:text-text-faint">{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </span>
      <button
        type="button"
        onClick={onToggleHidden}
        className="p-1 rounded-md text-text-faint hover:bg-parchment hover:text-espresso cursor-pointer"
        aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
      >
        {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </li>
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
  return (
    <div>
      <p className="px-3 mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const isLiveFeed = item.href === "/live-feed";

          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-[9px] rounded-lg",
                  "font-sans text-[13px] font-medium",
                  "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                  isActive
                    ? "bg-espresso text-cream [&_svg]:text-gold dark:bg-elevated dark:text-foreground dark:border dark:border-border-default"
                    : "text-text-muted [&_svg]:text-text-faint hover:bg-parchment-mid hover:text-espresso [&:hover_svg]:text-gold-dark dark:text-text-secondary dark:hover:bg-overlay",
                )}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.liveDot && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-signal-up animate-pulse" />
                    <span className={cn(
                      "text-[9px] font-bold uppercase",
                      isActive ? "text-signal-up" : "text-signal-up",
                    )}>
                      Live
                    </span>
                  </span>
                )}
                {isLiveFeed && (unreadCount ?? 0) > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-md bg-gold text-cream text-[9px] font-bold px-1">
                    {(unreadCount ?? 0) > 99 ? "99+" : unreadCount}
                  </span>
                )}
                {item.href === "/watchlist" && (watchlistCount ?? 0) > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-md bg-gold text-cream text-[9px] font-bold px-1">
                    {(watchlistCount ?? 0) > 99 ? "99+" : watchlistCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
