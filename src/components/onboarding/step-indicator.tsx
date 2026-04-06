import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: totalSteps }).map((_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isComplete = step < currentStep;

        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center",
                "font-sans text-[11px] font-bold transition-all duration-[var(--duration-base)]",
                isActive && "bg-gold text-cream",
                isComplete && "bg-espresso text-cream",
                !isActive && !isComplete && "bg-parchment-mid border border-border-base text-text-faint",
              )}
            >
              {isComplete ? "✓" : step}
            </div>
            {step < totalSteps && (
              <div
                className={cn(
                  "w-8 h-0.5 rounded-full transition-colors duration-[var(--duration-base)]",
                  step < currentStep ? "bg-espresso" : "bg-border-base",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
