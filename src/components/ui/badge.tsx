import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type BadgeVariant =
  | "default"
  | "gold"
  | "bullish"
  | "bearish"
  | "risk-off"
  | "risk-on"
  | "neutral"
  | "ma"
  | "ai"
  | "muted";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default:
    "bg-parchment-mid text-text-secondary border border-border-base",
  gold:
    "bg-gold-muted text-gold-dark border border-gold-border",
  bullish:
    "bg-green-50 text-signal-up border border-green-200",
  bearish:
    "bg-red-50 text-signal-dn border border-red-200",
  "risk-off":
    "bg-red-50 text-signal-dn border border-red-200",
  "risk-on":
    "bg-green-50 text-signal-up border border-green-200",
  neutral:
    "bg-amber-50 text-signal-warn border border-amber-200",
  ma:
    "bg-amber-50 text-amber-700 border border-amber-200",
  ai:
    "bg-violet-50 text-signal-ai border border-violet-200",
  muted:
    "bg-parchment text-text-muted border border-border-subtle",
};

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-sans text-[9px] font-semibold",
        "px-2 py-0.5 rounded-md whitespace-nowrap",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge, type BadgeProps, type BadgeVariant };
