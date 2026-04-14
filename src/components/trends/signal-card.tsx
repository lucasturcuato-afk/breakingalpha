import { cn } from "@/lib/utils";
import { AnomalyBadge, type AnomalyLevel } from "./anomaly-badge";

export interface SignalData {
  id: string;
  title: string;
  anomaly: AnomalyLevel;
  description: string;
  sparkData?: number[];
  timestamp: string;
  industry_verticals: string[];
  activity_types: string[];
}

interface SignalCardProps {
  signal: SignalData;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 80;
  const h = 24;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-6 flex-shrink-0">
      <path
        d={`M ${points.join(" L ")}`}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SignalCard({ signal }: SignalCardProps) {
  const sparkColor =
    signal.anomaly === "critical" || signal.anomaly === "high"
      ? "var(--signal-dn)"
      : signal.anomaly === "medium"
        ? "var(--signal-warn)"
        : "var(--gold)";

  return (
    <div
      className={cn(
        "bg-white border border-border-base rounded-xl p-4",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_8px_rgba(201,146,42,0.06)]",
      )}
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <AnomalyBadge level={signal.anomaly} />
          {signal.industry_verticals.map((v) => (
            <span
              key={v}
              className="inline-flex items-center px-2 py-0.5 rounded-md border font-sans text-[9px] font-semibold text-teal-700 bg-teal-50 border-teal-200"
            >
              {v}
            </span>
          ))}
          {signal.activity_types.map((a) => (
            <span
              key={a}
              className="inline-flex items-center px-2 py-0.5 rounded-md border font-sans text-[9px] font-semibold text-amber-700 bg-amber-50 border-amber-200"
            >
              {a}
            </span>
          ))}
        </div>
        <span className="font-data text-[9px] text-text-faint">{signal.timestamp}</span>
      </div>

      {/* Title + sparkline */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-display text-[13px] font-bold text-espresso leading-snug flex-1">
          {signal.title}
        </h4>
        {signal.sparkData && signal.sparkData.length > 1 && (
          <MiniSparkline data={signal.sparkData} color={sparkColor} />
        )}
      </div>

      {/* Description */}
      <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1.5 line-clamp-2">
        {signal.description}
      </p>
    </div>
  );
}
