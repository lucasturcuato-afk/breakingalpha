"use client";

import { type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthGateProps {
  children: ReactNode;
  message?: string;
}

export function AuthGate({
  children,
  message = "Sign in to unlock full market intelligence",
}: AuthGateProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Blurred content (teaser) */}
      <div
        style={{
          filter: "blur(5px)",
          pointerEvents: "none",
          userSelect: "none",
          opacity: 0.55,
        }}
      >
        {children}
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-parchment/75 rounded-2xl">
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <div className="w-9 h-9 rounded-full bg-gold-muted border border-gold-border flex items-center justify-center">
            <Lock size={15} className="text-gold" />
          </div>
          <p className="font-sans text-[12px] text-text-secondary max-w-[220px] leading-snug">
            {message}
          </p>
          <Button
            variant="gold"
            size="sm"
            onClick={() => {
              window.location.href = "/auth";
            }}
          >
            Sign in to unlock
          </Button>
        </div>
      </div>
    </div>
  );
}
