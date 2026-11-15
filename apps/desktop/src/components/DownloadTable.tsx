import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

import { clampWidth, type Column, type ColumnId, columnsOf, fit, MAX_WIDTH, MIN_WIDTH, nextSort, queueRanks, sortOf, sortText, widest } from "../lib/columns";
import { menuPoint } from "../lib/dom";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { visibleItems } from "../state/downloads";
import { isMenuKey, under } from "./ContextMenu";
import { DownloadRow } from "./DownloadRow";

// The Columns button opens the same menu as a right-click on the header, without the sort.
function ColumnsButton() {
  const open = useDownloads((s) => s.menu?.on.kind === "columns" && s.menu.on.column === null);
  const openMenu = useDownloads((s) => s.openMenu);
  const closeMenu = useDownloads((s) => s.closeMenu);
  return (
    <div className="flex justify-end">
      <button
        type="button"
        aria-label="Columns"
        title="Columns"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          if (open) {
            closeMenu();
            return;
          }
          const box = event.currentTarget.getBoundingClientRect();
          openMenu({ x: box.right, y: box.bottom + 4, end: true }, { kind: "columns", column: null });
        }}
        className="inline-flex size-6 items-center justify-center rounded-xs text-ink-muted hover:bg-hover hover:text-ink"
      >
        <Columns3 {...ICON} size={14} />
      </button>
    </div>
  );
}

// Drag, or the arrow keys, set a column's width; a double-click gives back its own.
function ResizeHandle({ column, most, onLive, onSave }: { column: Column; most: number; onLive: (px: number | null) => void; onSave: (px: number | null) => void }) {
  const px = column.px ?? MIN_WIDTH;
  const start = useRef<{ x: number; px: number } | null>(null);
  const to = (event: PointerEvent) => (start.current === null ? px : Math.min(most, clampWidth(start.current.px + event.clientX - start.current.x)));
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 32 : 8;
    const next = { ArrowLeft: px - step, ArrowRight: px + step }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onSave(Math.min(most, clampWidth(next)));
  };
  return (
    // A focusable separator is ARIA's window splitter, a widget the keys move.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Width of ${column.label}`}
      aria-valuenow={px}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={Math.min(MAX_WIDTH, most)}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      title="Drag to set the width; double-click for the usual one"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, px };
      }}
      onPointerMove={(event) => {
        if (start.current !== null) onLive(to(event));
      }}
      onPointerUp={(event) => {
        if (start.current === null) return;
        const next = to(event);
        const before = start.current.px;
        start.current = null;
        onLive(null);
        if (next !== before) onSave(next);
      }}
      onLostPointerCapture={() => {
        if (start.current === null) return;
        start.current = null;
        onLive(null);
      }}
      onDoubleClick={() => {
        onSave(null);
      }}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-offset-[-2px] after:absolute after:inset-y-2 after:left-[3.5px] after:w-px after:bg-transparent hover:after:bg-control-border focus-visible:after:bg-control-border"
    />
  );
}

export function DownloadTable({ title }: { title: string }) {
  const items = useDownloads(useShallow((s) => visibleItems(s)));
  const selected = useDownloads((s) => s.selected);
  const settings = useDownloads((s) => s.settings);
  const allItems = useDownloads((s) => s.items);
  const savePreference = useDownloads((s) => s.savePreference);
  const closeMenu = useDownloads((s) => s.closeMenu);
  const openMenu = useDownloads((s) => s.openMenu);
  const endDrag = useDownloads((s) => s.endDrag);
  const chosen = columnsOf(settings);
  // The empty view can take the table's place while its menu is open or a row
  // is in a drag, and a row that goes sends no dragend.
  useEffect(
    () => () => {
      closeMenu(["rows", "columns"]);
      endDrag();
    },
    [closeMenu, endDrag],
  );
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = box.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, []);
  const [live, setLive] = useState<{ id: ColumnId; px: number } | null>(null);
  const sized = live === null ? chosen : chosen.map((column) => (column.id === live.id ? { ...column, px: live.px } : column));
  const columns = fit(sized, width);
  const saveWidth = (id: ColumnId, px: number | null) => {
    void savePreference((current) => {
      const rest = Object.fromEntries(Object.entries(current.widths).filter(([column]) => column !== id));
      return { widths: px === null ? rest : { ...rest, [id]: px } };
    }, "the column widths");
  };
  const sort = sortOf(settings);
  const queueOrder = sort.by === "queue" ? (sort.down ? "down" : "up") : null;
  const ranks = useMemo(() => queueRanks(allItems), [allItems]);
  const tabbable = items.some((item) => item.id === selected) ? selected : (items[0]?.id ?? null);

  return (
    <div ref={box} className="min-h-0 flex-1 overflow-auto">
      <table role="grid" aria-label={title} aria-multiselectable="true" className="w-full table-fixed border-collapse">
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={column.px === undefined ? undefined : { width: column.px }} />
          ))}
          <col className="w-8" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line">
            {columns.map((column) => {
              const active = sort.by === column.id;
              const Arrow = sort.down ? ArrowDown : ArrowUp;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-label={column.label}
                  aria-sort={active ? (sort.down ? "descending" : "ascending") : "none"}
                  onContextMenu={(event) => {
                    const at = menuPoint(event);
                    if (at !== null) openMenu(at, { kind: "columns", column: column.id });
                  }}
                  className="relative h-8 px-2 first:pl-3"
                >
                  <button
                    type="button"
                    title={column.id === "queue" ? "Sort by the queue to drag waiting downloads into order" : undefined}
                    onClick={() => {
                      void savePreference({ sort: sortText(nextSort(sort, column)) }, "the sort");
                    }}
                    onKeyDown={(event) => {
                      if (!isMenuKey(event)) return;
                      event.preventDefault();
                      openMenu(under(event.currentTarget, 0), { kind: "columns", column: column.id });
                    }}
                    className={`flex w-full items-center gap-1 text-label ${active ? "text-ink" : "text-ink-muted"} hover:text-ink ${column.numeric ? "justify-end" : "justify-start"}`}
                  >
                    {column.label}
                    {active && <Arrow {...ICON} size={12} />}
                  </button>
                  {column.px !== undefined && (
                    <ResizeHandle
                      column={column}
                      most={widest(columns, column.id, width)}
                      onLive={(px) => {
                        setLive(px === null ? null : { id: column.id, px });
                      }}
                      onSave={(px) => {
                        saveWidth(column.id, px);
                      }}
                    />
                  )}
                </th>
              );
            })}
            <th
              scope="col"
              onContextMenu={(event) => {
                const at = menuPoint(event);
                if (at !== null) openMenu(at, { kind: "columns", column: null });
              }}
              className="h-8 pr-2"
            >
              <ColumnsButton />
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((download) => (
            <DownloadRow
              key={download.id}
              download={download}
              columns={columns}
              rank={ranks.get(download.id)}
              tabbable={download.id === tabbable}
              queueOrder={queueOrder}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
