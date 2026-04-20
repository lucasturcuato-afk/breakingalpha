"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X, Copy, Check, Download, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

/* ── Markdown component overrides ── */

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="font-display text-[17px] font-bold text-text-primary mb-2 mt-4">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-display text-[15px] font-bold text-text-primary mb-2 mt-4">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-sans text-[11px] font-bold text-gold uppercase tracking-wider mb-2 mt-4">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="font-sans text-[13px] text-text-secondary leading-relaxed mb-3">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-bold text-gold">{children}</strong>
  ),
  hr: () => <hr className="border-border-base my-4" />,
  ul: ({ children }) => (
    <ul className="list-disc pl-4 space-y-1 text-text-secondary mb-3">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 space-y-1 text-text-secondary mb-3">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="font-sans text-[13px] leading-relaxed">{children}</li>
  ),
};

/* ── Section parser for ink fade animation ── */

function parseSections(text: string): string[] {
  // Split on markdown headings (# ## ###), keeping the heading with its body
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections;
}

/* ── Types ── */

export type MemoType = "deal" | "thesis" | "brief" | "article" | "company";

interface MemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  type: MemoType;
  systemPrompt?: string;
  /** If provided, skip the API call and display this text directly. */
  preloadedMemo?: string;
  /** Called with the full memo text after a successful API generation. */
  onGenerated?: (text: string) => void;
}

const TYPE_LABELS: Record<MemoType, string> = {
  deal: "Deal Memo",
  thesis: "Thesis Memo",
  brief: "Market Brief",
  article: "Article Analysis",
  company: "Company Brief",
};

export function MemoModal({ isOpen, onClose, title, content, type, systemPrompt, preloadedMemo, onGenerated }: MemoModalProps) {
  const [mounted, setMounted] = useState(false);
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [visibleSections, setVisibleSections] = useState<Set<number>>(new Set());

  // Keep onGenerated ref in sync to avoid stale closure bugs
  const onGeneratedRef = useRef(onGenerated);
  useEffect(() => { onGeneratedRef.current = onGenerated; });

  useEffect(() => { setMounted(true); }, []);

  // Fetch memo on open (or use preloadedMemo if provided)
  useEffect(() => {
    if (!isOpen || !content) return;
    setMemo("");
    setError("");
    setCopied(false);
    setVisibleSections(new Set());

    // If a preloaded memo was provided, skip the API call entirely.
    if (preloadedMemo) {
      setMemo(preloadedMemo);
      return;
    }

    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, type, ...(systemPrompt ? { systemPrompt } : {}) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `API error: ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled && data.memo) {
          setMemo(data.memo);
          onGeneratedRef.current?.(data.memo);
          // Fire-and-forget behavioral event
          try {
            void fetch("/api/user-events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event_type: "memo_generated",
                payload: { memo_type: type, title },
              }),
              keepalive: true,
            }).catch(() => {});
          } catch {
            // ignore
          }
        } else if (!cancelled) {
          setError("No memo content returned");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to generate memo");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, content, type, preloadedMemo]);

  // Parse sections from memo
  const sections = useMemo(() => parseSections(memo), [memo]);

  // Ink fade animation — stagger each section
  useEffect(() => {
    if (sections.length === 0) {
      setVisibleSections(new Set());
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < sections.length; i++) {
      const timer = setTimeout(() => {
        setVisibleSections((prev) => new Set(prev).add(i));
      }, i * 180);
      timers.push(timer);
    }

    return () => timers.forEach(clearTimeout);
  }, [sections]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(memo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [memo]);

  const handleExport = useCallback(() => {
    const blob = new Blob([memo], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}_memo.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [memo, title]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-espresso/50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-parchment border border-border-base rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-base flex-shrink-0">
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-gold font-bold mb-1">
              {TYPE_LABELS[type]}
            </p>
            <h2 className="font-display text-[20px] font-bold text-espresso">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-parchment-mid transition-colors cursor-pointer"
          >
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="text-gold animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <p className="font-sans text-[13px] text-signal-dn">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="font-sans text-[12px] text-text-muted hover:text-text-primary cursor-pointer mt-2"
              >
                Close
              </button>
            </div>
          ) : (
            <div>
              {sections.map((section, i) => (
                <div
                  key={i}
                  className="transition-all duration-[400ms] ease-out"
                  style={{
                    opacity: visibleSections.has(i) ? 1 : 0,
                    transform: visibleSections.has(i) ? "translateY(0)" : "translateY(8px)",
                  }}
                >
                  <ReactMarkdown components={mdComponents}>
                    {section}
                  </ReactMarkdown>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {memo && !loading && !error && (
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border-base flex-shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg",
                "font-data text-[10px] font-bold uppercase border cursor-pointer transition-colors",
                copied
                  ? "border-signal-up/30 bg-signal-up/10 text-signal-up"
                  : "border-gold/40 bg-gold-muted text-gold hover:bg-gold/10",
              )}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gold/40 bg-gold-muted text-gold font-data text-[10px] font-bold uppercase cursor-pointer hover:bg-gold/10 transition-colors"
            >
              <Download size={11} />
              Export .md
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border-base text-text-muted font-data text-[10px] font-bold uppercase cursor-pointer hover:text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
