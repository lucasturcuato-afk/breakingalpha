import { cn } from "@/lib/utils";
import { forwardRef, type HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white border border-border-base rounded-2xl",
          interactive && [
            "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
            "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
          ],
          className,
        )}
        {...props}
      />
    );
  },
);

Card.displayName = "Card";

function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-4 pt-4 pb-2", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-4 pb-4", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-4 py-3 border-t border-border-subtle flex items-center",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardContent, CardFooter, type CardProps };
