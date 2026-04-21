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
      <h1 className="font-display text-[15px] font-bold text-espresso whitespace-nowrap">
        {pageTitle}
      </h1>

      {/* Search bar */}
      <div className="flex-1 flex justify-center">
        <button
          type="button"
          onClick={onCommandOpen}
          className={cn(
            "flex items-center gap-2 w-full max-w-[280px]",
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
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cream border border-border-base text-[10px] font-mono text-text-faint">
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
          ) : theme === "dark" ? (
            <Sun size={14} className="text-gold" />
          ) : (
            <Moon size={14} className="text-text-muted" />
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

function UserMenu({ userInitials }: { userInitials: string }) {
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
        className="w-8 h-8 rounded-lg bg-espresso flex items-center justify-center cursor-pointer"
        aria-label="User menu"
      >
        <span className="font-display text-[11px] font-bold text-gold">
          {userInitials}
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
