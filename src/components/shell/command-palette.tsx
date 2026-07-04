"use client";

import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, TrendingUp, Clock, Briefcase, Star, Settings, X } from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  section: string;
  href: string;
  icon: React.ReactNode;
}

const commands: CommandItem[] = [
  { id: "dashboard", label: "Dashboard", section: "Pages", href: "/dashboard", icon: <TrendingUp size={14} /> },
  { id: "morning", label: "Morning Brief", section: "Pages", href: "/morning-brief", icon: <Clock size={14} /> },
  { id: "evening", label: "Evening Wrap", section: "Pages", href: "/evening-wrap", icon: <Clock size={14} /> },
  { id: "feed", label: "Live Feed", section: "Pages", href: "/live-feed", icon: <FileText size={14} /> },
  { id: "radar", label: "Radar", section: "Research", href: "/radar", icon: <Star size={14} /> },
  { id: "thesis", label: "Thesis Board", section: "Research", href: "/radar/theses", icon: <FileText size={14} /> },
  { id: "tracker", label: "Thesis Tracker", section: "Research", href: "/radar/track-record", icon: <TrendingUp size={14} /> },
  { id: "deal", label: "Deal Flow", section: "Research", href: "/deal-flow", icon: <Briefcase size={14} /> },
  { id: "watchlist", label: "Watchlist", section: "Research", href: "/radar/watchlist", icon: <Star size={14} /> },
  { id: "trends", label: "Trends", section: "Research", href: "/trends", icon: <TrendingUp size={14} /> },
  { id: "company", label: "Company Intel", section: "Research", href: "/company", icon: <Search size={14} /> },
  { id: "settings", label: "Settings", section: "Pages", href: "/settings/profile", icon: <Settings size={14} /> },
];

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase()),
  );

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Small delay to allow animation
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keyboard nav
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        onClose();
        router.push(filtered[selectedIndex].href);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selectedIndex, onClose],
  );

  if (!open) return null;

  // Group by section
  const sections = new Map<string, CommandItem[]>();
  for (const item of filtered) {
    const existing = sections.get(item.section) || [];
    existing.push(item);
    sections.set(item.section, existing);
  }

  let flatIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-espresso/40 z-50 animate-in fade-in-0 duration-150"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
        <div
          className={cn(
            "w-full max-w-[480px] bg-white border border-border-base rounded-2xl shadow-2xl overflow-hidden",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200",
          )}
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-border-subtle">
            <Search size={15} className="text-text-faint flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search pages, commands..."
              className="flex-1 h-12 bg-transparent font-sans text-[14px] text-text-primary placeholder:text-text-faint outline-none"
            />
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md hover:bg-parchment-mid transition-colors cursor-pointer"
            >
              <X size={14} className="text-text-faint" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[320px] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="font-sans text-[12px] text-text-muted">No results found</p>
              </div>
            ) : (
              Array.from(sections.entries()).map(([section, items]) => (
                <div key={section}>
                  <p className="px-4 pt-2 pb-1 font-sans text-[10px] font-semibold text-text-faint">
                    {section}
                  </p>
                  {items.map((item) => {
                    const idx = flatIndex++;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          onClose();
                          router.push(item.href);
                        }}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2 mx-2 rounded-lg",
                          "font-sans text-[13px] transition-colors duration-75",
                          idx === selectedIndex
                            ? "bg-espresso text-cream [&_svg]:text-gold"
                            : "text-text-secondary [&_svg]:text-text-faint hover:bg-parchment-mid",
                        )}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hints */}
          <div className="px-4 py-2 border-t border-border-subtle flex items-center gap-4">
            <span className="font-sans text-[10px] text-text-faint flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-parchment-mid border border-border-base text-[9px] font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="font-sans text-[10px] text-text-faint flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-parchment-mid border border-border-base text-[9px] font-mono">↵</kbd>
              open
            </span>
            <span className="font-sans text-[10px] text-text-faint flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-parchment-mid border border-border-base text-[9px] font-mono">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
