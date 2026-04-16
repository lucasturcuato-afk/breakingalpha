"use client";

import { useState, useEffect } from "react";
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
  Settings,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";

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
];

interface SidebarProps {
  unreadCount?: number;
}

export function Sidebar({
  unreadCount = 0,
}: SidebarProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; email: string; role: string } | null>(null);
  const [watchlistCount, setWatchlistCount] = useState(0);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUser({
          name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
          email: user.email || "",
          role: user.user_metadata?.role || "Analyst",
        });
        supabase
          .from("watchlist")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .then(({ count }) => {
            if (count !== null) setWatchlistCount(count);
          });
      }
    });
  }, []);

  const userName = user?.name || "User";
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const userRole = user?.role || "";

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-cream border-r border-border-base flex flex-col z-40">
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

      {/* User footer */}
      <div className="border-t border-border-base px-3 py-3.5">
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
              const supabase = createBrowserClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
              );
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
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
                    ? "bg-espresso text-cream [&_svg]:text-gold"
                    : "text-text-muted [&_svg]:text-text-faint hover:bg-parchment-mid hover:text-espresso [&:hover_svg]:text-gold-dark",
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
