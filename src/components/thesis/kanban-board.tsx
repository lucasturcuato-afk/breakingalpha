"use client";

import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { ThesisCard } from "./thesis-card";
import type { ThesisItem, ThesisStatus } from "./thesis-types";

// ── Column definitions ──

const KANBAN_COLUMNS = [
  { id: "pending_review", label: "Pending Review" },
  { id: "HIGH", label: "HIGH" },
  { id: "MEDIUM", label: "MEDIUM" },
  { id: "WATCH", label: "WATCH" },
  { id: "archived", label: "Archived" },
] as const;

type ColumnId = (typeof KANBAN_COLUMNS)[number]["id"];

function thesisToColumn(t: ThesisItem): ColumnId {
  if (t.status === "pending_review") return "pending_review";
  if (t.status === "archived") return "archived";
  const conv = t.conviction;
  if (conv === "HIGH" || conv === "BULLISH") return "HIGH";
  if (conv === "MEDIUM") return "MEDIUM";
  return "WATCH";
}

// ── Draggable card wrapper ──

function DraggableCard({
  thesis,
  isSelected,
  onSelect,
}: {
  thesis: ThesisItem;
  isSelected: boolean;
  onSelect?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: thesis.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onSelect?.(thesis.id)}
      className={cn("cursor-grab", isDragging && "opacity-30")}
    >
      <ThesisCard thesis={thesis} isSelected={isSelected} />
    </div>
  );
}

// ── Droppable column wrapper ──

function DroppableColumn({
  columnId,
  label,
  items,
  isOver,
  onSelect,
  selectedId,
}: {
  columnId: string;
  label: string;
  items: ThesisItem[];
  isOver: boolean;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  const { setNodeRef } = useDroppable({ id: columnId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-[280px] flex flex-col rounded-xl border transition-colors",
        isOver
          ? "border-gold bg-gold-muted/20"
          : "border-border-base bg-parchment",
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-base">
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
      <div className="flex-1 space-y-2 overflow-y-auto p-2 min-h-[120px]">
        {items.length === 0 ? (
          <div className="border border-dashed border-border-base rounded-xl p-4 flex items-center justify-center">
            <p className="font-sans text-[11px] text-text-faint italic">
              No theses here
            </p>
          </div>
        ) : (
          items.map((thesis) => (
            <DraggableCard
              key={thesis.id}
              thesis={thesis}
              isSelected={thesis.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main KanbanBoard ──

interface KanbanBoardProps {
  theses: ThesisItem[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  onUpdate?: (updated: ThesisItem) => void;
  filter?: string;
  onQuickAction?: (id: string, status: string) => void;
  onDrop?: (id: string, patch: { status?: string; conviction?: string }) => void;
}

export function KanbanBoard({
  theses,
  onSelect,
  selectedId,
  filter,
  onDrop,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const columns = useMemo(() => {
    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      items: theses.filter((t) => thesisToColumn(t) === col.id),
    }));
  }, [theses]);

  const activeThesis = useMemo(
    () => (activeId ? theses.find((t) => t.id === activeId) ?? null : null),
    [activeId, theses],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverColumnId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverColumnId(null);

      if (!over) return;
      const targetCol = String(over.id) as ColumnId;
      const thesis = theses.find((t) => t.id === String(active.id));
      if (!thesis) return;

      // Already in this column?
      if (thesisToColumn(thesis) === targetCol) return;

      // Determine patch
      let patch: { status?: string; conviction?: string } = {};
      switch (targetCol) {
        case "pending_review":
          patch = { status: "pending_review" };
          break;
        case "HIGH":
          patch = { status: "active", conviction: "HIGH" };
          break;
        case "MEDIUM":
          patch = { status: "active", conviction: "MEDIUM" };
          break;
        case "WATCH":
          patch = { status: "active", conviction: "WATCH" };
          break;
        case "archived":
          patch = { status: "archived" };
          break;
      }

      onDrop?.(String(active.id), patch);
    },
    [theses, onDrop],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverColumnId(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-320px)]">
        {columns.map((col) => (
          <DroppableColumn
            key={col.id}
            columnId={col.id}
            label={col.label}
            items={col.items}
            isOver={overColumnId === col.id}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        ))}
      </div>

      <DragOverlay>
        {activeThesis ? (
          <div className="opacity-50 scale-105 cursor-grabbing">
            <ThesisCard thesis={activeThesis} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
