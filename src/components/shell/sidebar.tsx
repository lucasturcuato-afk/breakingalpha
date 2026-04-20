"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

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
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: ReactNode;
  liveDot?: boolean;
}

const mainNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutGrid size={16} /> },
  { label: "Morning Brief", href: "/morning-brief", icon: <Clock size={16} />, liveDot: true },
  { label: "Evening Wrap", href: "/evening-wrap", icon: <Globe size={16} /> },
  { label: "Live Feed", href: "/live-feed", icon: <AlignLeft size={16} /> },
];

const researchNav: NavItem[] = [
  { label: "Thesis Board", href: "/thesis-board", icon: <FileText size={16} /> },
  { label: "Deal Flow", href: "/deal-flow", icon: <Briefcase size={16} /> },
  { label: "Company Intel", href: "/company", icon: <Search size={16} /> },
  { label: "Trends", href: "/trends", icon: <TrendingUp size={16} /> },
  { label: "Track Record", href: "/track-record", icon: <Trophy size={16} /> },
  { label: "Watchlist", href: "/watchlist", icon: <Star size={16} /> },
  { label: "Intelligence", href: "/intelligence", icon: <Sparkles size={16} /> },
];

interface Notification {
  id: string;
  identifier: string;
  type: string;
  title: string;
  body?: string | null;
  read: boolean;
  created_at: string;
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

export function Sidebar({
  unreadCount = 0,
}: SidebarProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string; name: string; email: string; role: string } | null | undefined>(undefined);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifLoaded, setNotifLoaded] = useState(false);

  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const unreadBadge = unreadNotifCount > 9 ? "9+" : unreadNotifCount > 0 ? String(unreadNotifCount) : null;

  const getSupabase = useCallback(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ), []);

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
        .select("id", { count: "exact", head: true })
        .eq("user_id", authUser.id)
        .then(({ count }) => {
          if (count !== null) setWatchlistCount(count);
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
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .then(({ count }) => {
              if (count !== null) setWatchlistCount(count);
            });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, getSupabase]);

  // Fetch notifications on mount
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

  const userName = user?.name || "User";
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const userRole = user?.role || "";

  return (
    <>
      <aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-sidebar-bg border-r border-border-base flex flex-col z-40">
        {/* Logo area */}
        <div style={{ borderBottom: '1px solid var(--border-base)', padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0px', width: '100%' }}>
            <div style={{ width: '80px', height: '72px', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
              <img
                src="/logo-icon.png"
                alt="Signalera"
                style={{ position: 'absolute', width: '480px', height: '480px', left: '50%', top: '50%', transform: 'translate(-53%, -53%)', objectFit: 'contain' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: '"Playfair Display", serif', letterSpacing: '-0.3px', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
                <span className="text-foreground">Signal</span>
                <span className="text-gold">era</span>
              </div>
              <div className="text-muted-foreground" style={{ fontSize: '9px', fontWeight: 500, fontFamily: 'Inter, sans-serif', letterSpacing: '1.5px', textTransform: 'uppercase' as const, lineHeight: 1.4, wordBreak: 'break-word' }}>
                Where Markets Make Sense
              </div>
            </div>
          </div>
        </div>

        {/* Nav body */}
        <nav className="flex-1 overflow-y-auto px-3 py-3.5 space-y-5">
          <NavGroup label="Main" items={mainNav} pathname={pathname} unreadCount={unreadCount} />
          <NavGroup label="Research" items={researchNav} pathname={pathname} watchlistCount={watchlistCount} />
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
                  style={{
                    minWidth: '18px', height: '18px', borderRadius: '4px',
                    background: '#d97706', color: '#fff',
                    fontSize: '9px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px',
                  }}
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
              className="w-full flex items-center justify-center gap-2 h-10 rounded-xl font-sans text-[13px] font-semibold cursor-pointer transition-all"
              style={{ backgroundColor: "var(--espresso)", color: "var(--cream)" }}
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
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(30,20,10,0.25)' }}
          onClick={() => setNotifDrawerOpen(false)}
        />
      )}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: notifDrawerOpen ? '320px' : '0',
          maxWidth: '100vw',
          zIndex: 9001,
          overflow: 'hidden',
          transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
          background: 'var(--elevated)',
          borderLeft: '1px solid var(--border-base)',
          boxShadow: notifDrawerOpen ? '-4px 0 24px rgba(0,0,0,0.1)' : 'none',
          display: 'flex',
          flexDirection: 'column',
        }}
        aria-label="Notification panel"
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Notifications
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {unreadNotifCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{ fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#d97706', cursor: 'pointer', background: 'none', border: 'none', padding: '2px 4px' }}
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotifDrawerOpen(false)}
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: '2px', color: 'var(--text-faint)' }}
              aria-label="Close notifications"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {!notifLoaded ? (
            <div style={{ padding: '20px 16px', fontFamily: 'Inter, sans-serif', fontSize: '11px', color: 'var(--text-faint)' }}>Loading…</div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>No notifications yet.</p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', color: 'var(--text-faint)' }}>Price alerts and brief updates will appear here.</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border-base)',
                  cursor: n.read ? 'default' : 'pointer',
                  background: n.read ? 'transparent' : 'rgba(251,191,36,0.05)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  {!n.read && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d97706', flexShrink: 0, marginTop: '5px' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 600, color: n.read ? 'var(--text-secondary)' : 'var(--text-primary)', whiteSpace: 'normal', lineHeight: 1.4 }}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                        {n.body}
                      </p>
                    )}
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '9px', color: 'var(--text-faint)', marginTop: '4px' }}>
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
            <li key={item.href}>
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
