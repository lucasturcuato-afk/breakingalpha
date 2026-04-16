"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X, Copy, Check, Download, Loader2 } from "lucide-react";

function inlineBold(text: string, keyBase: string): (string | JSX.Element)[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyBase}-b-${i}`} className="font-bold text-espresso">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function renderMarkdown(text: string, isStreaming: boolean): JSX.Element[] {
  const allLines = text.split("\n");
  const lines = isStreaming ? allLines.slice(0, -1) : allLines;

  const elements: JSX.Element[] = [];
  let paragraphLines: string[] = [];
  let bulletLines: string[] = [];
  let bulletStartIdx = 0;

  function flushParagraph(idx: number) {
    if (paragraphLines.length === 0) return;
    const combined = paragraphLines.join(" ").trim();
    if (combined) {
      elements.push(
        <p key={`p-${idx}`} className="font-sans text-[13px] text-text-secondary leading-[1.85] mb-2">
          {inlineBold(combined, `p-${idx}`)}
        </p>,
      );
    }
    paragraphLines = [];
  }

  function flushBullets(idx: number) {
    if (bulletLines.length === 0) return;
    elements.push(
      <ul key={`ul-${bulletStartIdx}`} className="list-disc ml-4 space-y-1 mb-2">
        {bulletLines.map((b, j) => (
          <li key={`li-${bulletStartIdx}-${j}`} className="font-sans text-[13px] text-text-secondary leading-[1.85]">
            {inlineBold(b, `li-${bulletStartIdx}-${j}`)}
          </li>
        ))}
      </ul>,
    );
    bulletLines = [];
    bulletStartIdx = idx;
  }

  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      flushParagraph(i);
      flushBullets(i);
      elements.push(
        <h2 key={`h2-${i}`} className="font-display text-[15px] font-bold text-espresso mt-5 mb-2">
          {inlineBold(line.slice(3).trim(), `h2-${i}`)}
        </h2>,
      );
      return;
    }
    if (line.startsWith("# ")) {
      flushParagraph(i);
      flushBullets(i);
      elements.push(
        <h1 key={`h1-${i}`} className="font-display text-[17px] font-bold text-espresso mt-5 mb-2">
          {inlineBold(line.slice(2).trim(), `h1-${i}`)}
        </h1>,
      );
      return;
    }
    if (/^[*-] /.test(line)) {
      flushParagraph(i);
      if (bulletLines.length === 0) bulletStartIdx = i;
      bulletLines.push(line.slice(2));
      return;
    }
    if (line.trim() === "") {
      flushParagraph(i);
      flushBullets(i);
      return;
    }
    // Plain text — flush bullets first, accumulate paragraph
    flushBullets(i);
    paragraphLines.push(line);
  });

  flushParagraph(lines.length);
  flushBullets(lines.length);

  return elements;
}

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
  const [displayed, setDisplayed] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Keep onGenerated ref in sync to avoid stale closure bugs
  const onGeneratedRef = useRef(onGenerated);
  useEffect(() => { onGeneratedRef.current = onGenerated; });

  useEffect(() => { setMounted(true); }, []);

  // Fetch memo on open (or use preloadedMemo if provided)
  useEffect(() => {
    if (!isOpen || !content) return;
    setMemo("");
    setDisplayed("");
    setError("");
    setCopied(false);

    // If a preloaded memo was provided, skip the API call entirely.
    if (preloadedMemo) {
      // loading stays false — we never called setLoading(true) above
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

  // Typewriter effect at 12ms/char
  useEffect(() => {
    if (!memo) { setDisplayed(""); return; }
    setDisplayed("");
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(memo.slice(0, i));
      if (i >= memo.length) clearInterval(id);
    }, 12);
    return () => clearInterval(id);
  }, [memo]);

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
        className="bg-white border border-border-base rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
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
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={24} className="text-gold animate-spin" />
              <p className="font-data text-[10px] text-text-faint uppercase tracking-widest">
                Generating {TYPE_LABELS[type]}...
              </p>
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
            <div className="font-sans text-[13px] text-text-secondary leading-[1.85]">
              {renderMarkdown(displayed, memo.length > 0 && displayed.length < memo.length)}
              {memo && displayed.length < memo.length && (
                <span className="inline-block w-0.5 h-3.5 bg-gold ml-0.5 animate-pulse align-text-bottom" />
              )}
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
