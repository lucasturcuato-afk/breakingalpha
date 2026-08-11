"use client";

import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Copy, Download, Pencil, Eye, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import { downloadMemoPdf } from "@/lib/download-memo-pdf";
import type { MemoSourceData } from "./source-panel";

interface MemoSection {
  title: string;
  content: string[];
}

function parseMemo(raw: string): MemoSection[] {
  const lines = raw.split("\n");
  const sections: MemoSection[] = [];
  let current: MemoSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headers: ALL CAPS or **ALL CAPS**
    const isHeader =
      /^[A-Z][A-Z &/']+$/.test(trimmed) ||
      /^\*\*[A-Z].*\*\*$/.test(trimmed);

    if (isHeader) {
      if (current) sections.push(current);
      current = { title: trimmed.replace(/\*\*/g, ""), content: [] };
    } else if (current) {
      current.content.push(trimmed);
    }
  }
  if (current) sections.push(current);
  return sections;
}

interface MemoEditorProps {
  memo: string | null;
  sourceData: MemoSourceData | null;
  generating?: boolean;
  error?: string | null;
}

export function MemoEditor({ memo, sourceData, generating = false, error }: MemoEditorProps) {
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const sections = useMemo(
    () => (memo ? parseMemo(editMode ? editText : memo) : []),
    [memo, editMode, editText],
  );

  function startEdit() {
    setEditText(memo ?? "");
    setEditMode(true);
  }

  function handleCopy() {
    const text = editMode ? editText : memo;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleExport() {
    const text = editMode ? editText : memo;
    if (!text) return;
    const subject = sourceData?.company ?? "deal";
    setExporting(true);
    try {
      await downloadMemoPdf({
        memo: text,
        title: subject,
        kicker: "Deal Memo",
        filename: `memo-${subject}`,
      });
    } catch (e) {
      console.error("[memo export-pdf] failed:", e);
    } finally {
      setExporting(false);
    }
  }

  // Loading state
  if (generating) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-border-base">
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex-1 px-6 py-6 space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<FileText size={32} />}
          title="Generation failed"
          description={error}
        />
      </div>
    );
  }

  // Empty state
  if (!memo) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<FileText size={32} />}
          title="No memo yet"
          description="Fill in the deal source panel and click Generate Memo to create an AI-powered deal analysis."
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
        <div className="flex items-center gap-2">
          {sourceData && (
            <>
              <span className="font-display text-[14px] font-bold text-espresso">
                {sourceData.company}
              </span>
              {sourceData.acquirer && (
                <span className="font-sans text-[12px] text-text-muted">
                  ← {sourceData.acquirer}
                </span>
              )}
              {sourceData.dealType && (
                <Badge variant="gold">{sourceData.dealType}</Badge>
              )}
              {sourceData.value && (
                <span className="font-data text-[12px] font-semibold text-gold">
                  {sourceData.value}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (editMode ? setEditMode(false) : startEdit())}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-medium text-text-secondary hover:bg-parchment-mid transition-colors cursor-pointer"
          >
            {editMode ? <Eye size={11} /> : <Pencil size={11} />}
            {editMode ? "Preview" : "Edit"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-medium text-text-secondary hover:bg-parchment-mid transition-colors cursor-pointer"
          >
            {copied ? <Check size={11} className="text-signal-up" /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-medium text-text-secondary hover:bg-parchment-mid transition-colors cursor-pointer",
              exporting && "opacity-60 cursor-not-allowed",
            )}
          >
            <Download size={11} />
            {exporting ? "Preparing PDF…" : "Export PDF"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {editMode ? (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full h-full px-6 py-6 bg-transparent font-sans text-[13px] text-text-primary leading-[1.72] resize-none outline-none"
          />
        ) : (
          <div className="px-6 py-6 space-y-5">
            {sections.map((section, i) => (
              <div
                key={i}
                className={cn(
                  "pl-4 border-l-[3px]",
                  i === sections.length - 1
                    ? "border-l-gold bg-gold-muted rounded-r-lg pr-4 py-3 -ml-0"
                    : "border-l-border-subtle",
                )}
              >
                <h3 className="font-sans text-[10px] font-bold text-text-muted mb-2">
                  {section.title}
                </h3>
                {section.content.map((line, j) => {
                  const isBullet = /^[-•*]/.test(line);
                  return (
                    <p
                      key={j}
                      className={cn(
                        "font-sans text-[13px] text-text-secondary leading-[1.72]",
                        isBullet && "pl-3 before:content-['•'] before:mr-2 before:text-gold",
                        j > 0 && "mt-1",
                      )}
                    >
                      {isBullet ? line.replace(/^[-•*]\s*/, "") : line}
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
