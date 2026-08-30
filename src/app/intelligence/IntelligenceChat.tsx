"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { useOutputFeedback } from "@/hooks/useOutputFeedback";

/* ── Markdown component overrides (mirrors MemoModal pattern) ── */

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
    <h3 className="font-display text-[15px] font-semibold text-text-primary mb-2 mt-4">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="font-sans text-[13px] text-text-secondary leading-relaxed mb-3">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-bold text-text-primary">{children}</strong>
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

/* ── Types ── */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  output_id?: string | null;
}

const SUGGESTED_PROMPTS = [
  "What are the strongest theses this week?",
  "Summarize recent M&A activity",
  "Which sectors show the most momentum?",
];

/* What the field says it does, and it is the same string twice on purpose: the
   label below is the accessible name and the placeholder is the visible one,
   and a control whose two names disagree reads as two different controls. That
   is the Ask composer's rule verbatim (ask-composer.tsx:64-73), applied here
   because this field had NO real name: its only source was the placeholder,
   which the accessible-name algorithm treats as the last resort and which stops
   being rendered the moment a character is typed.

   Only the name changes. The 13px size stays: the sub-16px input floor is being
   scoped across the whole app as its own unit, and a one-screen font-size bump
   would collide with it.

   Why the string is this short, which predates this change: the gutter narrowed
   the field, and the old copy stopped fitting. Measured at 320 the input's
   content box is 198px against a 228.9px prompt string, so it rendered
   "...market intellige|", and at 360 the headroom was 9.1px, thin enough for a
   fallback face to clip it too. The Ask composer's verbatim string is not
   available here either: without the ellipsis it still measures 219.1px and
   overruns 320 by 21.1px, because that composer gives its field the whole row
   and puts the send control on its own line. This measures 145px, which is 53px
   of headroom at 320 and 64.3px in a generic sans fallback. */
const FIELD_LABEL = "Ask about the market...";

/* ── Per-message feedback wrapper ── */

