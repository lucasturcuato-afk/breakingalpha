import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn("tracking-tight", className)}
      style={{ fontFamily: "Georgia, serif", fontSize: "20px", fontWeight: 800, color: "var(--espresso)" }}
    >
      Signal<span style={{ color: "var(--gold)" }}>era</span>
    </span>
  );
}
