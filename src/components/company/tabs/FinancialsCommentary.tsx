"use client";

/**
 * FinancialsCommentary -- "Generate commentary" control for the Financials tab.
 *
 * On click it POSTs the company name to /api/financials-commentary, which
 * generates SHORT descriptive commentary from ONLY that company's validated
 * XBRL (no web pool) and returns it after the compliance backstop has stripped
 * any prohibited language. The disclaimer always renders on this surface.
 *
 * Rendered only when the FINANCIALS_COMMENTARY_ENABLED flag is on (read
 * server-side in the page and passed as `enabled`); default OFF means this
 * control never mounts and the route is never called.
 */

import { useState } from "react";

interface FinancialsCommentaryProps {
  /** Canonical/display company name; the sole generator input key. */
  companyName: string;
  /** Server-read FINANCIALS_COMMENTARY_ENABLED. When false, renders nothing. */
  enabled: boolean;
}

interface CommentaryResponse {
  commentary?: string;
  disclaimer?: string;
  empty?: boolean;
  error?: string;
}

const DISCLAIMER_FALLBACK =
  "AI-generated commentary on the company's own reported figures. Not investment advice. Verify against the filings before acting.";

export function FinancialsCommentary({ companyName, enabled }: FinancialsCommentaryProps) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [commentary, setCommentary] = useState("");
  const [disclaimer, setDisclaimer] = useState(DISCLAIMER_FALLBACK);
  const [message, setMessage] = useState("");

  if (!enabled) return null;

  async function generate() {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/financials-commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companyName }),
      });
      const data = (await res.json()) as CommentaryResponse;
      if (!res.ok) {
        setState("error");
        setMessage(data.error ?? "Could not generate commentary.");
        return;
      }
      if (data.disclaimer) setDisclaimer(data.disclaimer);
      if (data.empty || !data.commentary) {
        setState("done");
        setCommentary("");
        setMessage("No commentary could be generated from the reported figures.");
        return;
      }
      setCommentary(data.commentary);
      setState("done");
    } catch {
      setState("error");
      setMessage("Could not generate commentary.");
    }
  }

  return (
    <div
      data-testid="financials-commentary"
      className="mt-3 rounded-md border border-border-subtle bg-cream-hi p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-text-primary">Commentary</p>
          <p className="text-[11px] text-text-muted">
            Descriptive summary of this company&rsquo;s own reported XBRL figures.
          </p>
        </div>
        <button
          type="button"
          data-testid="financials-commentary-generate"
          onClick={generate}
          disabled={state === "loading"}
          className={[
            "shrink-0 px-[11px] py-[5px] rounded-[5px] border text-[12px] font-sans font-medium",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1",
            state === "loading"
              ? "border-border-base bg-transparent text-text-muted"
              : "border-gold-border bg-cream-hi text-espresso hover:border-border-hi",
          ].join(" ")}
        >
          {state === "loading"
            ? "Generating..."
            : state === "done" || state === "error"
              ? "Regenerate"
              : "Generate commentary"}
        </button>
      </div>

      {commentary && (
        <p
          data-testid="financials-commentary-text"
          className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-text-secondary"
        >
          {commentary}
        </p>
      )}

      {message && (
        <p className="mt-3 text-[12px] text-text-muted" data-testid="financials-commentary-message">
          {message}
        </p>
      )}

      {(commentary || state === "done") && (
        <p
          data-testid="financials-commentary-disclaimer"
          className="mt-3 border-t border-border-subtle pt-2 text-[11px] italic text-text-muted"
        >
          {disclaimer}
        </p>
      )}
    </div>
  );
}
