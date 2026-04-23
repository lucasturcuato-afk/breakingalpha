import { cn } from "@/lib/utils";

interface SectorSignalCardProps {
  sector: string;
  analysis: string;
  accentColor?: string;
}

const sectorColors: Record<string, string> = {
  "Technology M&A": "border-l-amber-400",
  "Venture Capital": "border-l-violet-400",
  "Private Equity": "border-l-blue-400",
  "Public Markets": "border-l-emerald-400",
  "Geopolitics & Macro": "border-l-red-400",
  "Fintech & Crypto": "border-l-cyan-400",
  "Healthcare & Biotech": "border-l-pink-400",
  "Energy & Climate": "border-l-green-400",
  "Consumer & Retail": "border-l-orange-400",
  "Real Estate & REITs": "border-l-slate-400",
};

export function SectorSignalCard({
  sector,
  analysis,
}: SectorSignalCardProps) {
  const borderClass = sectorColors[sector] ?? "border-l-border-base";

  return (
    <div
      className={cn(
        "p-4 rounded-xl border border-border-base bg-white dark:bg-elevated dark:border-border-default",
        "border-l-[3px]",
        borderClass,
      )}
    >
      <h4 className="font-sans text-[11px] font-bold uppercase tracking-wide text-text-primary dark:text-cream mb-2">
        {sector}
      </h4>
      <p className="font-sans text-[12px] text-text-secondary dark:text-[#e8e8e4] leading-relaxed">
        {analysis}
      </p>
    </div>
  );
}
