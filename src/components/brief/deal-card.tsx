import { cn } from "@/lib/utils";

export interface DealData {
  company: string;
  value: string;
  dealType: string;
  description: string;
}

interface DealCardProps {
  deal: DealData;
}

export function DealCard({ deal }: DealCardProps) {
  return (
    <div
      className={cn(
        "p-3.5 rounded-xl border border-border-base bg-white",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="font-display text-[13px] font-bold text-espresso">
          {deal.company}
        </h4>
        <span className="font-data text-[11px] font-semibold text-gold">
          {deal.value}
        </span>
      </div>
      <span className="inline-block font-sans text-[9px] uppercase tracking-wide font-bold text-text-muted bg-parchment-mid px-1.5 py-0.5 rounded">
        {deal.dealType}
      </span>
      <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1.5">
        {deal.description}
      </p>
    </div>
  );
}
