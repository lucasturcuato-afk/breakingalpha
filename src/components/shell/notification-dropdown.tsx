import { cn } from "@/lib/utils";
import { AlertTriangle, Zap, Brain, TrendingUp, Newspaper } from "lucide-react";
import type { ReactNode } from "react";

export interface NotificationItem {
  id: string;
  type: "breaking" | "signal" | "ai-memo" | "vix-alert" | "brief-ready";
  title: string;
  timestamp: string;
  read: boolean;
}

interface NotificationDropdownProps {
  items: NotificationItem[];
  onMarkAllRead: () => void;
}

const typeConfig: Record<
  NotificationItem["type"],
  { icon: ReactNode; iconBg: string }
> = {
  breaking: {
    icon: <Newspaper size={12} className="text-white" />,
    iconBg: "bg-signal-dn",
  },
  signal: {
    icon: <Zap size={12} className="text-white" />,
    iconBg: "bg-gold",
  },
  "ai-memo": {
    icon: <Brain size={12} className="text-white" />,
    iconBg: "bg-signal-ai",
  },
  "vix-alert": {
    icon: <AlertTriangle size={12} className="text-white" />,
    iconBg: "bg-signal-dn",
  },
  "brief-ready": {
    icon: <TrendingUp size={12} className="text-white" />,
    iconBg: "bg-gold",
  },
};

export function NotificationDropdown({ items, onMarkAllRead }: NotificationDropdownProps) {
  return (
    <div className="absolute right-0 top-full mt-2 w-[300px] bg-white border border-border-base rounded-2xl shadow-lg z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <h3 className="font-sans text-[13px] font-bold text-text-primary">
          Notifications
        </h3>
        <button
          type="button"
          onClick={onMarkAllRead}
          className="font-sans text-[11px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer"
        >
          Mark all read
        </button>
      </div>

      {/* Items */}
      <div className="max-h-[320px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-12 text-center flex flex-col items-center justify-center">
            <span className="text-[24px] mb-2">✓</span>
            <p className="font-sans text-[13px] font-semibold text-text-primary">You&apos;re all caught up</p>
            <p className="font-sans text-[11px] text-text-muted mt-0.5">No new notifications</p>
          </div>
        ) : (
          items.slice(0, 5).map((item) => {
            const config = typeConfig[item.type];
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  "transition-colors duration-[var(--duration-fast)]",
                  "hover:bg-parchment",
                  !item.read && "bg-gold-muted",
                )}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                    config.iconBg,
                  )}
                >
                  {config.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-sans text-[12px] leading-snug",
                      item.read ? "text-text-secondary" : "text-text-primary font-medium",
                    )}
                  >
                    {item.title}
                  </p>
                  <p className="font-mono text-[10px] text-text-faint mt-0.5">
                    {item.timestamp}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
