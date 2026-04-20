"use client";

import { useLiveMood } from "@/hooks/useLiveMood";
import { AppShell } from "@/components/shell";
import type { ReactNode } from "react";

/**
 * A thin client wrapper around AppShell that injects live mood data.
 * Use this in server components where the useLiveMood() hook cannot be called directly.
 */
export function LiveMoodShell({
  pageTitle,
  children,
}: {
  pageTitle: string;
  children: ReactNode;
}) {
  const { mood, moodHeadline, moodDetails } = useLiveMood();

  return (
    <AppShell
      pageTitle={pageTitle}
      mood={mood}
      moodHeadline={moodHeadline}
      moodDetails={moodDetails}
    >
      {children}
    </AppShell>
  );
}
