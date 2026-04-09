"use client";

import { useState, useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModal";
import { getSectorStyle } from "@/lib/sector-colors";
import type { ThesisItem } from "./thesis-types";

// ── Helpers ──────────────────────────────────────────────

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function deriveScore(conviction: string): number {
  return conviction === "BULLISH" ? 82 : conviction === "BEARISH" ? 28 : 50;
}

function convictionToSentiment(conviction: string): string {
  switch (conviction) {
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    default: return "watch";
  }
}

interface RelatedArticle {
  id: string;
  title: string;
  source?: string;
  published_at?: string;
  summary?: string;
  sentiment?: string;
  sector?: string;
}

function getEvidenceTag(article: RelatedArticle, thesis: ThesisItem) {
  const as = (article.sentiment || "neutral").toLowerCase();
  const ts = convictionToSentiment(thesis.conviction);
  if (as === ts || (as === "positive" && ts === "bullish") || (as === "negative" && ts === "bearish"))
    return { label: "Supports", dotColor: "bg-signal-up", pillClass: "bg-signal-up/10 text-signal-up" };
  if ((as === "bullish" && ts === "bearish") || (as === "bearish" && ts === "bullish") || (as === "positive" && ts === "bearish") || (as === "negative" && ts === "bullish"))
    return { label: "Contradicts", dotColor: "bg-signal-dn", pillClass: "bg-signal-dn/10 text-signal-dn" };
  return { label: "Neutral", dotColor: "bg-signal-warn", pillClass: "bg-signal-warn/10 text-signal-warn" };
}

function getSectorSuggestions(sector: string | undefined): string[] {
  const base = (sector || "").toLowerCase();
  if (base.includes("tech") || base.includes("ai")) return ["AI funding", "tech M&A", "semiconductor", "cloud computing"];
  if (base.includes("health") || base.includes("bio")) return ["biotech M&A", "FDA approval", "pharma deals", "clinical trials"];
  if (base.includes("energy")) return ["oil prices", "OPEC", "energy transition", "LNG"];
  if (base.includes("real estate") || base.includes("re")) return ["CMBS", "office vacancy", "mortgage rates", "REIT"];
  if (base.includes("private equity") || base.includes("pe")) return ["LBO", "private equity exits", "buyout", "PE fundraising"];
  if (base.includes("macro") || base.includes("geo")) return ["Fed policy", "inflation", "geopolitics", "interest rates"];
  if (base.includes("crypto") || base.includes("fintech")) return ["crypto regulation", "DeFi", "stablecoin", "fintech IPO"];
  return ["market news", sector || "markets", "earnings", "M&A deals"];
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const map: Record<string, string> = {
    bullish: "bg-signal-up/10 text-signal-up",
    bearish: "bg-signal-dn/10 text-signal-dn",
    watch: "bg-signal-warn/10 text-signal-warn",
  };
  return (
    <span className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${map[sentiment] || map.watch}`}>
      {sentiment}
    </span>
  );
}

// ── Component ────────────────────────────────────────────

interface ThesisDetailPanelProps {
  thesis: ThesisItem | null;
  articles: RelatedArticle[];
  onArchive: (id: string) => void;
}

export function ThesisDetailPanel({ thesis, articles, onArchive }: ThesisDetailPanelProps) {
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [generatingMemo, setGeneratingMemo] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoContent, setMemoContent] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const noteSaveTimer = useRef<NodeJS.Timeout | null>(null);

  // Load note from localStorage when thesis changes
  useEffect(() => {
    if (!thesis?.id) return;
    const saved = localStorage.getItem(`thesis_note_${thesis.id}`) || "";
    setNoteText(saved);
    setNoteSaved(false);
    setConfirmArchive(false);
  }, [thesis?.id]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleNoteChange = (val: string) => {
    setNoteText(val);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      localStorage.setItem(`thesis_note_${thesis!.id}`, val);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    }, 800);
  };

  const handleSaveNoteToThesis = async () => {
    if (!thesis?.id || !noteText.trim()) return;
    setSavingNote(true);
    try {
      const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      await supabase.from("theses").update({ catalyst_note: noteText }).eq("id", thesis.id);
      showToast("Saved to thesis");
    } catch (e) {
      console.error(e);
    } finally {
      setSavingNote(false);
    }
  };

  const handleAddNote = () => {
    notesRef.current?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => notesRef.current?.focus(), 300);
  };

  const handleArchive = async () => {
    if (!thesis?.id) return;
    try {
      const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      await supabase.from("theses").update({ status: "archived" }).eq("id", thesis.id);
      showToast("Archived");
      setTimeout(() => onArchive(thesis.id), 500);
    } catch (e) {
      console.error(e);
      showToast("Failed to archive");
      setConfirmArchive(false);
    }
  };

  const handleGenerateMemo = async () => {
    if (!thesis) return;
    setGeneratingMemo(true);
    try {
      const sentiment = convictionToSentiment(thesis.conviction);
      const score = deriveScore(thesis.conviction);
      const evidenceText = articles.length > 0
        ? articles.map((a, i) => `${i + 1}. ${a.title} (${a.source ?? ""}, ${a.sentiment ?? "neutral"}) — ${(a.summary ?? "").slice(0, 120)}`).join("\n")
        : "No related articles available.";
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "thesis",
          systemPrompt: `You are a senior buy-side equity research analyst writing a formal investment thesis memo. Use professional language. Structure with these exact sections:\n\n**INVESTMENT THESIS**\nState the core thesis in 2-3 sentences.\n\n**MARKET CONTEXT & RATIONALE**\nExplain the macro and sector backdrop.\n\n**EVIDENCE BASE**\nList supporting evidence from recent market developments.\n\n**RISK FACTORS**\nWhat could invalidate this thesis? List 2-3 key risks.\n\n**CATALYST TIMELINE**\nWhat events will confirm or deny this thesis?\n\n**RECOMMENDATION**\nBull/Bear/Watch with conviction level and suggested position sizing guidance.`,
          content: `THESIS: ${thesis.title}\n\nANALYSIS: ${thesis.summary}\n\nSECTOR: ${thesis.sector}\nSENTIMENT: ${sentiment}\nCONVICTION SCORE: ${score}/100\nCATALYST: ${thesis.catalyst_note || "Not specified"}\n\nEVIDENCE FROM LIVE FEED:\n${evidenceText}`,
        }),
      });
      const data = await res.json();
      const text = data.memo || data.content || data.result || "No memo generated.";
      setMemoContent(text);
      setMemoOpen(true);
    } catch (e) {
      console.error(e);
      showToast("Failed to generate memo");
    } finally {
      setGeneratingMemo(false);
    }
  };

  const handleRegenerate = async () => {
    if (!thesis?.id) return;
    setRegenerating(true);
    try {
      const res = await fetch("/api/thesis-regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesisId: thesis.id }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      showToast("Regenerated");
    } catch (e) {
      console.error(e);
      showToast("Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  };

  // ── Empty state ──

  if (!thesis) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted font-sans text-sm gap-2">
        <span>Select a thesis to view details</span>
      </div>
    );
  }

  // ── Derived values ──

  const score = deriveScore(thesis.conviction);
  const sentiment = convictionToSentiment(thesis.conviction);
  const scoreColor = score >= 80 ? "#B8860B" : score < 50 ? "#ef4444" : "#888";

  return (
    <div className="flex flex-col h-full border border-border-base rounded-2xl bg-white overflow-hidden relative">

      {/* HEADER */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border-base">
        <div className="flex items-start gap-3">
          {/* Score ring */}
          <div
            className="w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 font-mono font-semibold text-sm"
            style={{ borderColor: scoreColor, color: scoreColor }}
          >
            {score}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-sans font-semibold text-[13px] text-text-primary leading-snug mb-1">
              {thesis.title}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <SentimentBadge sentiment={sentiment} />
              <span
                style={getSectorStyle(thesis.sector)}
                className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
              >
                {thesis.sector}
              </span>
              <span className="font-sans text-[10px] text-text-muted">{thesis.updatedAt}</span>
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">

        {/* Full Analysis */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Full Analysis</div>
          <div className="font-sans text-[12px] text-text-primary leading-relaxed">{thesis.rationale || thesis.summary}</div>
        </div>

        <div className="h-px bg-border-base" />

        {/* Live Evidence Feed */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            Live Evidence Feed
          </div>
          {articles.length === 0 ? (
            <div className="flex flex-col gap-3">
              <div className="font-sans text-[11px] text-text-muted italic mb-1">
                No articles matched this sector yet. Try these:
              </div>
              <div className="flex flex-wrap gap-2">
                {getSectorSuggestions(thesis.sector).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => window.open(`/live-feed?q=${encodeURIComponent(suggestion)}`, "_self")}
                    className="font-sans text-[10px] px-2.5 py-1 rounded-full border border-border-base hover:border-gold hover:text-gold text-text-secondary transition-colors cursor-pointer"
                  >
                    {suggestion} &rarr;
                  </button>
                ))}
              </div>
              <div className="font-sans text-[11px] text-text-muted mt-1">
                Or{" "}
                <button type="button" onClick={handleRegenerate} className="text-gold hover:underline cursor-pointer">
                  regenerate this thesis
                </button>{" "}
                to refresh evidence.
              </div>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-base">
              {articles.map((article) => {
                const tag = getEvidenceTag(article, thesis);
                return (
                  <div key={article.id} className="flex items-start gap-2 py-2">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${tag.dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-[11px] font-medium text-text-primary leading-snug mb-0.5">{article.title}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-sans text-[9px] text-text-muted">
                          {article.source}{article.published_at ? ` \u00b7 ${relativeTime(article.published_at)}` : ""}
                        </span>
                        <span className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${tag.pillClass}`}>
                          {tag.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="h-px bg-border-base" />

        {/* Catalyst */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Catalyst</div>
          <div className="font-sans text-[12px] text-text-primary">
            {thesis.catalyst_note || "No catalyst note yet \u2014 click Regenerate to generate one."}
          </div>
        </div>

        <div className="h-px bg-border-base" />

        {/* Notes */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Your Notes</div>
          <textarea
            ref={notesRef}
            value={noteText}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="Add your notes on this thesis..."
            className="w-full min-h-[80px] font-sans text-[12px] text-text-primary bg-parchment-mid border border-border-base rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-gold placeholder:text-text-muted transition-colors"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className={`font-sans text-[10px] transition-opacity duration-300 ${noteSaved ? "text-signal-up opacity-100" : "opacity-0"}`}>
              &#10003; Saved
            </span>
            {noteText.trim() && (
              <button
                type="button"
                onClick={handleSaveNoteToThesis}
                disabled={savingNote}
                className="font-sans text-[10px] text-gold hover:text-gold-dark transition-colors cursor-pointer"
              >
                {savingNote ? "Saving..." : "\u2191 Save to thesis"}
              </button>
            )}
          </div>
        </div>

      </div>

      {/* FOOTER */}
      <div className="flex-shrink-0 border-t border-border-base px-4 py-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleGenerateMemo}
          disabled={generatingMemo}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors disabled:opacity-50 cursor-pointer"
        >
          {generatingMemo ? "Generating..." : "\u2726 Generate Memo"}
        </button>
        <button
          type="button"
          onClick={handleAddNote}
          className="font-sans text-[11px] px-3 py-1.5 rounded-lg border border-border-base hover:border-border-hover text-text-secondary transition-colors cursor-pointer"
        >
          Add Note
        </button>
        {!confirmArchive ? (
          <button
            type="button"
            onClick={() => setConfirmArchive(true)}
            className="font-sans text-[11px] px-3 py-1.5 rounded-lg border border-border-base hover:border-border-hover text-text-secondary transition-colors cursor-pointer"
          >
            Archive
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[11px] text-text-secondary">Archive?</span>
            <button
              type="button"
              onClick={handleArchive}
              className="font-sans text-[11px] px-2.5 py-1 rounded-lg bg-signal-dn text-white hover:bg-signal-dn/80 transition-colors cursor-pointer"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmArchive(false)}
              className="font-sans text-[11px] px-2.5 py-1 rounded-lg border border-border-base hover:border-border-hover text-text-secondary transition-colors cursor-pointer"
            >
              No
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          className="font-sans text-[11px] px-3 py-1.5 rounded-lg border border-border-base hover:border-border-hover text-text-secondary transition-colors ml-auto cursor-pointer"
        >
          {regenerating ? "Regenerating..." : "\u21ba Regenerate"}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-espresso text-cream font-sans text-[11px] px-3 py-1.5 rounded-full z-10 whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* MemoModal */}
      {memoOpen && (
        <MemoModal
          isOpen={memoOpen}
          onClose={() => setMemoOpen(false)}
          title={thesis.title}
          content={memoContent}
          type="thesis"
        />
      )}
    </div>
  );
}
