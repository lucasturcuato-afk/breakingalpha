"use client";

import Link from "next/link";

interface TickerPreviewCardProps {
  ticker: string;
  name: string;
  price?: string;
  pct?: number;
  articleCount?: number;
  href: string;
}

export function TickerPreviewCard({ ticker, name, price, pct, articleCount = 20, href }: TickerPreviewCardProps) {
  const pctColor = pct == null ? 'var(--text-muted)' : pct >= 0 ? '#16a34a' : '#dc2626';
  const pctSign = pct != null && pct >= 0 ? '+' : '';

  return (
    <Link href={href} className="block bg-white border border-border-base rounded-xl p-3.5 hover:border-border-hover transition-colors group">
      <div className="flex items-start justify-between mb-1">
        <span className="font-data text-[13px] font-semibold text-espresso">{ticker}</span>
        {articleCount != null && (
          <span className="font-data text-[10px] px-1.5 py-0.5 rounded bg-gold-muted border border-gold-border text-gold">
            {articleCount}+ articles
          </span>
        )}
      </div>
      <p className="font-sans text-[11px] text-text-faint mb-2">{name}</p>
      <div className="flex items-baseline gap-2">
        <span className="font-data text-[15px] font-semibold text-espresso">
          {price ? `$${price}` : "—"}
        </span>
        {pct != null && (
          <span className="font-data text-[12px] font-semibold" style={{ color: pctColor }}>
            {pctSign}{pct.toFixed(2)}%
          </span>
        )}
      </div>
    </Link>
  );
}
