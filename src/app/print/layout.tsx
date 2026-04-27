import type { Metadata } from "next";
import "./print.css";

/**
 * Minimal layout for the Puppeteer-driven `/print/*` routes. The global
 * app layout is still active (it owns the font-variable CSS vars and
 * body resets), but we intentionally do NOT mount AppShell / Sidebar /
 * TopBar / TickerStrip here — the PDF must contain only the brief
 * content, not navigation chrome.
 *
 * Noindex metadata belts-and-suspenders the HMAC token gate: even if
 * the URL leaked, crawlers won't surface it.
 */

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  title: "Signalera — Print View",
};

export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="print-root">{children}</div>;
}