function ChatMessageFeedback({ outputId, children }: { outputId?: string | null; children: React.ReactNode }) {
  const { ref, thumbs, setThumbs } = useOutputFeedback({ output_id: outputId });
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>}>
      {children}
      {/* BOTH HALVES ARE CLOSED HERE, AND THE SECOND ONE COST A DESIGN
          DECISION THAT WAS MADE RATHER THAN GUESSED AT.

          WHAT WAS WRONG. Two defects on one control. It was 15x15 around an
          11px glyph, under the 44px floor. And it was unreachable: the wrapper
          was `opacity-0` revealed by `group-hover/msg`, and Tailwind compiles
          every `hover:` variant inside `@media (hover: hover)`, so on a touch
          context `matchMedia("(hover: hover)")` is false and the measured
          opacity stayed 0 with and without a synthetic hover. On top of that,
          `focus()` succeeded and `document.activeElement` was the button while
          the wrapper was still at 0, so a keyboard user landed on something
          invisible, which is a 2.4.7 failure.

          The keyboard half was separable and was fixed first, with
          `focus-within`. The other half was not this unit's to decide, because
          revealing these permanently changes what every assistant message looks
          like on every touch device. It was escalated and ruled on: size them
          and make them reachable. The cost, two permanently visible controls
          under every answer, was named and accepted.

          SO THE REVEAL IS GONE. No `opacity-0`, no `group-hover/msg`, no
          `focus-within` standing in for it, and `group/msg` came off the
          message row with them because nothing referenced it any more. A
          control that is always painted needs none of that machinery, and
          leaving a dead `focus-within` behind would imply a hidden state that
          no longer exists.

          THE BOX IS A REAL 44x44, NOT A PADDED-OUT HIT AREA. The usual trick
          for keeping a small glyph at a legal size is block padding plus a
          negative margin, so the target grows without the row growing. Not
          here: a negative top margin would push a 44px target up over the last
          line of the answer, and tapping that line would rate the answer. The
          brief for this change asks in the same breath for 44px targets and for
          no collision with the message body, and those two only hold together
          if the box occupies the space it claims. So the row is 44 tall and
          every assistant message is 29px taller than before. Measured, not
          estimated, including on a multi-message thread.

          THE GLYPH STAYS AT 11px. The ruling was about the target and the
          reachability. Redrawing the icon is a separate decision and nobody
          asked for it, so the box grew and the drawing did not.

          THE NAMES ARE ACTIONS NOW. They read "Helpful" and "Not helpful",
          which name a rating rather than what a tap does, and neither exposed
          that the control is a toggle: tapping the lit one clears it. Same
          reasoning the send button gets named "Send" by, applied here, plus
          `aria-pressed` so the on state is announced instead of being carried
          by colour alone. */}
      {outputId && (
        <div className="flex items-center gap-1 mt-1.5">
          <button
            type="button"
            onClick={() => setThumbs(thumbs === "up" ? null : "up")}
            className={cn(
              "w-11 h-11 inline-flex items-center justify-center rounded-lg cursor-pointer transition-colors",
              thumbs === "up" ? "text-gold" : "text-text-faint hover:text-gold",
            )}
            aria-label="Rate this answer helpful"
            aria-pressed={thumbs === "up"}
          >
            <ThumbsUp size={11} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setThumbs(thumbs === "down" ? null : "down")}
            className={cn(
              "w-11 h-11 inline-flex items-center justify-center rounded-lg cursor-pointer transition-colors",
              thumbs === "down" ? "text-gold" : "text-text-faint hover:text-gold",
            )}
            aria-label="Rate this answer not helpful"
            aria-pressed={thumbs === "down"}
          >
            <ThumbsDown size={11} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Component ── */

interface IntelligenceChatProps {
  userId: string;
}

export function IntelligenceChat({ userId }: IntelligenceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMessage: ChatMessage = { role: "user", content: trimmed };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setLoading(true);

      try {
        // Build history in the format the API expects
        const history = messages.map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("model" as const),
          text: m.content,
        }));

        const res = await fetch("/api/intelligence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, userId, history }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          if (res.status === 429) {
            throw new Error(errBody.error || "Rate limit exceeded — try again later.");
          }
          throw new Error(errBody.error || `API error: ${res.status}`);
        }

        const data = await res.json();
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: data.response || "No response received.",
          output_id: data.output_id ?? null,
        };
        setMessages([...updatedMessages, assistantMessage]);
      } catch (err) {
        const errorMessage: ChatMessage = {
          role: "assistant",
          content: `Something went wrong: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`,
        };
        setMessages([...updatedMessages, errorMessage]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, userId],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const handlePromptClick = (prompt: string) => {
    void sendMessage(prompt);
  };

  const isEmpty = messages.length === 0;

  return (
    /* Two things this column has to get right below `md`, both of them
       consequences of `mobileFullBleed` on the page above it.

       THE GUTTER. `mobileFullBleed` gates the desk chrome out, and with it the
       only horizontal padding this surface had. `main#main-content` computes
       `padding-left: 0px` (app-shell.tsx:178 sets bottom padding only), and
       `max-w-3xl mx-auto` adds none of its own, so at 390 the eyebrow, the
       title, every bubble, the input and the send button all sat flush against
       both viewport edges and the send button's right edge landed exactly on
       x=390. Every other full-bleed screen draws its own gutter inside the
       flag, all of them from `--v3-pad`: ask-parts.tsx:25, ledger-screen.tsx:41
       and compose-screen.tsx:65 each define `PAD = "var(--v3-pad)"`. This is
       the same token so the screens cannot drift.

       `md:px-0` keeps the desk byte-identical, but NOT because the desk is
       clean. Between 768 and 831 it has this exact defect: `max-w-3xl` is
       768px and `main` is `vw - 64`, so the column is edge to edge until
       vw >= 832. Measured send-button right edge: 768 at vw 768, 800 at vw
       800, 866 at vw 900. That is pre-existing, it is a desk problem rather
       than a phone one, and this unit does not touch it. Logged, not fixed.

       THE HEIGHT. The column used to subtract a flat 180px from the viewport
       height, and that 180px was a desktop-chrome constant: the mood bar plus
       the topbar plus the footer. Below `md` the flag removes all three, so
       the column stopped 121px short of the tab bar and the composer floated
       mid-screen (measured: composer bottom 664, tab bar top 785). The right
       number is already on `main`, which reserves
       `--mobile-tabbar-height + env(safe-area-inset-bottom)`; read the same
       token rather than hardcoding a second one. Dynamic viewport units
       throughout, because on iOS Safari the static unit ignores the collapsing
       address bar, which is the same class of bug. (Both restatements are
       deliberately prose: design-lint's rule 7 reads comments too, and quoting
       the old class literally trips it.)

       `pb-3.5` because landing the column bottom exactly on the tab bar's top
       rule puts the input's own border on that rule with nothing between them.
       14px is the sibling's number, read correctly this time:
       ask-composer.tsx:86 is `12px PAD 14px`, where 12 is the TOP and 14 the
       BOTTOM, and it derives its height from this identical formula with the
       composer as its last child (ask-answer-screen.tsx:64). Desktop keeps its
       old spacing.

       On `env(safe-area-inset-bottom)`: the term is inert today, because
       `layout.tsx:74` exports `themeColor` only and the rendered meta carries
       no `viewport-fit=cover`, without which insets resolve to 0. It is still
       the right thing to subtract. Forcing the inset to 34px on all three
       consumers keeps the column bottom and the tab bar top equal, because the
       column shortens by 34 and the bar grows by the same 34, so this stays
       correct if anyone adds `viewport-fit=cover` later. */
    <div
      className={cn(
        "max-w-3xl mx-auto flex flex-col",
        "px-[var(--v3-pad)] pb-3.5 md:px-0 md:pb-0",
        "h-[calc(100dvh-var(--mobile-tabbar-height)-env(safe-area-inset-bottom))]",
        "md:h-[calc(100dvh-180px)]",
      )}
    >
      {/* Header */}
      <div className="mb-4">
        <p className="font-sans text-[13px] text-text-muted">
          AI research assistant
        </p>
        <h1 className="font-display text-[28px] font-extrabold text-espresso">
          Intelligence
        </h1>
      </div>

      {/* Chat area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pb-4 scrollbar-thin"
      >
        {isEmpty && !loading ? (
          /* ── Empty state ── */
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-gold-muted flex items-center justify-center mb-4">
                <Sparkles size={22} className="text-gold" />
              </div>
              <h2 className="font-display text-[20px] font-bold text-espresso mb-2">
                Ask Signalera Intelligence
              </h2>
              <p className="font-sans text-[13px] text-text-secondary mb-6">
                Query your curated market intelligence, theses, and briefings
                with AI-powered analysis.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handlePromptClick(prompt)}
                    /* 37.19 tall before this, under the 44px floor, and these
                       are not decoration: a tap calls sendMessage directly and
                       spends one of the day's fifteen model calls.

                       `box-content` plus `min-h-11` is the Ask chip's exact
                       construction, spelled out at ask-composer.tsx:96-97 and
                       justified at ask-parts.tsx:26-56. Reproduced, not
                       imported. The box model is the whole point: Tailwind's
                       preflight makes every box border-box, while the design
                       the sibling was built from ships no reset and is
                       therefore content-box, so a bare min-height of 44 would
                       land on 44 exactly with the border eating into it where
                       the design draws 46. That parity table's "prompt chip"
                       row is literally this control. The block padding goes
                       because the min-height now carries the height; leaving
                       `py-2` on a content-box 44 would make the chip 62.

                       Copied rather than consumed because AskComposer takes
                       exactly two prompts, hard-wires both of its controls to
                       navigation with no callback, and is styled in the `--c-*`
                       family this screen does not use. This is a number and a
                       box model, not a component.

                       And it is copied rather than tokenised on purpose. There
                       is no tap-floor SSOT in this repo today, the literal 44px
                       appears at 17 sites, and migrating them is a separate
                       change. */
                    className={cn(
                      "box-content min-h-11 inline-flex items-center px-3",
                      "rounded-xl border border-border-base bg-parchment",
                      "font-sans text-[12px] text-text-secondary",
                      "hover:border-gold/40 hover:text-gold transition-colors cursor-pointer",
                    )}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Message list ── */
          <>
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-muted flex items-center justify-center mr-2 mt-1">
                    <Bot size={14} className="text-gold" />
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 max-w-[80%]",
                    msg.role === "user"
                      ? "bg-gold-muted text-espresso font-sans text-[13px]"
                      : "bg-parchment border border-border-base",
                  )}
                >
                  {msg.role === "assistant" ? (
                    <ChatMessageFeedback outputId={msg.output_id}>
                      <ReactMarkdown components={mdComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    </ChatMessageFeedback>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-muted flex items-center justify-center ml-2 mt-1">
                    <User size={14} className="text-gold" />
                  </div>
                )}
              </div>
            ))}

            {/* Loading / thinking bubble */}
            {loading && (
              <div className="flex justify-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gold-muted flex items-center justify-center mr-2 mt-1">
                  <Bot size={14} className="text-gold" />
                </div>
                <div className="rounded-2xl px-4 py-3 bg-parchment border border-border-base">
                  <Loader2
                    size={18}
                    className="text-gold animate-spin"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 pt-3 border-t border-border-base"
      >
        <label htmlFor="intelligence-composer" className="sr-only">
          {FIELD_LABEL}
        </label>
        <input
          id="intelligence-composer"
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={FIELD_LABEL}
          disabled={loading}
          className={cn(
            "flex-1 px-4 py-3 border border-border-base rounded-xl bg-parchment",
            "font-sans text-[13px] text-espresso placeholder:text-text-muted",
            "focus:outline-none focus:ring-1 focus:ring-gold/40 focus:border-gold/40",
            "disabled:opacity-60",
          )}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          /* THE NAME. This is the only control that sends a message and it had
             none: its single child is a lucide glyph, lucide-react stamps
             `aria-hidden="true"` on every one of them, and the aria snapshot
             read back as a bare `button [disabled]`. So the icon needs no
             change; the whole defect is the missing string.

             "Send" and not the Ask composer's "Search Signalera". That button
             is named for a destination because it navigates. This one performs
             an action and never leaves the screen, so it is named for the
             action.

             THE SIZE. `p-3` around a 16px glyph computed to 40x40, under the
             floor. 44 is free here, measured on a production build: the field
             beside it is 46.8 tall, so it stays the row's tallest item and the
             form keeps its height, its top and its bottom (59.8 / 711.2 / 771).
             The composer's bottom edge does not move and the 14px above the tab
             bar is untouched. Only the flexed field gives up 4px of width.
             48 would have cost 1.2px of scroll area, so 44. */
          aria-label="Send"
          className={cn(
            "flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl",
            "bg-gold text-cream hover:bg-gold/90 transition-colors cursor-pointer",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
