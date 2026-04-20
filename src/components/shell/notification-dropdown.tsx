"use client";

import { cn } from "@/lib/utils";
import type { WatchlistNotification } from "@/hooks/useNotifications";

interface NotificationDropdownProps {
  notifications: WatchlistNotification[];
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationDropdown({
  notifications,
  onMarkAllRead,
  onMarkRead,
}: NotificationDropdownProps) {
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div
      className={cn(
        "absolute right-0 top-full mt-2 w-[320px] max-w-[calc(100vw-24px)]",
        "bg-cream border border-border-base rounded-2xl shadow-lg z-50 overflow-hidden",
        "dark:bg-elevated dark:border-border-default",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle dark:border-border-default">
        <h3 className="font-sans text-[13px] font-bold text-text-primary">
          Notifications
        </h3>
        {hasUnread && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="font-sans text-[11px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Items */}
      <div className="max-h-[360px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-10 text-center flex flex-col items-center justify-center">
            <span className="text-[20px] mb-1.5 text-text-faint">✓</span>
            <p className="font-sans text-[12px] font-semibold text-text-primary">
              You&apos;re all caught up
            </p>
            <p className="font-sans text-[11px] text-text-muted mt-0.5">
              No new notifications
            </p>
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.read) onMarkRead(n.id);
              }}
              className={cn(
                "w-full text-left flex items-start gap-2.5 px-4 py-3",
                "border-b border-border-subtle last:border-b-0 dark:border-border-default",
                "transition-colors duration-[var(--duration-fast)]",
                "hover:bg-parchment-mid dark:hover:bg-overlay",
                !n.read && "bg-gold-muted/30 dark:bg-overlay",
                n.read ? "cursor-default" : "cursor-pointer",
              )}
            >
              {!n.read && (
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "font-sans text-[12px] leading-snug",
                    n.read
                      ? "text-text-secondary"
                      : "text-text-primary font-semibold",
                  )}
                >
                  {n.title}
                </p>
                {n.body && (
                  <p className="font-sans text-[11px] text-text-secondary mt-0.5 leading-snug">
                    {n.body}
                  </p>
                )}
                <p className="font-mono text-[10px] text-text-faint mt-1">
                  {timeAgo(n.created_at)}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
