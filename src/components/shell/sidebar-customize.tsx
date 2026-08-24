"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff, RotateCcw } from "lucide-react";

/**
 * The sidebar's reorder/hide panel, split out so `@dnd-kit` is not in the
 * shell's entry chunk.
 *
 * Why it is worth a file of its own: the panel renders only when
 * `customizeMode` is true, which starts false and only flips on a click of
 * the pencil control, which itself renders only at `lg` and only when signed
 * in. Before this split, `@dnd-kit/core`, `/sortable` and `/utilities` were
 * pulled into the AppShell chunk that every shell route loads, at every
 * width, on first paint, for a panel almost nobody opens. `sidebar.tsx`
 * loads this through `next/dynamic`, so the bytes arrive on the click that
 * needs them and never on a cold load.
 *
 * The drag reorder lives here rather than in the parent so the parent keeps
 * no `@dnd-kit` import at all: `arrayMove` alone would drag the package back
 * into the entry chunk. The parent owns the preference state and receives the
 * resolved (from, to) ids.
 */

export interface CustomizeItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface SidebarCustomizeProps {
  items: CustomizeItem[];
  order: string[];
  hidden: string[];
  onReorder: (activeId: string, overId: string, nextOrder: string[]) => void;
  onToggleHidden: (id: string) => void;
  onReset: () => void;
}

export function SidebarCustomize({
  items,
  order,
  hidden,
  onReorder,
  onToggleHidden,
  onReset,
}: SidebarCustomizeProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIdx = order.indexOf(activeId);
    const newIdx = order.indexOf(overId);
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(activeId, overId, arrayMove(order, oldIdx, newIdx));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              hidden={hidden.includes(item.id)}
              onToggleHidden={() => onToggleHidden(item.id)}
            />
          ))}
        </ul>
      </SortableContext>
      <button
        type="button"
        onClick={onReset}
        className={cn(
          "flex items-center gap-2 w-full mt-3 px-3 py-2 rounded-lg",
          "font-sans text-[11px] font-medium",
          "text-text-muted hover:bg-parchment-mid hover:text-espresso",
          "transition-colors duration-[var(--duration-base)] cursor-pointer",
        )}
      >
        <RotateCcw size={12} />
        Reset to default
      </button>
    </DndContext>
  );
}

function SortableRow({
  item,
  hidden,
  onToggleHidden,
}: {
  item: CustomizeItem;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 px-2 py-[7px] rounded-lg bg-parchment-mid/60 border border-border-base",
        "dark:bg-elevated dark:border-border-default",
        isDragging && "opacity-70",
        hidden && "opacity-60",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1 rounded-md cursor-grab active:cursor-grabbing text-text-faint hover:text-text-muted touch-none"
        aria-label={`Drag ${item.label}`}
      >
        <GripVertical size={12} />
      </button>
      <span
        className={cn(
          "flex items-center gap-2 flex-1 min-w-0 font-sans text-[12px] font-medium text-text-primary",
          hidden && "line-through text-text-faint",
        )}
      >
        <span className="[&_svg]:text-text-faint">{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </span>
      <button
        type="button"
        onClick={onToggleHidden}
        className="p-1 rounded-md text-text-faint hover:bg-parchment hover:text-espresso cursor-pointer"
        aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
      >
        {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </li>
  );
}
