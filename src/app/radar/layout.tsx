import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Radar — Signalera",
};

/** Metadata-only pass-through, matching the house per-route layout
 *  convention. Each Radar page renders its own AppShell; the sub-tab bar
 *  is the shared RadarTabs component rendered inside each page. */
export default function RadarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
