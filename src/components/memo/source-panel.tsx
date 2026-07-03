"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

const dealTypes = [
  "M&A",
  "Acquisition",
  "Merger",
  "LBO",
  "Growth Equity",
  "Recapitalization",
  "Divestiture",
  "SPAC",
  "IPO",
  "Secondary",
];

const sectors = [
  "Technology",
  "Healthcare",
  "Fintech",
  "Energy",
  "Consumer",
  "Real Estate",
  "Industrials",
  "Financial Services",
  "Media",
];

export interface MemoSourceData {
  company: string;
  acquirer: string;
  dealType: string;
  value: string;
  sector: string;
  description: string;
}

interface SourcePanelProps {
  onGenerate: (data: MemoSourceData) => void;
  generating?: boolean;
  initialCompany?: string;
}

export function SourcePanel({ onGenerate, generating = false, initialCompany = "" }: SourcePanelProps) {
  const [form, setForm] = useState<MemoSourceData>({
    company: initialCompany,
    acquirer: "",
    dealType: "",
    value: "",
    sector: "",
    description: "",
  });

  const update = useCallback(
    (key: keyof MemoSourceData, val: string) =>
      setForm((prev) => ({ ...prev, [key]: val })),
    [],
  );

  const canGenerate = form.company.trim().length > 0;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border-base">
        <h2 className="font-sans text-[10px] font-semibold text-text-muted">
          Deal Source
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
        {/* Company (required) */}
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
            Target / Company <span className="text-signal-dn">*</span>
          </label>
          <Input
            value={form.company}
            onChange={(e) => update("company", e.target.value)}
            placeholder="e.g. Figma"
          />
        </div>

        {/* Acquirer */}
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
            Acquirer
          </label>
          <Input
            value={form.acquirer}
            onChange={(e) => update("acquirer", e.target.value)}
            placeholder="e.g. Adobe"
          />
        </div>

        {/* Deal Type */}
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
            Deal Type
          </label>
          <select
            value={form.dealType}
            onChange={(e) => update("dealType", e.target.value)}
            className={cn(
              "flex h-9 w-full rounded-lg border border-border-base bg-parchment-mid px-3 py-2",
              "font-sans text-[13px] text-text-primary",
              "transition-colors duration-[var(--duration-base)]",
              "hover:border-border-hover focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold-border",
              "cursor-pointer",
              !form.dealType && "text-text-faint",
            )}
          >
            <option value="">Select type...</option>
            {dealTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Deal Value */}
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
            Deal Value
          </label>
          <Input
            value={form.value}
            onChange={(e) => update("value", e.target.value)}
            placeholder="e.g. $20B"
          />
        </div>

        {/* Sector */}
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
            Sector
          </label>
          <select
            value={form.sector}
            onChange={(e) => update("sector", e.target.value)}
            className={cn(
              "flex h-9 w-full rounded-lg border border-border-base bg-parchment-mid px-3 py-2",
              "font-sans text-[13px] text-text-primary",
              "transition-colors duration-[var(--duration-base)]",
              "hover:border-border-hover focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold-border",
              "cursor-pointer",
              !form.sector && "text-text-faint",
            )}
          >
            <option value="">Select sector...</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Additional Context */}
        <div>
          <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
            Additional Context
          </label>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Paste article text, deal rationale, or notes..."
            rows={5}
            className={cn(
              "flex w-full rounded-lg border border-border-base bg-parchment-mid px-3 py-2",
              "font-sans text-[13px] text-text-primary placeholder:text-text-faint",
              "transition-colors duration-[var(--duration-base)]",
              "hover:border-border-hover focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold-border",
              "resize-none",
            )}
          />
        </div>
      </div>

      {/* Generate button */}
      <div className="px-4 py-3 border-t border-border-base">
        <Button
          variant="gold"
          size="lg"
          className="w-full"
          disabled={!canGenerate || generating}
          onClick={() => onGenerate(form)}
        >
          <Sparkles size={13} />
          {generating ? "Generating..." : "Generate Memo"}
        </Button>
      </div>
    </div>
  );
}
