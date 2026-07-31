import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface DashTileProps {
  /** Fraunces railhead title. */
  title: string;
  /** Optional italic Fraunces subtitle sitting beside the title. */
  subtitle?: string;
  /** Optional right-aligned action slot (e.g. a "full →" link). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Entrance stagger in ms (fed to the dash-rise animation-delay). */
  riseDelay?: number;
  /** Asymmetric "squircle" radius for the feature tile. */
  squircle?: boolean;
}

/**
 * Editorial tile shell for the dashboard main column: a flat surface with a
 * Fraunces railhead header (title + optional italic subtitle + action) and the
 * hover-spotlight / rise-in motion shared by the re-skin. Content is any
 * existing widget dropped in as-is; the tile only supplies chrome.
 */
export function DashTile({
  title,
  subtitle,
  action,
  children,
  className,
  riseDelay = 0,
  squircle = false,
}: DashTileProps) {
  return (
    <section
      className={cn(
        "dash-tile dash-rise bg-white border border-border-base p-5 md:p-6",
        squircle ? "rounded-[28px_28px_28px_10px]" : "rounded-2xl",
        className,
      )}
      style={{ animationDelay: `${riseDelay}ms` }}
    >
      <div className="flex items-baseline justify-between gap-3 border-b-[1.5px] border-[color:var(--espresso)] pb-2.5 mb-3.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="font-display text-[18px] font-medium text-espresso m-0 truncate">
            {title}
          </h3>
          {subtitle && (
            <span className="font-display italic text-[12px] text-text-muted whitespace-nowrap">
              {subtitle}
            </span>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
