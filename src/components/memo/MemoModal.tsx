"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X, Copy, Check, Download, Loader2 } from "lucide-react";

export type MemoType = "deal" | "thesis" | "brief" | "article" | "company";

interface MemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  type: MemoType;
  systemPrompt?: string;
}

const TYPE_LABELS: Record<MemoType, string> = {
  deal: "Deal Memo",
  thesis: "Thesis Memo",
  brief: "Market Brief",
  article: "Article Analysis",
  company: "Company Brief",
};

export function MemoModal({ isOpen, onClose, title, content, type, systemPrompt }: MemoModalProps) {
  const [mounted, setMounted] = useState(false);
  const [memo, setMemo] = useState("");
  const [displayed, setDisplayed] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Fetch memo on open
  useEffect(() => {
    if (!isOpen || !content) return;
    setMemo("");
    setDisplayed("");
    setError("");
    setLoading(true);
    setCopied(false);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: content.slice(0, 1500), type, ...(systemPrompt ? { systemPrompt } : {}) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `API error: ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled && data.memo) {
          setMemo(data.memo);
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
  }, [isOpen, content, type]);

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
            <div className="font-sans text-[13px] text-text-secondary leading-[1.85] whitespace-pre-wrap">
              {displayed.split(/(\*\*.*?\*\*)/).map((part, i) => {
                if (part.startsWith("**") && part.endsWith("**")) {
                  return (
                    <strong key={i} className="font-bold text-espresso">
                      {part.slice(2, -2)}
                    </strong>
                  );
                }
                return part;
              })}
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
