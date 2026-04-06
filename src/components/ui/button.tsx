import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "gold" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-espresso text-cream hover:bg-espresso-light active:bg-espresso",
  secondary:
    "bg-parchment-mid text-text-primary border border-border-base hover:border-border-hover hover:bg-parchment",
  ghost:
    "text-text-secondary hover:text-text-primary hover:bg-parchment-mid",
  gold:
    "bg-gold text-cream hover:bg-gold-dark active:bg-gold-dark",
  danger:
    "bg-signal-dn text-white hover:bg-red-700 active:bg-red-800",
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
