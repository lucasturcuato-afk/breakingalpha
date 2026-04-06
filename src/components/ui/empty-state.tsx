import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-6 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 text-text-faint">{icon}</div>
      )}
      <h3 className="font-display text-[15px] font-bold text-text-primary mb-1">
        {title}
      </h3>
      {description && (
        <p className="font-sans text-[12px] text-text-muted max-w-[280px] leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { EmptyState, type EmptyStateProps };
