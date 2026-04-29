"use client";

import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { Bell, Search, Sun, Moon, User } from "lucide-react";
import { NotificationDropdown } from "./notification-dropdown";
import { useTheme } from "@/components/providers/theme-provider";
import { useNotifications } from "@/hooks/useNotifications";
import Link from "next/link";

interface TopbarProps {
  pageTitle: string;
  userInitials?: string;
  authed?: boolean;
  onCommandOpen?: () => void;
}

export function Topbar({
  pageTitle,
  userInitials = "LT",
  authed = false,
  onCommandOpen,
}: TopbarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme, mounted } = useTheme();

  // Live-polled notifications. Hook short-circuits + cleans up when unauthenticated.
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(authed);
  const hasUnread = unreadCount > 0;
  const badgeText = unreadCount > 9 ? "9+" : String(unreadCount);

  // Close on outside click
  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

  return (
    <div className="h-[var(--topbar-height)] bg-sidebar-bg border-b border-border-base flex items-center px-5 gap-4">
      {/* Page title */}
      <div className="flex items-baseline gap-2 whitespace-nowrap min-w-0">
        <h1 className="font-display text-[15px] font-bold text-espresso truncate">
          {pageTitle}
        </h1>
        <span
          className="font-sans font-medium uppercase leading-none select-none"
          style={{
            color: "var(--gold)",
            fontSize: "9px",
            letterSpacing: "0.15em",
            opacity: 0.75,
          }}
          aria-label="Beta release"
        >
          Beta
        </span>
      </div>

      {/* Search bar — full on md+, icon-only on mobile */}
      <div className="flex-1 flex justify-center">
        {/* Mobile: icon-only search button */}
        <button
          type="button"
          onClick={onCommandOpen}
          className={cn(
            "md:hidden flex items-center justify-center",
            "w-8 h-8 rounded-lg",
            "bg-parchment-mid border border-border-base",
            "transition-colors duration-[var(--duration-base)]",
            "hover:border-gold-border",
            "cursor-pointer",
          )}
          aria-label="Search"
        >
          <Search size={14} className="text-text-faint" />
        </button>
        {/* Desktop: full search bar */}
        <button
          type="button"
          onClick={onCommandOpen}
          className={cn(
            "hidden md:flex items-center gap-2 w-full max-w-[280px]",
            "bg-parchment-mid border border-border-base rounded-lg",
            "dark:bg-elevated dark:border-border-default",
            "px-3 h-8",
            "transition-colors duration-[var(--duration-base)]",
            "hover:border-gold-border",
            "cursor-pointer",
          )}
        >
          <Search size={13} className="text-text-faint flex-shrink-0" />
          <span className="flex-1 text-left font-sans text-[12px] text-text-faint">
            Ask Signalera anything...
          </span>
          <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cream border border-border-base text-[10px] font-mono text-text-faint">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded-lg",
            "bg-parchment-mid border border-border-base",
            "transition-colors duration-[var(--duration-base)]",
            "hover:border-border-hover",
            "cursor-pointer",
          )}
          aria-label="Toggle dark mode"
        >
          {!mounted ? (
            <span className="w-3.5 h-3.5" />
          ) : (
            <div className="relative w-4 h-4">
              <Sun
                size={14}
                className={cn(
                  "absolute inset-0 transition-all duration-200 text-gold",
                  theme === "dark" ? "opacity-100 rotate-0" : "opacity-0 -rotate-90",
                )}
              />
              <Moon
                size={14}
                className={cn(
                  "absolute inset-0 transition-all duration-200 text-text-muted",
                  theme === "dark" ? "opacity-0 rotate-90" : "opacity-100 rotate-0",
                )}
              />
            </div>
          )}
        </button>

        {/* Notification bell — only visible when authenticated */}
        {authed && (
          <div ref={bellRef} className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen(!notifOpen)}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded-lg",
                "bg-parchment-mid border border-border-base",
                "transition-colors duration-[var(--duration-base)]",
                "hover:border-border-hover",
                "cursor-pointer",
              )}
              aria-label="Notifications"
            >
              <Bell size={14} className="text-text-muted" />
              {hasUnread && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full",
                    "bg-gold text-cream",
                    "flex items-center justify-center px-1",
                    "font-sans text-[9px] font-bold leading-none",
                  )}
                >
                  {badgeText}
                </span>
              )}
            </button>

            {notifOpen && (
              <NotificationDropdown
                notifications={notifications}
                onMarkAllRead={markAllRead}
                onMarkRead={markRead}
              />
            )}
          </div>
        )}

        {/* User avatar with dropdown */}
        <UserMenu userInitials={userInitials} />
      </div>
    </div>
  );
}

/* ── User menu dropdown ── */

function UserMenu({ userInitials: _userInitials }: { userInitials: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer",
          "border border-gold-border",
          "transition-[box-shadow,border-color] duration-[var(--duration-base)]",
          "brand-mark-pulse",
        )}
        style={{ backgroundColor: "var(--gold-muted)" }}
        aria-label="User menu"
      >
        <span
          className="font-display text-[13px] font-bold leading-none"
          style={{
            backgroundImage:
              "linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 55%, var(--gold-dark) 100%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
          }}
        >
          S
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-48 bg-cream border border-border-base rounded-xl shadow-lg z-50 py-1.5 overflow-hidden">
          <Link
            href="/settings/profile"
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5",
              "font-sans text-[12px] font-medium text-text-secondary",
              "hover:bg-parchment-mid hover:text-espresso transition-colors",
            )}
          >
            <User size={14} className="text-text-faint" />
            Profile settings
          </Link>
          <Link
            href="/settings/profile"
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5",
              "font-sans text-[12px] font-medium text-text-secondary",
              "hover:bg-parchment-mid hover:text-espresso transition-colors",
            )}
          >
            <Search size={14} className="text-text-faint" />
            All settings
          </Link>
        </div>
      )}
    </div>
  );
}
