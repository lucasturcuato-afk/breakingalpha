"use client";

import { useState, useRef, useEffect } from "react";
import { Share2, Link as LinkIcon, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShareButtonProps {
  briefingId?: string;
  briefTitle?: string;
  briefType: "morning" | "evening";
}

/**
 * Share dropdown for Morning Brief + Evening Wrap.
 *
 * - "Copy link" copies the public share URL `${origin}/share/brief/{id}` and
 *   flashes a "Link copied" toast for 2s.
 * - "Open in mail client" uses `mailto:` with the brief title + public link.
 * - "Send via email..." is intended to delegate to the A7 ExportMenu send
 *   modal. Until A7 is merged we show a "Coming soon" toast.
 *
 * Click-outside-to-close pattern mirrors `UserMenu` in topbar.tsx.
 */
export function ShareButton({ briefingId, briefTitle, briefType }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  function buildShareUrl(): string {
    if (typeof window === "undefined") return "";
    if (briefingId) {
      return `${window.location.origin}/share/brief/${briefingId}`;
    }
    // Fallback: no public shareable URL yet — copy current page URL.
    return window.location.href;
  }

  const handleCopyLink = async () => {
    const url = buildShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch {
      // Older browsers / insecure contexts — soft-fail.
      showToast("Copy failed");
    }
    setOpen(false);
  };

  const handleMailto = () => {
    const url = buildShareUrl();
    const text = briefTitle || (briefType === "morning" ? "Signalera Morning Brief" : "Signalera Evening Wrap");
    const subject = "Signalera+Morning+Brief";
    const body = encodeURIComponent(`${text}\n\n${url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setOpen(false);
  };

  const handleSendEmail = () => {
    // A7 ExportMenu not yet merged in this worktree — stub per plan.
    showToast("Coming soon — merge A7 first");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <Button
        variant="secondary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 size={14} />
        Share
      </Button>

      {toast && (
        <span className="ml-2 font-sans text-[11px] text-gold font-semibold animate-pulse">
          {toast}
        </span>
      )}

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-10 w-48",
            "bg-cream dark:bg-elevated border border-border-base rounded-xl shadow-lg",
            "z-50 py-1.5 overflow-hidden",
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleCopyLink}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5",
              "font-sans text-[12px] font-medium text-text-secondary",
              "hover:bg-parchment-mid hover:text-espresso transition-colors",
              "cursor-pointer w-full text-left",
            )}
          >
            <LinkIcon size={14} className="text-text-faint" />
            Copy link
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleMailto}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5",
              "font-sans text-[12px] font-medium text-text-secondary",
              "hover:bg-parchment-mid hover:text-espresso transition-colors",
              "cursor-pointer w-full text-left",
            )}
          >
            <Mail size={14} className="text-text-faint" />
            Open in mail client
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleSendEmail}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5",
              "font-sans text-[12px] font-medium text-text-secondary",
              "hover:bg-parchment-mid hover:text-espresso transition-colors",
              "cursor-pointer w-full text-left",
            )}
          >
            <Send size={14} className="text-text-faint" />
            Send via email...
          </button>
        </div>
      )}
    </div>
  );
}

export default ShareButton;
