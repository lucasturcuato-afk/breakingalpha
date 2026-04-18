"use client";

import { type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthGateProps {
  children: ReactNode;
  message?: string;
  buttonLabel?: string;
}

export function AuthGate({
  children,
  message = "Sign in to unlock full market intelligence",
  buttonLabel = "Sign in to continue",
}: AuthGateProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div style={{ filter: "blur(3px)", pointerEvents: "none", userSelect: "none", opacity: 0.55 }}>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl" style={{ background: 'rgba(247,242,235,0.60)' }}>
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <div className="w-9 h-9 rounded-full bg-gold-muted border border-gold-border flex items-center justify-center">
            <Lock size={15} className="text-gold" />
          </div>
          <p className="font-sans text-[12px] text-text-secondary max-w-[220px] leading-snug">
            {message}
          </p>
          <Button variant="gold" size="sm" onClick={() => { window.location.href = "/auth"; }}>
            {buttonLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
