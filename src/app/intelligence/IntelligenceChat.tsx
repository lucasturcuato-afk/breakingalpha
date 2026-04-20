"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

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

/* ── Types ── */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "What are the strongest theses this week?",
  "Summarize recent M&A activity",
  "Which sectors show the most momentum?",
];

/* ── Component ── */

export function IntelligenceChat() {
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
          body: JSON.stringify({ message: trimmed, history }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `API error: ${res.status}`);
        }

        const data = await res.json();
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: data.response || "No response received.",
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
    [messages, loading],
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
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-180px)]">
      {/* Header */}
      <div className="mb-4">
        <p className="font-data text-[9px] uppercase tracking-widest text-gold font-bold">
          AI Research Assistant
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
                    className={cn(
                      "px-3 py-2 rounded-xl border border-border-base bg-parchment",
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
                    <ReactMarkdown components={mdComponents}>
                      {msg.content}
                    </ReactMarkdown>
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
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your market intelligence..."
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
          className={cn(
            "flex-shrink-0 p-3 rounded-xl",
            "bg-gold text-white hover:bg-gold/90 transition-colors cursor-pointer",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
