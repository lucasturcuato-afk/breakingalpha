"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  AlignLeft,
  Star,
  Briefcase,
  TrendingUp,
  Search,
  FileText,
  Trophy,
  Clock,
  Globe,
} from "lucide-react";
import type { ReactNode } from "react";

interface MobileNavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

// 5 primary items fit the 375px bottom nav comfortably. Secondary destinations
// (Trends, Company Intel, Thesis Board, Track Record) are reachable from the
// dashboard + top-bar search on mobile.
const MOBILE_NAV: MobileNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutGrid size={18} /> },
  { label: "Feed", href: "/live-feed", icon: <AlignLeft size={18} /> },
  { label: "Watch", href: "/watchlist", icon: <Star size={18} /> },
  { label: "Deals", href: "/deal-flow", icon: <Briefcase size={18} /> },
  { label: "Trends", href: "/trends", icon: <TrendingUp size={18} /> },
];

const MORE_NAV: MobileNavItem[] = [
  { label: "Morning Brief", href: "/morning-brief", icon: <Clock size={16} /> },
  { label: "Evening Wrap", href: "/evening-wrap", icon: <Globe size={16} /> },
  { label: "Company Intel", href: "/company", icon: <Search size={16} /> },
  { label: "Thesis Board", href: "/thesis-board", icon: <FileText size={16} /> },
  { label: "Track Record", href: "/track-record", icon: <Trophy size={16} /> },
];

/**
 * Bottom navigation for mobile viewports (<768px).
 * Desktop renders this via md:hidden — it's never visible ≥md.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <>
      <nav
        className={cn(
          "md:hidden fixed bottom-0 left-0 right-0 z-40",
          "bg-sidebar-bg border-t border-white/[0.08]",
          "flex items-stretch",
          "pb-[env(safe-area-inset-bottom)]",
        )}
        aria-label="Primary navigation"
      >
        {MOBILE_NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5",
                "py-2 min-w-0",
                "font-sans text-[10px] font-medium",
                "transition-colors duration-[var(--duration-base)]",
                active
                  ? "text-gold [&_svg]:text-gold"
                  : "text-text-muted [&_svg]:text-text-faint hover:text-text-primary",
              )}
            >
              {item.icon}
              <span className="truncate max-w-full">{item.label}</span>
            </Link>
          );
        })}
        <MoreMenu pathname={pathname} />
      </nav>
      {/* Spacer so content isn't hidden behind the fixed bar on mobile. */}
      <div className="md:hidden h-[56px] flex-shrink-0" aria-hidden="true" />
    </>
  );
}

function MoreMenu({ pathname }: { pathname: string }) {
  const moreActive = MORE_NAV.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
  );
  return (
    <details className="flex-1 group relative min-w-0">
      <summary
        className={cn(
          "flex flex-col items-center justify-center gap-0.5 py-2 cursor-pointer list-none",
          "font-sans text-[10px] font-medium",
          "transition-colors duration-[var(--duration-base)]",
          moreActive
            ? "text-gold [&_svg]:text-gold"
            : "text-text-muted [&_svg]:text-text-faint",
        )}
      >
        <span className="flex items-center justify-center h-[18px]">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-current" />
            <span className="w-1 h-1 rounded-full bg-current" />
            <span className="w-1 h-1 rounded-full bg-current" />
          </span>
        </span>
        <span>More</span>
      </summary>
      <div
        className={cn(
          "absolute bottom-full right-0 mb-1 min-w-[180px]",
          "bg-sidebar-bg border border-border-base rounded-lg",
          "shadow-lg overflow-hidden",
        )}
      >
        {MORE_NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5",
                "font-sans text-[12px] font-medium",
                "transition-colors duration-[var(--duration-base)]",
                active
                  ? "text-gold bg-parchment-mid [&_svg]:text-gold"
                  : "text-text-muted [&_svg]:text-text-faint hover:bg-parchment-mid hover:text-text-primary",
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </details>
  );
}
