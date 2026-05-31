"use client";

/**
 * ComingSoonCard -- placeholder card for un-shipped tabs (F6-F9).
 * Subscribe button is NOT `disabled` so the Tooltip fires on hover;
 * `aria-disabled="true"` conveys the non-actionable semantic to AT.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";

interface ComingSoonCardProps {
  slot: "f6" | "f7" | "f8" | "f9";
  title: string;
  description: string;
  step: string;
  icon: ReactNode;
  className?: string;
}

function ComingSoonCard({ slot, title, description, step, icon, className }: ComingSoonCardProps) {
  return (
    <div
      data-testid={`coming-soon-card-${slot}`}
      className={cn("rounded-md border border-border-base bg-cream-hi p-5", className)}
    >
      <div className="flex items-center justify-center mb-2">
        <Badge variant="muted">Coming Soon</Badge>
      </div>
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={
          <div className="flex flex-col items-center gap-2">
            <Tooltip content="Tracking interest -- not wired yet." side="top">
              <button
                type="button"
                aria-disabled="true"
                onClick={(e) => e.preventDefault()}
                className={cn(
                  "inline-flex items-center px-3 py-1.5 rounded-md",
                  "border border-border-base bg-cream",
                  "font-sans text-[12px] font-medium text-text-secondary",
                  "hover:bg-parchment-mid transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1",
                )}
              >
                Subscribe to updates
              </button>
            </Tooltip>
            {step ? <span className="font-data text-[10px] text-text-faint">{step}</span> : null}
          </div>
        }
      />
    </div>
  );
}

export { ComingSoonCard, type ComingSoonCardProps };
