"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MemoModal } from "@/components/memo/MemoModal";
import { getSectorStyle } from "@/lib/sector-colors";
import { Tooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ThesisItem } from "./thesis-types";
import { ConvictionRing } from "./ConvictionRing";
import { SparklineChart } from "./SparklineChart";
import { TickerContext } from "./TickerContext";

// ── Helpers ──

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function deriveScore(thesis: ThesisItem): number | null {
  if (typeof thesis.adversarial_score === "number") {
    if (thesis.adversarial_score < 0) return null;
    return Math.round(thesis.adversarial_score * 100);
  }
  return thesis.conviction === "BULLISH" ? 82 : thesis.conviction === "BEARISH" ? 28 : 50;
}

function convictionToSentiment(conviction: string | null): string {
  switch (conviction) {
    case "HIGH":
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    case "MEDIUM":
    case "WATCH": return "watch";
    default: return "watch";
  }
}

function classifyEvidenceSentiment(
  thesisSentiment: string,
  evidenceSentiment: string | undefined
): "supports" | "contradicts" | "neutral" {
  const es = (evidenceSentiment || "neutral").toLowerCase();
  const ts = thesisSentiment.toLowerCase();
  // Matching
  if (es === ts) return "supports";
  if ((es === "positive" && ts === "bullish") || (es === "bullish" && ts === "bullish")) return "supports";
  if ((es === "negative" && ts === "bearish") || (es === "bearish" && ts === "bearish")) return "supports";
  // Contradicting
  if ((es === "bullish" && ts === "bearish") || (es === "bearish" && ts === "bullish")) return "contradicts";
  if ((es === "positive" && ts === "bearish") || (es === "negative" && ts === "bullish")) return "contradicts";
  return "neutral";
}

function inferSourceType(source?: string, url?: string): string {
  const s = (source || "").toLowerCase();
  const u = (url || "").toLowerCase();
  if (s.includes("sec") || u.includes("sec.gov")) return "SEC";
  if (s.includes("fed") || u.includes("federalreserve.gov")) return "Fed";
  if (s.includes("prnewswire") || u.includes("prnewswire.com")) return "PR Newswire";
  return "News";
}

const sentimentPills: Record<string, { label: string; dot: string; pill: string }> = {
  supports: { label: "Supports", dot: "bg-signal-up", pill: "bg-signal-up/10 text-signal-up" },
  contradicts: { label: "Contradicts", dot: "bg-signal-dn", pill: "bg-signal-dn/10 text-signal-dn" },
  neutral: { label: "Neutral", dot: "bg-signal-warn", pill: "bg-signal-warn/10 text-signal-warn" },
};

const sourceTypeBadges: Record<string, string> = {
  SEC: "bg-signal-ai/10 text-signal-ai",
  Fed: "bg-signal-warn/10 text-signal-warn",
  "PR Newswire": "bg-gold-muted text-gold-dark",
  News: "bg-parchment-mid text-text-muted",
};

interface RelatedArticle {
  id: string;
  title: string;
  source?: string;
  ingested_at?: string;
  published_at?: string;
  summary?: string;
  sentiment?: string;
  sector?: string;
  url?: string;
}

