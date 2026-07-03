"use client";

/**
 * ExportMenu — dropdown trigger that replaces the "Export Brief" button on
 * Morning Brief and Evening Wrap pages. Offers: download PDF, send to self,
 * send to others (modal with chip input), preview HTML email (modal).
 *
 * Auth-gated: calls to /api/brief/* require a Supabase session. If the caller
 * does not pass `userEmail`, the "Send to myself" option is disabled.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExportMenuProps {
  /** Explicit briefing id. If omitted, the API falls back to `type`'s latest. */
  briefingId?: string | null;
  type: "morning" | "evening";
  /** Logged-in user's email; enables "Send to myself". */
  userEmail?: string | null;
  /** Optional className for the trigger button. */
  className?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Toast = { kind: "success" | "error"; text: string } | null;

export function ExportMenu({
  briefingId,
  type,
  userEmail,
  className,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [sendOthersOpen, setSendOthersOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function body() {
    const b: Record<string, unknown> = { briefing_type: type };
    if (briefingId) b.briefing_id = briefingId;
    return b;
  }

  async function handleDownloadPdf() {
    setBusy("pdf");
    setOpen(false);
    try {
      const res = await fetch("/api/brief/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const label = type === "evening" ? "evening-wrap" : "morning-brief";
      a.download = `signalera-${label}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast({ kind: "success", text: "PDF downloaded" });
    } catch (e) {
      // Log the verbose reason for ops triage; show a normalized message
      // to the user. The server-side log retains the full error.
      const verbose = e instanceof Error ? e.message : String(e);
      console.error("[export-pdf] failed:", verbose);
      setToast({ kind: "error", text: "PDF export failed. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function handleSendSelf() {
    if (!userEmail) return;
    setBusy("self");
    setOpen(false);
    try {
      const res = await fetch("/api/brief/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body(), to: [userEmail] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setToast({ kind: "success", text: `Sent to ${userEmail}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      setToast({ kind: "error", text: msg });
    } finally {
      setBusy(null);
    }
  }

  function openSendOthers() {
    setOpen(false);
    setSendOthersOpen(true);
  }

  function openPreview() {
    setOpen(false);
    setPreviewOpen(true);
  }

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <Button
        variant="secondary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy === "pdf"
          ? "Preparing PDF…"
          : busy === "self"
            ? "Sending…"
            : "↓ Export Brief"}
      </Button>
      {toast && (
        <span
          className={cn(
            "ml-2 font-sans text-[11px] font-semibold animate-pulse",
            toast.kind === "success" ? "text-gold" : "text-signal-dn",
          )}
        >
          {toast.text}
        </span>
      )}

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute left-0 top-10 w-56 z-50 py-1.5 overflow-hidden",
            "bg-cream dark:bg-elevated",
            "border border-border-base rounded-xl shadow-lg",
          )}
        >
          <MenuItem onClick={handleDownloadPdf} label="Download PDF" sub="as attachment" />
          <MenuItem
            onClick={handleSendSelf}
            label="Send to myself"
            sub={userEmail || "Sign in required"}
            disabled={!userEmail}
          />
          <MenuItem
            onClick={openSendOthers}
            label="Send to others…"
            sub="Email multiple recipients"
          />
          <MenuItem
            onClick={openPreview}
            label="Preview HTML email"
            sub="View or copy HTML"
          />
        </div>
      )}

      {sendOthersOpen && (
        <SendOthersModal
          type={type}
          briefingId={briefingId ?? null}
          onClose={() => setSendOthersOpen(false)}
          onSuccess={(msg) => {
            setSendOthersOpen(false);
            setToast({ kind: "success", text: msg });
          }}
          onError={(msg) => setToast({ kind: "error", text: msg })}
        />
      )}
      {previewOpen && (
        <PreviewModal
          type={type}
          briefingId={briefingId ?? null}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Dropdown item ─────────────────────────────────────────────────────── */

function MenuItem({
  onClick,
  label,
  sub,
  disabled,
}: {
  onClick: () => void;
  label: string;
  sub?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-2.5 transition-colors",
        "font-sans text-[12px] font-medium",
        disabled
          ? "text-text-faint cursor-not-allowed"
          : "text-text-secondary hover:bg-parchment-mid hover:text-espresso cursor-pointer",
      )}
    >
      <div className="font-semibold text-text-primary">{label}</div>
      {sub ? (
        <div className="mt-0.5 text-[10px] font-normal text-text-faint truncate">
          {sub}
        </div>
      ) : null}
    </button>
  );
}

/* ── Modal primitive (portal) ──────────────────────────────────────────── */

/** Returns true once the component has hydrated on the client (SSR-safe). */
function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function Modal({
  children,
  onClose,
  title,
  maxWidth = "480px",
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  maxWidth?: string;
}) {
  const mounted = useIsClient();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-cream dark:bg-elevated border border-border-base rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxWidth }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-base">
          <h3 className="font-display text-[15px] font-bold text-text-primary">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-faint hover:text-text-primary text-lg leading-none cursor-pointer"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Send to others modal ──────────────────────────────────────────────── */

