/**
 * site-url.ts   resolves the canonical public origin for email-embedded
 * links (view-in-browser, unsubscribe).
 *
 * Order:
 *   1. NEXT_PUBLIC_SITE_URL (preferred, when set in prod)
 *   2. Hardcoded https://signalera.ai fallback
 *
 * The hardcoded fallback is intentional: the env var is not yet set in
 * prod (flagged in docs/HANDOFF.md as a Noah-pending action), and we
 * cannot ship absolute-URL emails without one. Once Noah sets the env
 * var, this fallback is unreachable in prod.
 */

const HARDCODED_FALLBACK = "https://signalera.ai";

export function getSiteUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (fromEnv) {
    // Strip trailing slash so callers can do `${getSiteUrl()}/path`.
    return fromEnv.replace(/\/+$/, "");
  }
  return HARDCODED_FALLBACK;
}
