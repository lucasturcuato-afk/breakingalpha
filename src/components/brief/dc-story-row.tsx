"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, MessageSquare } from "lucide-react";
import { stripHtml } from "@/lib/strip-html";
import { makeCallLink } from "@/lib/make-call-link";
import { withCompanyLine } from "@/lib/memo-company-line";
import { cn } from "@/lib/utils";
import { BookmarkButton } from "@/components/ui/bookmark";
import { MemoModal } from "@/components/memo/MemoModal";
import { CompletenessBadge, SignalScore, SourceCredibilityBadge } from "@/lib/article-signal";
import { SentimentPill, sentimentToTone } from "@/components/ui/sentiment-pill";
import type { StoryData } from "@/components/dashboard";

// Sherwood Direction C palette — literal hexes for values that must stay
// constant across the theme flip (html.dark rebinds --espresso/--cream).
const HERITAGE_GOLD = "#d4a84b";
const DC_ESPRESSO = "#1a1208";

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// True when the expand "summary" is just the headline restated. Google News
// headline-only rows store the title back as the RSS description, so after
// stripHtml the body echoes the title (collapsing a " - Source" suffix to a
// space, sometimes with CJK bracket artifacts). We compare alphanumeric-only
// forms so those artifacts don't defeat the match, and require near-equal
// length so a real full-text summary that merely opens with the headline is
// NOT suppressed. Defect #4 render half: kill the echo/blank on its own.
function isHeadlineEcho(summary: string, title: string): boolean {
  const s = alnum(summary);
  const t = alnum(title);
  if (t.length < 12 || s.length === 0) return false;
  const [shorter, longer] = s.length <= t.length ? [s, t] : [t, s];
  return longer.startsWith(shorter) && longer.length - shorter.length <= 8;
}

// Truncate the expand body at a WORD boundary at/under `cap` (defect FIX 3), so
// a long summary reads as a deliberate teaser instead of a mid-word glitch. Cap
// length is unchanged; only the break point moves back to the last space, with
// any trailing punctuation trimmed before the ellipsis is appended by the caller.
function truncateAtWord(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  const slice = text.slice(0, cap);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  // Trim trailing punctuation (incl. an em dash via its \u2014 escape) before the ellipsis.
  return { text: cut.replace(/[\s.,;:!?\u2014-]+$/, ""), truncated: true };
}

export interface DCStoryRowProps {
  story: StoryData;
  index: number;
  watching?: boolean;
}

