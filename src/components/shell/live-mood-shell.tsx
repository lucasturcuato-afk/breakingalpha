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
  mobileFullBleed = false,
  children,
}: {
  pageTitle: string;
  /**
   * Pass-through to AppShell. Additive, defaulting to false, so every existing
   * caller keeps the exact chrome it has today at every width. Set it and the
   * mood bar, topbar and footer are gated out below `md` only, for a page that
   * draws its own head. See the prop's own documentation on AppShell.
   */
  mobileFullBleed?: boolean;
  children: ReactNode;
}) {
  const { mood, moodHeadline, moodDetails } = useLiveMood();

  return (
    <AppShell
      pageTitle={pageTitle}
      mood={mood}
      moodHeadline={moodHeadline}
      moodDetails={moodDetails}
      mobileFullBleed={mobileFullBleed}
    >
      {children}
    </AppShell>
  );
}
