"use client";

/**
 * ComingSoonCard -- placeholder card for un-shipped tabs (F6-F9).
 *
 * There used to be a "Subscribe to updates" button here. It was a pure no-op:
 * onClick called preventDefault and nothing else, aria-disabled was true, and
 * its own tooltip read "not wired yet". A control that cannot do anything is
 * worse than no control, so it is gone. If interest tracking is ever built,
 * bring the button back WITH the handler that persists the signup.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

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
          step ? <span className="font-sans text-[10px] text-text-faint">{step}</span> : null
        }
      />
    </div>
  );
}

export { ComingSoonCard, type ComingSoonCardProps };
