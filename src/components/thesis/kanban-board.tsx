"use client";

import { cn } from "@/lib/utils";
import { ThesisCard } from "./thesis-card";
import type { ThesisItem, ThesisStatus } from "./thesis-types";
import { statusLabels, statusOrder } from "./thesis-types";

interface KanbanBoardProps {
  theses: ThesisItem[];
  onUpdate?: (updated: ThesisItem) => void;
}

export function KanbanBoard({ theses, onUpdate }: KanbanBoardProps) {
  const columns = statusOrder.map((status) => ({
    status,
    label: statusLabels[status],
    items: theses.filter((t) => t.status === status),
  }));

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 px-6 min-h-[calc(100vh-180px)]">
      {columns.map((col) => (
        <KanbanColumn key={col.status} status={col.status} label={col.label} items={col.items} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  items,
  onUpdate,
}: {
  status: ThesisStatus;
  label: string;
  items: ThesisItem[];
  onUpdate?: (updated: ThesisItem) => void;
}) {
  return (
    <div className="flex-shrink-0 w-[260px] flex flex-col">
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
            <ThesisCard key={thesis.id} thesis={thesis} onUpdate={onUpdate} />
          ))
        )}
      </div>
    </div>
  );
}
