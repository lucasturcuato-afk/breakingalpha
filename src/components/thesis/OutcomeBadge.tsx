"use client";

import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";

type OutcomeValue = "confirmed" | "invalidated" | "inconclusive" | null | undefined;

interface OutcomeBadgeProps {
  outcome: OutcomeValue;
  /** "sm" = inline pill (13px), "md" = card pill (default) */
  size?: "sm" | "md";
  className?: string;
}

const CONFIG = {
  confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    classes: "bg-signal-up/10 text-signal-up border-signal-up/20",
  },
  invalidated: {
    label: "Invalidated",
    icon: XCircle,
    classes: "bg-signal-dn/10 text-signal-dn border-signal-dn/20",
  },
  inconclusive: {
    label: "Inconclusive",
    icon: MinusCircle,
    classes: "bg-signal-warn/10 text-signal-warn border-signal-warn/20",
  },
} as const;

export function OutcomeBadge({ outcome, size = "md", className }: OutcomeBadgeProps) {
  if (!outcome || !CONFIG[outcome]) return null;

  const { label, icon: Icon, classes } = CONFIG[outcome];
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
      {label}
    </span>
  );
}
