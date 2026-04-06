"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getSectorStyle } from "@/lib/sector-colors";
import { Badge } from "@/components/ui/badge";
import { BookmarkButton } from "@/components/ui/bookmark";
import { Sparkles, Plus, MessageSquare, Loader2 } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import type { BadgeVariant } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Thesis match helpers — used by both card variants
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","as","is","are","was","were","be","been","has","have","had","will",
  "would","could","should","may","might","this","that","these","those","it",
  "its","i","we","they","he","she","you","new","says","said","after","over",
  "amid","amid","amid","amid","s","its",
]);

function keyTerms(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function termOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

// Minimum meaningful term overlap required to navigate to an existing thesis.
// Score < MATCH_THRESHOLD → toast instead of redirect.
const MATCH_THRESHOLD = 2;

export interface StoryData {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  sentiment: string;
  sector?: string;
  summary?: string;
  tags?: string[];
  url?: string;
  read?: boolean;
  saved?: boolean;
}

function sentimentToVariant(sentiment: string): BadgeVariant {
  switch (sentiment.toLowerCase()) {
    case "positive":
    case "bullish":
      return "bullish";
    case "negative":
    case "bearish":
      return "bearish";
    case "risk-off":
      return "risk-off";
    default:
      return "default";
  }
}

function sentimentLabel(sentiment: string): string {
  switch (sentiment.toLowerCase()) {
    case "positive":
    case "bullish":
      return "Bullish";
    case "negative":
    case "bearish":
      return "Bearish";
    case "risk-off":
      return "Risk-Off";
    default:
      return sentiment;
  }
}

interface LeadStoryCardProps {
  story: StoryData;
  onBookmark?: (id: string, saved: boolean) => void;
}

export function LeadStoryCard({ story, onBookmark }: LeadStoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(story.saved ?? false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [addingThesis, setAddingThesis] = useState(false);
  const [thesisToast, setThesisToast] = useState("");
  const router = useRouter();

  return (
    <div
      className={cn(
        "relative bg-white border border-border-base rounded-2xl overflow-visible",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
        !story.read && "border-l-[3px] border-l-gold",
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="px-4 pt-4 pb-3">
        {/* Meta row */}
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={sentimentToVariant(story.sentiment)}>
            {sentimentLabel(story.sentiment)}
          </Badge>
          {story.sector && (
            <span
              style={getSectorStyle(story.sector)}
              className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
            >
              {story.sector}
            </span>
          )}
          <span className="font-sans text-[11px] text-text-muted font-medium">
            {story.source}
          </span>
          <span className="font-data text-[10px] text-text-faint ml-auto">
            {story.timestamp}
          </span>
        </div>

        {/* Headline */}
        <h3 className="font-display text-[15px] font-bold text-espresso leading-snug hover:text-gold-dark transition-colors">
          {story.title}
        </h3>

        {/* Summary (visible on hover) */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
            expanded ? "max-h-40 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0",
          )}
        >
          {story.summary && (
            <p className="font-sans text-[12px] text-text-secondary leading-[1.55]">
              {stripHtml(story.summary)}
            </p>
          )}

          {/* Tags */}
          {story.tags && story.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {story.tags.map((tag) => (
                <span
                  key={tag}
                  className="font-sans text-[10px] px-2 py-0.5 bg-parchment-mid border border-border-base rounded-md text-text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            <BookmarkButton
              saved={saved}
              onToggle={(v) => {
                setSaved(v);
                onBookmark?.(story.id, v);
                const key = "signalera_reading_list";
                const list: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
                if (v && !list.includes(story.id)) list.push(story.id);
                else if (!v) { const idx = list.indexOf(story.id); if (idx > -1) list.splice(idx, 1); }
                localStorage.setItem(key, JSON.stringify(list));
              }}
            />
            <button
              type="button"
              onClick={() => setMemoOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
            >
              <Sparkles size={11} />
              Generate Memo
            </button>
            <div className="relative">
              <button
                type="button"
                disabled={addingThesis}
                onClick={async (e) => {
                  e.stopPropagation();
                  setAddingThesis(true);
                  setThesisToast("");
                  try {
                    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
                    const { data: theses } = await supabase
                      .from("theses")
                      .select("id, sector, title, rationale")
                      .neq("status", "archived");

                    const sector = (story.sector || "").toLowerCase();
                    const sameSector = (theses || []).filter(
                      (t) => (t.sector || "").toLowerCase() === sector
                    );

                    if (sameSector.length === 0) {
                      setThesisToast("No existing thesis for this sector — visit Thesis Board to build one");
                      setTimeout(() => setThesisToast(""), 3500);
                    } else {
                      // Score each same-sector thesis by term overlap with story title + summary
                      const storyTerms = keyTerms(`${story.title} ${story.summary || ""}`);
                      const scored = sameSector.map((t) => ({
                        id: t.id,
                        score: termOverlap(storyTerms, keyTerms(`${t.title} ${t.rationale || ""}`)),
                      })).sort((a, b) => b.score - a.score);

                      const best = scored[0];
                      if (best.score >= MATCH_THRESHOLD) {
                        router.push(`/thesis-board?thesis=${best.id}`);
                      } else {
                        setThesisToast("No closely related thesis found — visit Thesis Board to build one");
                        setTimeout(() => setThesisToast(""), 3500);
                      }
                    }
                  } catch (err) {
                    console.error("Thesis match error:", err);
                  } finally {
                    setAddingThesis(false);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {addingThesis ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                {addingThesis ? "Matching..." : "Thesis"}
              </button>
              {thesisToast && (
                <div className="absolute -top-8 left-0 whitespace-nowrap bg-espresso text-cream font-sans text-[10px] px-2.5 py-1 rounded-md z-10">
                  {thesisToast}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
            >
              <MessageSquare size={11} />
              Ask AI
            </button>
          </div>
        </div>
      </div>
      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={story.title}
        content={[story.title, stripHtml(story.summary)].join("\n\n")}
        type="article"
      />
    </div>
  );
}

interface CompactStoryCardProps {
  story: StoryData;
  number: number;
  onBookmark?: (id: string, saved: boolean) => void;
}

export function CompactStoryCard({ story, number, onBookmark }: CompactStoryCardProps) {
  const [saved, setSaved] = useState(story.saved ?? false);
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [addingThesis, setAddingThesis] = useState(false);
  const [thesisToast, setThesisToast] = useState("");
  const router = useRouter();

  // Reset expanded when story changes
  useEffect(() => {
    setExpanded(false);
  }, [story.id]);

  return (
    <div
      className={cn(
        "py-3 px-3 rounded-xl group cursor-pointer",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        expanded ? "bg-parchment-mid" : "hover:translate-x-0.5 hover:bg-parchment-mid",
        story.read && "opacity-72",
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-start gap-3">
        {/* Unread indicator */}
        {!story.read && (
          <div className="w-[3px] self-stretch rounded-full bg-gold flex-shrink-0 -ml-1 mr-0" />
        )}

        {/* Number */}
        <span className="font-display text-[22px] font-extrabold text-border-base leading-none flex-shrink-0 w-6 text-right">
          {number}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant={sentimentToVariant(story.sentiment)} className="text-[8px]">
              {sentimentLabel(story.sentiment)}
            </Badge>
            {story.sector && (
              <span
                style={getSectorStyle(story.sector)}
                className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0"
              >
                {story.sector}
              </span>
            )}
            <span className="font-sans text-[10px] text-text-muted">
              {story.source}
            </span>
            <span className="font-data text-[9px] text-text-faint ml-auto">
              {story.timestamp}
            </span>
          </div>
          <h4 className="font-display text-[13px] font-bold text-espresso leading-snug hover:text-gold-dark transition-colors">
            {story.title}
          </h4>

          {/* Expanded content */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              expanded ? "max-h-60 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0",
            )}
          >
            {story.summary && (
              <p className="font-sans text-[12px] text-text-secondary leading-relaxed mb-3">
                {stripHtml(story.summary)}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMemoOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
              >
                <Sparkles size={11} />
                Generate Memo
              </button>
              <div className="relative">
                <button
                  type="button"
                  disabled={addingThesis}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setAddingThesis(true);
                    setThesisToast("");
                    try {
                      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
                      const { data: theses } = await supabase
                        .from("theses")
                        .select("id, sector, title, rationale")
                        .neq("status", "archived");

                      const sector = (story.sector || "").toLowerCase();
                      const sameSector = (theses || []).filter(
                        (t) => (t.sector || "").toLowerCase() === sector
                      );

                      if (sameSector.length === 0) {
                        setThesisToast("No existing thesis for this sector — visit Thesis Board to build one");
                        setTimeout(() => setThesisToast(""), 3500);
                      } else {
                        const storyTerms = keyTerms(`${story.title} ${story.summary || ""}`);
                        const scored = sameSector.map((t) => ({
                          id: t.id,
                          score: termOverlap(storyTerms, keyTerms(`${t.title} ${t.rationale || ""}`)),
                        })).sort((a, b) => b.score - a.score);

                        const best = scored[0];
                        if (best.score >= MATCH_THRESHOLD) {
                          router.push(`/thesis-board?thesis=${best.id}`);
                        } else {
                          setThesisToast("No closely related thesis found — visit Thesis Board to build one");
                          setTimeout(() => setThesisToast(""), 3500);
                        }
                      }
                    } catch (err) {
                      console.error("Thesis match error:", err);
                    } finally {
                      setAddingThesis(false);
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {addingThesis ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  {addingThesis ? "Matching..." : "Thesis"}
                </button>
                {thesisToast && (
                  <div className="absolute -top-8 left-0 whitespace-nowrap bg-espresso text-cream font-sans text-[10px] px-2.5 py-1 rounded-md z-10">
                    {thesisToast}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
              >
                <MessageSquare size={11} />
                Ask AI
              </button>
            </div>
          </div>
        </div>

        {/* Bookmark (visible on hover) */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <BookmarkButton
            saved={saved}
            size={12}
            onToggle={(v) => {
              setSaved(v);
              onBookmark?.(story.id, v);
              const key = "signalera_saved_articles";
              const list: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
              if (v && !list.includes(story.id)) list.push(story.id);
              else if (!v) { const idx = list.indexOf(story.id); if (idx > -1) list.splice(idx, 1); }
              localStorage.setItem(key, JSON.stringify(list));
            }}
          />
        </div>
      </div>
      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={story.title}
        content={[story.title, stripHtml(story.summary)].join("\n\n")}
        type="article"
      />
    </div>
  );
}
