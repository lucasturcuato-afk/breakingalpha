"use client";

/**
 * WebFallbackState (PR-E2): standalone presentational state for the
 * web-fallback flavor of company intel. Renders when the company has no
 * indexed articles and the page falls back to web search (gated by
 * NEXT_PUBLIC_WEB_FALLBACK_ENABLED, see PR #176).
 *
 * Props-driven; no fetch, no server-side calls. Consumers pass in:
 *   - `memo`: prose Markdown from /api/memo with `type=company-web`
 *     (NOT StructuredMemo -- the type=company-web branch in route.ts
 *     skips structured parsing and returns markdown only).
 *   - `sources`: web SearchResult[] from PR #176's web-fallback writer.
 *   - `aliasResolved`: optional { from, to } pair signaling that the
 *     user's typed query was redirected to a canonical alias. The signal
 *     exists server-side (route.ts:115-165) but is not yet propagated to
 *     this surface; banner is rendered presentational-ready so the
 *     follow-up wiring PR can flip it on with a single prop.
 *   - `canonicalName`: name used in headings (post-PR-#177 normalization).
 *
 * Citation markers in `memo` use the `[w<N>]` form (purple, `--purple`
 * token from PR-A0). Each marker number maps to the source list rendered
 * below the prose. Reuses the `Cite` primitive via WebFallbackCitation.
 */

import { WebFallbackBanner } from "./WebFallbackBanner";
import { WebFallbackCitation } from "./WebFallbackCitation";

export interface WebFallbackSource {
  url: string;
  title: string;
  source: string;
  publishedAt?: string | null;
}

interface WebFallbackStateProps {
  /** Prose Markdown from /api/memo (type=company-web). May contain `[w1]` markers. */
  memo: string;
  /** Web search results, ordered to match marker numbers (1-indexed). */
  sources: ReadonlyArray<WebFallbackSource>;
  /** Display name for the company (post-normalization). */
  canonicalName: string;
  /** When set, renders the alias-resolved banner above the brief. */
  aliasResolved?: { from: string; to: string };
  /** Optional click handler for citation markers. */
  onCiteClick?: (n: number) => void;
}

const MONO = "var(--font-mono), ui-monospace, monospace";
const SANS = "var(--font-sans), sans-serif";

function extractTldr(memo: string): { tldr: string | null; body: string } {
  // First non-empty paragraph is treated as TL;DR. Mirrors the structured
  // memo's tldr-first convention so the visual surface stays consistent.
  const trimmed = memo.trim();
  if (!trimmed) return { tldr: null, body: "" };
  const paras = trimmed.split(/\n{2,}/);
  const first = paras[0]?.replace(/^\s*(TL;?DR[:\s-]*)/i, "").trim() ?? null;
  const body = paras.slice(1).join("\n\n").trim();
  return { tldr: first, body };
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function WebFallbackState({ memo, sources, canonicalName, aliasResolved, onCiteClick }: WebFallbackStateProps) {
  const { tldr, body } = extractTldr(memo);
  const sourceCount = sources.length;
  const handleClick = onCiteClick ?? (() => {});

  return (
    <div
      data-testid="web-fallback-state"
      className="bg-cream-hi border border-border-base rounded-lg p-4"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {aliasResolved ? (
        <WebFallbackBanner from={aliasResolved.from} to={aliasResolved.to} />
      ) : null}

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ fontFamily: "var(--font-display), serif", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          {canonicalName}
        </h3>
        <span
          style={{
            padding: "1px 6px",
            borderRadius: 2,
            background: "rgba(139,92,246,0.06)",
            border: "1px solid var(--purple)",
            color: "var(--purple)",
            fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          }}
        >
          WEB-SOURCED
        </span>
      </div>

      {tldr ? (
        <div
          data-testid="web-fallback-tldr"
          style={{
            padding: "11px 14px",
            background: "rgba(139,92,246,0.06)",
            border: "1px solid var(--purple)",
            borderRadius: 6,
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "var(--purple)", marginBottom: 5, textTransform: "uppercase" }}>
            TLDR
          </div>
          <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: "var(--text-primary)", margin: 0 }}>
            <WebFallbackCitation sourceCount={sourceCount} onCiteClick={handleClick}>{tldr}</WebFallbackCitation>
          </p>
        </div>
      ) : null}

      {body ? (
        <div style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
          <WebFallbackCitation sourceCount={sourceCount} onCiteClick={handleClick}>{body}</WebFallbackCitation>
        </div>
      ) : null}

      <p style={{ fontFamily: MONO, fontSize: 10, color: "var(--text-faint)", margin: 0 }}>
        Web-grounded. Auto-upgrades to article-grounded once indexed.
      </p>

      <ul
        data-testid="web-fallback-source-list"
        style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}
      >
        {sources.map((s, i) => {
          const n = i + 1;
          return (
            <li
              key={s.url}
              data-testid="web-fallback-source-row"
              style={{ display: "grid", gridTemplateColumns: "32px 1fr auto", gap: 8, alignItems: "baseline", fontFamily: SANS, fontSize: 12 }}
            >
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "var(--purple)" }}>[w{n}]</span>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "var(--text-primary)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {s.title}
              </a>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--text-faint)" }}>
                {hostname(s.url) || s.source}
                {s.publishedAt ? ` . ${s.publishedAt.slice(0, 10)}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
