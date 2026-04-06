import { cn } from "@/lib/utils";
import Link from "next/link";

export interface WatchlistItem {
  ticker: string;
  name: string;
  price: string;
  change: number;
}

interface WatchlistWidgetProps {
  items?: WatchlistItem[];
}

export function WatchlistWidget({
  items = [
    { ticker: "AAPL", name: "Apple Inc.", price: "189.84", change: 1.23 },
    { ticker: "NVDA", name: "NVIDIA Corp.", price: "875.28", change: -2.41 },
    { ticker: "MSFT", name: "Microsoft", price: "378.91", change: 0.65 },
    { ticker: "TSLA", name: "Tesla Inc.", price: "248.42", change: -1.87 },
    { ticker: "META", name: "Meta Platforms", price: "485.20", change: 0.92 },
  ],
}: WatchlistWidgetProps) {
  return (
    <div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const isPositive = item.change >= 0;
          return (
            <Link
              key={item.ticker}
              href={`/company/${item.ticker}`}
              className={cn(
                "flex items-center gap-2 py-2 px-2 rounded-lg",
                "transition-colors duration-[var(--duration-fast)]",
                "hover:bg-parchment-mid",
              )}
            >
              <div className="flex-1 min-w-0">
                <span className="font-data text-[12px] font-bold text-text-primary">
                  {item.ticker}
                </span>
                <span className="font-sans text-[10px] text-text-muted ml-1.5">
                  {item.name}
                </span>
              </div>
              <span className="font-data text-[12px] text-text-primary">
                {item.price}
              </span>
              <span
                className={cn(
                  "font-data text-[10px] font-semibold min-w-[48px] text-right",
                  isPositive ? "text-signal-up" : "text-signal-dn",
                )}
              >
                {isPositive ? "+" : ""}{item.change.toFixed(2)}%
              </span>
            </Link>
          );
        })}
      </div>

      <Link
        href="/watchlist"
        className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        Full watchlist →
      </Link>
    </div>
  );
}
