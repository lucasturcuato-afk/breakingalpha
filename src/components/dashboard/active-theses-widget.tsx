import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { BadgeVariant } from "@/components/ui/badge";

export interface ThesisPreview {
  id: string;
  title: string;
  conviction: "BULLISH" | "BEARISH" | "WATCH";
  preview: string;
}

interface ActiveThesesWidgetProps {
  theses?: ThesisPreview[];
}

const convictionMap: Record<string, BadgeVariant> = {
  BULLISH: "bullish",
  BEARISH: "bearish",
  WATCH: "neutral",
};

export function ActiveThesesWidget({
  theses = [
    {
      id: "1",
      title: "AI Infra Consolidation Wave",
      conviction: "BULLISH" as const,
      preview: "Major cloud providers acquiring AI startups at accelerating pace.",
    },
    {
      id: "2",
      title: "China Tech Regulatory Reset",
      conviction: "WATCH" as const,
      preview: "Easing restrictions may unlock trapped value in Chinese tech sector.",
    },
    {
      id: "3",
      title: "Commercial RE Distress Cycle",
      conviction: "BEARISH" as const,
      preview: "Office vacancy rates hitting new highs as refinancing wave approaches.",
    },
  ],
}: ActiveThesesWidgetProps) {
  return (
    <div className="space-y-2.5">
      {theses.map((thesis) => (
        <Link
          key={thesis.id}
          href={`/thesis-board?id=${thesis.id}`}
          className={cn(
            "block p-2.5 rounded-lg",
            "transition-colors duration-[var(--duration-fast)]",
            "hover:bg-parchment-mid",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={convictionMap[thesis.conviction]}>
              {thesis.conviction}
            </Badge>
          </div>
          <h4 className="font-display text-[12px] font-semibold text-text-primary leading-snug">
            {thesis.title}
          </h4>
          <p className="font-sans text-[11px] text-text-secondary leading-snug mt-0.5 line-clamp-2">
            {thesis.preview}
          </p>
        </Link>
      ))}

      <Link
        href="/thesis-board"
        className="block font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        View all theses →
      </Link>
    </div>
  );
}
