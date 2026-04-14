"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ThesisCard } from "./thesis-card";
import type { ThesisItem } from "./thesis-types";

const KANBAN_COLUMNS: { status: string; label: string }[] = [
  { status: "pending_review", label: "Pending Review" },
  { status: "active", label: "Active" },
  { status: "watch", label: "Watch" },
  { status: "archived", label: "Archived" },
];

// Also map legacy statuses to kanban columns
function mapToKanbanStatus(status: string): string {
  switch (status) {
    case "pending_review": return "pending_review";
    case "active": return "active";
    case "watch": return "watch";
    case "archived": return "archived";
    // Legacy mappings
    case "new-signal": return "pending_review";
    case "exploring": return "active";
    case "draft-thesis": return "active";
    case "needs-evidence": return "watch";
    case "ready-for-memo": return "active";
    default: return "pending_review";
  }
}

interface KanbanBoardProps {
  theses: ThesisItem[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  onUpdate?: (updated: ThesisItem) => void;
  filter?: string;
  onQuickAction?: (id: string, status: string) => void;
}

export function KanbanBoard({ theses, onSelect, selectedId, filter, onQuickAction }: KanbanBoardProps) {
  const columns = useMemo(() => {
    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      items: theses.filter((t) => mapToKanbanStatus(t.status as string) === col.status),
    }));
  }, [theses]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-320px)]">
      {columns.map((col) => (
        <KanbanColumn
          key={col.status}
          status={col.status}
          label={col.label}
          items={col.items}
          onSelect={onSelect}
          selectedId={selectedId}
          onQuickAction={onQuickAction}
        />
      ))}
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  items,
  onSelect,
  selectedId,
  onQuickAction,
}: {
  status: string;
  label: string;
  items: ThesisItem[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  onQuickAction?: (id: string, status: string) => void;
}) {
  return (
    <div className="flex-shrink-0 w-[280px] flex flex-col">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <h3 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          {label}
        </h3>
        <span
          className={cn(
            "min-w-[18px] h-[18px] flex items-center justify-center rounded-md px-1",
            "text-[9px] font-bold",
            items.length > 0
              ? "bg-gold-muted text-gold-dark"
              : "bg-parchment-mid text-text-faint",
          )}
        >
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <div className="border border-dashed border-border-base rounded-xl p-4 flex items-center justify-center">
            <p className="font-sans text-[11px] text-text-faint">No theses</p>
          </div>
        ) : (
          items.map((thesis) => (
            <div
              key={thesis.id}
              onClick={() => onSelect?.(thesis.id)}
              className="cursor-pointer"
            >
              <ThesisCard
                thesis={thesis}
                isSelected={thesis.id === selectedId}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
