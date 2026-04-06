import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-border-base bg-parchment-mid px-3 py-2",
          "font-sans text-[13px] text-text-primary placeholder:text-text-faint",
          "transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)]",
          "hover:border-border-hover",
          "focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold-border",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
export { Input, type InputProps };
