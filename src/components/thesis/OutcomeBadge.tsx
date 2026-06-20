"use client";

import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { outcomeDisplayLabel } from "@/lib/track-record-live-score";

type OutcomeValue = "confirmed" | "invalidated" | "inconclusive" | null | undefined;

interface OutcomeBadgeProps {
  outcome: OutcomeValue;
  /** "sm" = inline pill (13px), "md" = card pill (default) */
  size?: "sm" | "md";
  className?: string;
}

const CONFIG = {
  confirmed: {
    icon: CheckCircle2,
    classes: "bg-signal-up/10 text-signal-up border-signal-up/20",
  },
  invalidated: {
    icon: XCircle,
    classes: "bg-signal-dn/10 text-signal-dn border-signal-dn/20",
  },
  inconclusive: {
    icon: MinusCircle,
    classes: "bg-signal-warn/10 text-signal-warn border-signal-warn/20",
  },
} as const;

export function OutcomeBadge({ outcome, size = "md", className }: OutcomeBadgeProps) {
  if (!outcome || !CONFIG[outcome]) return null;

  // Render the neutral evidence label (Supported / Challenged / Inconclusive),
  // never the raw verdict as a call, in lock-step with the live surfaces.
  const { icon: Icon, classes } = CONFIG[outcome];
  const isSm = size === "sm";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-data font-bold uppercase",
        classes,
        isSm ? "px-1.5 py-0.5 text-[8px]" : "px-2.5 py-1 text-[10px]",
        className,
      )}
    >
      <Icon size={isSm ? 9 : 11} />
      {outcomeDisplayLabel(outcome)}
    </span>
  );
}