interface ThesisDetailPanelProps {
  thesis: ThesisItem | null;
  articles: RelatedArticle[];
  onArchive: (id: string) => void;
  onRegenerate?: () => void;
  activeSignalCount?: number;
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

export function ThesisDetailPanel({ thesis, articles, onArchive, onRegenerate, activeSignalCount = 0 }: ThesisDetailPanelProps) {
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteFailed, setNoteFailed] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [generatingMemo, setGeneratingMemo] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoContent, setMemoContent] = useState("");
  const [bearOpen, setBearOpen] = useState(false);
  const [signalOpen, setSignalOpen] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load note from API
  const loadNote = useCallback(async (thesisId: string) => {
    setNoteLoading(true);
    try {
      const res = await fetch(`/api/theses/notes?thesis_id=${thesisId}`);
      const data = await res.json();
      setNoteText(data.note?.content || "");
    } catch {
      setNoteText("");
    } finally {
      setNoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!thesis?.id) return;
    // If thesis has notes from the API response, use that first
    if (thesis.notes) {
      setNoteText(thesis.notes);
      setNoteLoading(false);
    } else {
      loadNote(thesis.id);
    }
    setNoteSaved(false);
    setConfirmArchive(false);
    setBearOpen(false);
    setSignalOpen(false);
  }, [thesis?.id, thesis?.notes, loadNote]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const saveNote = useCallback(async () => {
    if (!thesis?.id) return;
    try {
      await fetch("/api/theses/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis_id: thesis.id, content: noteText }),
      });
      setNoteSaved(true);
      setNoteFailed(false);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save note:", e);
      setNoteFailed(true);
    }
  }, [thesis?.id, noteText]);

  const handleNoteChange = (val: string) => {
    setNoteText(val);
    setNoteFailed(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  };

  const handleNoteBlur = () => {
    saveNote();
  };

  const handleArchive = async () => {
    if (!thesis?.id) return;
    try {
      const res = await fetch(`/api/theses/${thesis.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("Failed");
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
      const score = deriveScore(thesis);
      const evidenceText = articles.length > 0
        ? articles.map((a, i) =>
            `${i + 1}. ${a.title} (${a.source ?? ""}, ${a.sentiment ?? "neutral"}) — ${(a.summary ?? "").slice(0, 120)}`
          ).join("\n")
        : "No related articles available.";
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "thesis",
          systemPrompt: `You are a senior buy-side equity research analyst writing a formal investment thesis memo. Use professional language. Structure with these exact sections:\n\n**INVESTMENT THESIS**\nState the core thesis in 2-3 sentences.\n\n**MARKET CONTEXT & RATIONALE**\nExplain the macro and sector backdrop.\n\n**EVIDENCE BASE**\nList supporting evidence from recent market developments.\n\n**RISK FACTORS**\nWhat could invalidate this thesis? List 2-3 key risks.\n\n**CATALYST TIMELINE**\nWhat events will confirm or deny this thesis?\n\n**RECOMMENDATION**\nBull/Bear/Watch with conviction level and suggested position sizing guidance.`,
          content: `THESIS: ${thesis.title}\n\nANALYSIS: ${thesis.summary}\n\nSECTOR: ${thesis.sector}\nSENTIMENT: ${sentiment}\nCONVICTION SCORE: ${score}/100\nCATALYST: ${thesis.catalyst || thesis.catalyst_note || "Not specified"}\n\nEVIDENCE FROM LIVE FEED:\n${evidenceText}`,
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

  // ── Empty state ──
  if (!thesis) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-parchment rounded-2xl gap-3">
        {/* Compass/signal icon in gold */}
        <svg width={40} height={40} viewBox="0 0 40 40" fill="none">
          <circle cx={20} cy={20} r={18} stroke="var(--gold)" strokeWidth={2} opacity={0.5} />
          <circle cx={20} cy={20} r={4} fill="var(--gold)" />
          <line x1={20} y1={6} x2={20} y2={14} stroke="var(--gold)" strokeWidth={2} strokeLinecap="round" />
          <line x1={20} y1={26} x2={20} y2={34} stroke="var(--gold)" strokeWidth={2} strokeLinecap="round" />
          <line x1={6} y1={20} x2={14} y2={20} stroke="var(--gold)" strokeWidth={2} strokeLinecap="round" />
          <line x1={26} y1={20} x2={34} y2={20} stroke="var(--gold)" strokeWidth={2} strokeLinecap="round" />
        </svg>
        <h3 className="font-display text-[16px] text-espresso">Select a thesis to begin research</h3>
        <p className="font-sans text-[12px] text-text-muted">
          Your thesis board has {activeSignalCount} active signals
        </p>
      </div>
    );
  }

  // ── Derived ──
  const score = deriveScore(thesis);
  const sentiment = convictionToSentiment(thesis.conviction);

  const signalBreakdown = thesis.signal_breakdown && typeof thesis.signal_breakdown === "object"
    ? Object.entries(thesis.signal_breakdown)
    : [];

  return (
    <div className="flex flex-col h-full border border-border-base rounded-2xl bg-parchment overflow-hidden relative">

      {/* ── HEADER ── */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border-base bg-cream">
        <div className="flex items-start gap-3">
          {/* Score ring */}
          <ConvictionRing conviction={thesis.conviction} size={48} score={score} />
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[18px] text-espresso leading-snug mb-1">
              {thesis.title}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                style={getSectorStyle(thesis.sector)}
                className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
              >
                {thesis.sector}
              </span>
              {thesis.ticker && (
                <span className="font-data text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
                  {thesis.ticker}
                </span>
              )}
              {thesis.ticker && <SparklineChart ticker={thesis.ticker} size="md" />}
              {thesis.ticker && (
                <TickerContext ticker={thesis.ticker} thesisCreatedAt={thesis.generated_at} variant="expanded" />
              )}
              {(() => {
                if (thesis.passed_adversarial === true && typeof thesis.adversarial_score === "number" && thesis.adversarial_score > 0) {
                  return (
                    <Tooltip content={`Score: ${thesis.adversarial_score.toFixed(2)}`}>
                      <span className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded bg-signal-up/10 text-signal-up">
                        ✓ Bear case: Bull wins
                      </span>
                    </Tooltip>
                  );
                }
                if (thesis.passed_adversarial === false && typeof thesis.adversarial_score === "number" && thesis.adversarial_score > 0) {
                  return (
                    <Tooltip content={`Score: ${thesis.adversarial_score.toFixed(2)}`}>
                      <span className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded bg-signal-dn/10 text-signal-dn">
                        ✗ Bear case: Flagged
                      </span>
                    </Tooltip>
                  );
                }
                return (
                  <span className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded bg-parchment-mid text-text-muted">
                    ⏳ Bear case pending
                  </span>
                );
              })()}
              {thesis.outcome && (
                <span className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                  thesis.outcome === "confirmed" ? "bg-signal-up/10 text-signal-up" :
                  thesis.outcome === "invalidated" ? "bg-signal-dn/10 text-signal-dn" :
                  "bg-signal-warn/10 text-signal-warn"
                }`}>
                  {thesis.outcome === "confirmed" ? "✓ Confirmed" :
                   thesis.outcome === "invalidated" ? "✗ Invalidated" :
                   "~ Inconclusive"}
                </span>
              )}
              <span className="font-sans text-[10px] text-text-muted">{thesis.updatedAt}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">

        {/* Full Analysis */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 border-l-2 border-gold pl-2">Full Analysis</div>
          <div className="bg-parchment-mid border border-border-base rounded-lg px-4 py-3">
            <div className="font-sans text-[12px] text-text-primary leading-relaxed">
              {thesis.rationale || thesis.summary}
            </div>
          </div>
        </div>

        <div className="h-px bg-border-base" />

        {/* Bear Case (collapsible, violet treatment) */}
        {thesis.bear_case && (
          <>
            <div>
              <button
                type="button"
                onClick={() => setBearOpen((v) => !v)}
                className="flex items-center gap-1.5 font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary transition-colors border-l-2 border-gold pl-2"
              >
                Bear Case
                {bearOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {bearOpen && (
                <div className="mt-2 bg-red-950/20 border border-red-900/30 rounded-lg px-4 py-3">
                  <div className="font-sans text-[12px] text-text-primary leading-relaxed">
                    {thesis.bear_case}
                  </div>
                </div>
              )}
            </div>
            <div className="h-px bg-border-base" />
          </>
        )}

        {/* Signal Breakdown (collapsible) */}
        {signalBreakdown.length > 0 && (
          <>
            <div>
              <button
                type="button"
                onClick={() => setSignalOpen((v) => !v)}
                className="flex items-center gap-1.5 font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary transition-colors border-l-2 border-gold pl-2"
              >
                Signal Breakdown
                {signalOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {signalOpen && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {signalBreakdown.map(([key, val]) => (
                    <div key={key} className="contents">
                      <span className="font-sans text-[11px] text-text-secondary">{key}</span>
                      <span className="font-data text-[11px] text-text-primary text-right">
                        {typeof val === "number" ? val.toFixed(2) : String(val ?? "—")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="h-px bg-border-base" />
          </>
        )}

        {/* Live Evidence Feed */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 border-l-2 border-gold pl-2">
            <span className="text-signal-up">●</span> Live Evidence Feed
          </div>
          {articles.length === 0 ? (
            <div className="font-sans text-[11px] text-text-muted italic">
              No articles matched this thesis yet.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-base">
              {articles.map((article) => {
                const cls = classifyEvidenceSentiment(sentiment, article.sentiment);
                const pill = sentimentPills[cls];
                const sourceType = inferSourceType(article.source, article.url);
                return (
                  <div key={article.id} className="flex items-start gap-2 py-2">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${pill.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-[11px] font-medium text-text-primary leading-snug mb-0.5">{article.title}</div>
                      {article.summary && (
                        <div className="font-sans text-[10px] text-text-secondary leading-snug mb-1">
                          {article.summary.length > 160 ? article.summary.slice(0, 160) + "..." : article.summary}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-sans text-[8px] font-bold px-1.5 py-0.5 rounded ${sourceTypeBadges[sourceType]}`}>
                          {sourceType}
                        </span>
                        <span className="font-sans text-[9px] text-text-muted">
                          {article.source}{(() => { const d = article.published_at || article.ingested_at; return d ? ` · ${relativeTime(d)}` : ""; })()}
                        </span>
                        <span className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${pill.pill}`}>
                          {pill.label}
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
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 border-l-2 border-gold pl-2">Catalyst</div>
          <div className="font-sans text-[12px] text-text-primary">
            {thesis.catalyst_note || thesis.catalyst || (
              <span className="text-text-muted italic">No catalyst recorded for this thesis.</span>
            )}
          </div>
        </div>

        <div className="h-px bg-border-base" />

        {/* Your Notes */}
        <div>
          <div className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 border-l-2 border-gold pl-2">Your Notes</div>
          {noteLoading ? (
            <SectionSkeleton />
          ) : (
            <>
              <textarea
                ref={notesRef}
                value={noteText}
                onChange={(e) => handleNoteChange(e.target.value)}
                onBlur={handleNoteBlur}
                placeholder="Add your research notes here..."
                className="w-full min-h-[80px] font-sans text-[12px] text-text-primary bg-cream border border-border-base rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-gold placeholder:text-text-muted transition-colors"
              />
              <div className="flex items-center mt-1.5">
                {noteFailed ? (
                  <span className="font-sans text-[10px] text-signal-dn">Failed to save</span>
                ) : (
                  <span className={`font-sans text-[10px] transition-opacity duration-300 ${noteSaved ? "text-signal-up opacity-100" : "opacity-0"}`}>
                    &#10003; Saved
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex-shrink-0 border-t border-border-base px-4 py-3 flex items-center gap-2 flex-wrap bg-cream">
        <button
          type="button"
          onClick={handleGenerateMemo}
          disabled={generatingMemo}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors disabled:opacity-50 cursor-pointer"
        >
          {generatingMemo ? "Generating..." : "✦ Generate Memo"}
        </button>
        <button
          type="button"
          onClick={() => notesRef.current?.focus()}
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
              className="font-sans text-[11px] px-2.5 py-1 rounded-lg bg-signal-dn text-cream hover:bg-signal-dn/80 transition-colors cursor-pointer"
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