export function DCStoryRow({ story, index, watching = false }: DCStoryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(story.saved ?? false);
  const [memoOpen, setMemoOpen] = useState(false);
  const router = useRouter();

  const storyTone = sentimentToTone(story.sentiment);

  const completenessLabel =
    story.completeness === "full" ? "Full text"
      : story.completeness === "summary" ? "Summary"
      : story.completeness === "headline" ? "Headline only"
      : null;

  // Expand body: the real summary, unless it is null or merely the headline
  // restated (defect #4). In that case bodyText is empty and we render a clean
  // "Headline only" note instead of a blank panel or the title echoed back.
  const cleanedSummary = story.summary ? stripHtml(story.summary) : "";
  const bodyText = isHeadlineEcho(cleanedSummary, story.title) ? "" : cleanedSummary.trim();
  const bodyPreview = truncateAtWord(bodyText, 480);

  return (
    <div
      style={{
        background: "var(--elevated)",
        border: "1px solid var(--border-base)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "44px 1fr auto",
          gap: 18,
          alignItems: "center",
          padding: "16px 20px",
          cursor: "pointer",
        }}
      >
        <span
          className="font-[family-name:var(--font-playfair-display)]"
          style={{ fontSize: 30, fontWeight: 800, color: HERITAGE_GOLD, lineHeight: 1 }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          {watching && (
            <span
              className="font-sans"
              style={{
                display: "inline-block",
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text-muted)",
                background: "var(--parchment-mid)",
                border: "1px solid var(--border-base)",
                padding: "2px 7px",
                borderRadius: 4,
                marginBottom: 5,
              }}
            >
              Watching
            </span>
          )}
          <h4
            className="font-[family-name:var(--font-playfair-display)]"
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: "0 0 6px",
              lineHeight: 1.25,
              letterSpacing: "-0.01em",
            }}
          >
            {story.title}
          </h4>
          <div
            className="font-sans"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            {story.sector && (
              <span
                style={{
                  padding: "2px 8px",
                  background: "var(--gold-muted)",
                  color: "var(--gold-dark)",
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 10,
                }}
              >
                {story.sector}
              </span>
            )}
            <span>{story.source}</span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span className="font-sans" style={{ fontSize: 10 }}>
              {story.timestamp}
            </span>
            {story.adjustedScore != null && (
              <>
                <span style={{ color: "var(--text-faint)" }}>·</span>
                <SignalScore score={story.adjustedScore} />
              </>
            )}
            <SourceCredibilityBadge winRate={story.sourceWinRate} sampleSize={story.sourceSampleSize} />
            {completenessLabel && <CompletenessBadge completeness={story.completeness} />}
          </div>
        </div>
        <SentimentPill tone={storyTone} size="sm" />
      </div>

      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          expanded ? "opacity-100" : "opacity-0",
        )}
        style={{
          maxHeight: expanded ? 520 : 0,
          padding: expanded ? "0 20px 18px" : "0 20px",
          borderTop: expanded ? "1px solid var(--border-subtle)" : "none",
        }}
      >
        {expanded && (
          <>
            {bodyText ? (
              <p
                className="font-sans"
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--text-secondary)",
                  margin: "14px 0 10px",
                }}
              >
                {bodyPreview.text}
                {bodyPreview.truncated ? "…" : ""}
              </p>
            ) : (
              <p
                className="font-sans"
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--text-faint)",
                  fontStyle: "italic",
                  margin: "14px 0 10px",
                }}
              >
                Headline only. Open the source for the full story.
              </p>
            )}

            {story.tags && story.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {story.tags.map((t) => (
                  <span
                    key={t}
                    className="font-sans"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      background: "var(--parchment-mid)",
                      border: "1px solid var(--border-base)",
                      padding: "3px 9px",
                      borderRadius: 10,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <BookmarkButton
                saved={saved}
                onToggle={(v) => {
                  setSaved(v);
                  const key = "signalera_saved_articles";
                  try {
                    const list: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
                    if (v && !list.includes(story.id)) list.push(story.id);
                    else if (!v) {
                      const idx = list.indexOf(story.id);
                      if (idx > -1) list.splice(idx, 1);
                    }
                    localStorage.setItem(key, JSON.stringify(list));
                  } catch { /* localStorage disabled */ }
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMemoOpen(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: HERITAGE_GOLD,
                  color: DC_ESPRESSO,
                  border: "none",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Sparkles size={11} />
                Generate Memo
              </button>
              <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(makeCallLink(story.title));
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: "var(--parchment-mid)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-base)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={11} />
                  Make a call
                </button>
              <button
                type="button"
                disabled
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "var(--parchment-mid)",
                  color: "var(--text-faint)",
                  border: "1px solid var(--border-base)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: 0.6,
                  cursor: "not-allowed",
                }}
                title="Ask AI is coming soon"
              >
                <MessageSquare size={11} />
                Ask AI
                <span style={{
                  marginLeft: 4,
                  padding: "2px 4px",
                  borderRadius: 4,
                  background: "var(--parchment-mid)",
                  fontSize: 8,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                }}>
                  Soon
                </span>
              </button>
              {story.url && (
                <a
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="font-sans"
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "var(--gold-dark)",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open source →
                </a>
              )}
            </div>
          </>
        )}
      </div>

      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={story.title}
        content={withCompanyLine([story.title, stripHtml(story.summary)].join("\n\n"), story.companies?.[0])}
        type="article"
      />
    </div>
  );
}
