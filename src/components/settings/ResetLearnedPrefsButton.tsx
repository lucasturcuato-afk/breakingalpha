"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ResetLearnedPrefsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleReset() {
    if (!confirm("Clear all learned sector weights? Your explicit preferences will stay.")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/user-profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inferred_sector_weights: {} }),
      });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      setDone(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="font-sans text-[10px] text-signal-dn">{error}</span>}
      {done && <span className="font-sans text-[10px] text-signal-up">Cleared.</span>}
      <button
        type="button"
        onClick={handleReset}
        disabled={pending}
        className="font-sans text-[11px] font-semibold text-text-muted hover:text-signal-dn transition-colors cursor-pointer disabled:opacity-50"
      >
        Reset learned
      </button>
    </div>
  );
}
