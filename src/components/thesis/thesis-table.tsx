"use client";

import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ArrowUp, ArrowDown, Sparkles, MoreHorizontal } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { statusLabels } from "./thesis-types";
import type { ThesisItem } from "./thesis-types";
import type { BadgeVariant } from "@/components/ui/badge";

const convictionMap: Record<string, BadgeVariant> = {
  HIGH: "gold",
  BULLISH: "bullish",
  MEDIUM: "neutral",
  BEARISH: "bearish",
  WATCH: "neutral",
};

type SortKey = "title" | "conviction" | "sector" | "status" | "updatedAt";
type SortDir = "asc" | "desc";

interface ThesisTableProps {
  theses: ThesisItem[];
  onUpdate?: (updated: ThesisItem) => void;
}

export function ThesisTable({ theses, onUpdate }: ThesisTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedThesis, setSelectedThesis] = useState<ThesisItem | null>(null);
  const [memoThesis, setMemoThesis] = useState<ThesisItem | null>(null);

  const sorted = useMemo(() => {
    return [...theses].sort((a, b) => {
      const aVal = a[sortKey] ?? "";
      const bVal = b[sortKey] ?? "";
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [theses, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ArrowUp size={10} className="text-gold" />
    ) : (
      <ArrowDown size={10} className="text-gold" />
    );
  }

  return (
    <div className="px-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[280px]">
              <button type="button" onClick={() => toggleSort("title")} className="inline-flex items-center gap-1 cursor-pointer">
                Thesis <SortIcon col="title" />
              </button>
            </TableHead>
            <TableHead className="w-[90px]">
              <button type="button" onClick={() => toggleSort("conviction")} className="inline-flex items-center gap-1 cursor-pointer">
                Conviction <SortIcon col="conviction" />
              </button>
            </TableHead>
            <TableHead className="w-[140px]">
              <button type="button" onClick={() => toggleSort("sector")} className="inline-flex items-center gap-1 cursor-pointer">
                Sector <SortIcon col="sector" />
              </button>
            </TableHead>
            <TableHead className="w-[130px]">
              <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 cursor-pointer">
                Status <SortIcon col="status" />
              </button>
            </TableHead>
            <TableHead>Catalyst</TableHead>
            <TableHead className="w-[60px]">Evid.</TableHead>
            <TableHead className="w-[100px]">
              <button type="button" onClick={() => toggleSort("updatedAt")} className="inline-flex items-center gap-1 cursor-pointer">
                Updated <SortIcon col="updatedAt" />
              </button>
            </TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((thesis) => (
            <TableRow
              key={thesis.id}
              className="group cursor-pointer"
              onClick={() => setSelectedThesis(thesis)}
            >
              <TableCell>
                <span className="font-display text-[13px] font-bold text-espresso">
                  {thesis.title}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={convictionMap[thesis.conviction ?? ""] ?? "muted"}>
                  {thesis.conviction ?? "—"}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="font-sans text-[12px] text-text-secondary">
                  {thesis.sector}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="muted">{statusLabels[thesis.status]}</Badge>
              </TableCell>
              <TableCell>
                <span className="font-sans text-[11px] text-text-muted line-clamp-1">
                  {thesis.catalyst ?? "—"}
                </span>
              </TableCell>
              <TableCell>
                <span className="font-data text-[11px] text-text-faint">
                  {thesis.evidence_chain?.length ?? 0}
                </span>
              </TableCell>
              <TableCell>
                <span className="font-data text-[11px] text-text-faint">
                  {thesis.updatedAt}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMemoThesis(thesis);
                    }}
                    className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer"
                    aria-label="Generate memo"
                  >
                    <Sparkles size={11} className="text-gold" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer"
                    aria-label="More"
                  >
                    <MoreHorizontal size={11} className="text-text-faint" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {memoThesis && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoThesis(null)}
          title={memoThesis.title}
          content={[memoThesis.title, memoThesis.summary, memoThesis.rationale || ""].join("\n\n")}
          type="thesis"
        />
      )}
    </div>
  );
}
