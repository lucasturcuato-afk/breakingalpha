import { cn } from "@/lib/utils";

export type AnomalyLevel = "low" | "medium" | "high" | "critical";

interface AnomalyBadgeProps {
  level: AnomalyLevel;
  className?: string;
}

const levelStyles: Record<AnomalyLevel, string> = {
  low: "bg-parchment-mid text-text-muted border-border-base",
  medium: "bg-amber-50 text-signal-warn border-amber-200",
  high: "bg-red-50 text-signal-dn border-red-200",
  critical: "bg-red-100 text-red-700 border-red-300",
};

export function AnomalyBadge({ level, className }: AnomalyBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border",
        "font-sans text-[10px] font-semibold capitalize",
        levelStyles[level],
        className,
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          level === "low" && "bg-text-faint",
          level === "medium" && "bg-signal-warn",
          level === "high" && "bg-signal-dn",
          level === "critical" && "bg-red-600 animate-pulse",
        )}
      />
      {level}
    </span>
  );
}