function SendOthersModal({
  type,
  briefingId,
  onClose,
  onSuccess,
  onError,
}: {
  type: "morning" | "evening";
  briefingId: string | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [input, setInput] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addFromInput(raw: string) {
    const tokens = raw
      .split(/[,\n\s;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const next = [...chips];
    const bad: string[] = [];
    for (const t of tokens) {
      if (!EMAIL_RE.test(t)) {
        bad.push(t);
        continue;
      }
      if (!next.includes(t)) next.push(t);
    }
    setChips(next);
    setErr(bad.length > 0 ? `Invalid: ${bad.join(", ")}` : null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (input.trim()) {
        e.preventDefault();
        addFromInput(input);
        setInput("");
      }
    } else if (e.key === "Backspace" && input === "" && chips.length > 0) {
      setChips(chips.slice(0, -1));
    }
  }

  function removeChip(email: string) {
    setChips(chips.filter((c) => c !== email));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Pull pending input into chips first.
    let to = [...chips];
    if (input.trim()) {
      const tokens = input
        .split(/[,\n\s;]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const valid = tokens.filter((t) => EMAIL_RE.test(t));
      to = [...to, ...valid.filter((t) => !to.includes(t))];
      const bad = tokens.filter((t) => !EMAIL_RE.test(t));
      if (bad.length > 0) {
        setErr(`Invalid: ${bad.join(", ")}`);
        return;
      }
      setInput("");
      setChips(to);
    }
    if (to.length === 0) {
      setErr("Add at least one recipient");
      return;
    }
    setSending(true);
    setErr(null);
    try {
      const b: Record<string, unknown> = {
        briefing_type: type,
        to,
      };
      if (briefingId) b.briefing_id = briefingId;
      if (subject.trim()) b.subject = subject.trim();
      const res = await fetch("/api/brief/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSuccess(`Sent to ${to.length} recipient${to.length > 1 ? "s" : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      setErr(msg);
      onError(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Send brief via email" onClose={onClose} maxWidth="520px">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-muted mb-1.5">
            Recipients
          </label>
          <div
            className={cn(
              "flex flex-wrap gap-1.5 p-2 min-h-[40px]",
              "border border-border-base rounded-lg focus-within:border-gold",
              "bg-white dark:bg-elevated",
            )}
            onClick={() =>
              (document.getElementById("exp-recipients") as HTMLInputElement)?.focus()
            }
          >
            {chips.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md bg-gold-muted text-text-primary border border-gold/20"
              >
                {c}
                <button
                  type="button"
                  onClick={() => removeChip(c)}
                  className="text-text-faint hover:text-text-primary cursor-pointer"
                  aria-label={`Remove ${c}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id="exp-recipients"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (input.trim()) {
                  addFromInput(input);
                  setInput("");
                }
              }}
              placeholder={
                chips.length === 0 ? "you@firm.com, colleague@firm.com" : ""
              }
              className="flex-1 min-w-[140px] bg-transparent outline-none font-sans text-[12px] text-text-primary"
            />
          </div>
          <p className="mt-1 text-[10px] text-text-faint">
            Comma, space, enter, or tab to add. Backspace to remove.
          </p>
        </div>
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-muted mb-1.5">
            Subject <span className="text-text-faint font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={
              type === "evening"
                ? "Signalera Evening Wrap"
                : "Signalera Morning Brief"
            }
            className={cn(
              "w-full px-3 py-2 text-[12px] rounded-lg border border-border-base bg-white dark:bg-elevated",
              "text-text-primary placeholder:text-text-faint focus:border-gold outline-none",
            )}
          />
        </div>
        {err && (
          <p className="text-[11px] text-signal-dn font-semibold">{err}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Preview modal ─────────────────────────────────────────────────────── */

function PreviewModal({
  type,
  briefingId,
  onClose,
}: {
  type: "morning" | "evening";
  briefingId: string | null;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ briefing_type: type });
    if (briefingId) params.set("briefing_id", briefingId);
    fetch(`/api/brief/send-email?${params}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!cancelled) setHtml(data.html ?? "");
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Preview failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [type, briefingId]);

  async function copyHtml() {
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Copy failed — select manually");
    }
  }

  return (
    <Modal title="HTML email preview" onClose={onClose} maxWidth="720px">
      {err && (
        <p className="text-[12px] text-signal-dn font-semibold mb-2">{err}</p>
      )}
      {!html && !err && (
        <p className="text-[12px] text-text-muted">Loading preview…</p>
      )}
      {html && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-text-muted">
              Rendered with the same template sent via Resend.
            </p>
            <Button variant="secondary" size="sm" onClick={copyHtml}>
              {copied ? "Copied!" : "Copy HTML"}
            </Button>
          </div>
          <iframe
            title="Email preview"
            srcDoc={html}
            className="w-full h-[520px] border border-border-base rounded-lg bg-white"
            sandbox=""
          />
        </div>
      )}
    </Modal>
  );
}

export default ExportMenu;
