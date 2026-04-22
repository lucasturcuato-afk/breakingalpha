import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Canonical variants: `primary`, `secondary`, `tertiary`.
 * Legacy aliases kept for backwards-compat (do not use in new code):
 *   - `ghost`  → alias of `tertiary`
 *   - `gold`   → alias of `primary`
 *   - `danger` → kept (semantic, uses `signal-dn`)
 */
type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "ghost"
  | "gold"
  | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  // Heritage Gold solid — main CTAs (Refresh, Generate Memo, Add Deal, Sign In, Export Brief, Share).
  primary:
    "bg-gold text-cream hover:bg-gold-light active:bg-gold-dark active:scale-[0.98] dark:hover:shadow-[0_0_16px_rgba(212,168,75,0.35)]",
  // Outlined, transparent bg — alternative actions (Export, Add Note, Archive).
  secondary:
    "bg-transparent text-text-primary border border-border-base hover:border-gold-border hover:bg-gold-muted active:scale-[0.98]",
  // Text link — Customize, View all, Read full brief.
  tertiary:
    "bg-transparent text-gold hover:text-gold-dark hover:underline underline-offset-4 p-0 h-auto",
  /** @deprecated Legacy alias — use `tertiary`. Kept only for backwards compatibility. */
  ghost:
    "bg-transparent text-gold hover:text-gold-dark hover:underline underline-offset-4 p-0 h-auto",
  /** @deprecated Legacy alias — use `primary`. Kept only for backwards compatibility. */
  gold:
    "bg-gold text-cream hover:bg-gold-light active:bg-gold-dark active:scale-[0.98] dark:hover:shadow-[0_0_16px_rgba(212,168,75,0.35)]",
  danger:
    "bg-signal-dn text-white hover:bg-red-700 active:bg-red-800 active:scale-[0.98]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-[11px] font-semibold rounded-md gap-1.5",
  md: "h-8 px-4 text-[12px] font-semibold rounded-lg gap-2",
  lg: "h-10 px-5 text-[13px] font-semibold rounded-lg gap-2",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center font-sans whitespace-nowrap",
          "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          "disabled:opacity-50 disabled:pointer-events-none",
          "cursor-pointer",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize };
