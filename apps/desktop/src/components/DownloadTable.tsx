import { ArrowDown, ArrowUp, Check, Columns3 } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

import { clampWidth, type Column, type ColumnId, COLUMNS, columnsOf, FIXED, fit, MAX_WIDTH, MIN_WIDTH, nextSort, queueRanks, sortOf, sortText, widest } from "../lib/columns";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { visibleItems } from "../state/downloads";
import { DownloadRow } from "./DownloadRow";
import { RowMenu } from "./RowMenu";

function ColumnMenu({ shown, onChange }: { shown: readonly Column[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);
  const ids = new Set(shown.map((column) => column.id));
  return (
    <div ref={box} className="relative flex justify-end">
      <button
        ref={trigger}
        type="button"
        aria-label="Columns"
        title="Columns"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen(!open);
        }}
        className="inline-flex size-6 items-center justify-center rounded-xs text-ink-muted hover:bg-hover hover:text-ink"
      >
        <Columns3 {...ICON} size={14} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Columns"
          tabIndex={-1}
          onKeyDown={(event) => {
            const all = items();
            const at = all.findIndex((item) => item === document.activeElement);
            const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
            if (event.key === "Escape" || event.key === "Tab") {
              event.stopPropagation();
              if (event.key === "Escape") event.preventDefault();
              close();
            } else if (to !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              all[(to + all.length) % all.length]?.focus();
            }
          }}
          className="absolute top-7 right-0 z-20 flex w-48 flex-col gap-0.5 rounded-md border border-line bg-surface-raised p-1 shadow-dialog"
        >
          {COLUMNS.filter((column) => !FIXED.includes(column.id)).map((column) => {
            const on = ids.has(column.id);
            return (
              <button
                key={column.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => {
                  const next = COLUMNS.filter((c) => (c.id === column.id ? !on : ids.has(c.id))).map((c) => c.id);
                  onChange(next);
                }}
                className="flex h-7 items-center gap-2 rounded-xs px-2 text-left text-body text-ink hover:bg-hover"
              >
                <span className="flex size-4 items-center justify-center">{on && <Check {...ICON} size={14} />}</span>
                {column.label}
              </button>
            );
          })}
        </div>
      )}
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
  const endDrag = useDownloads((s) => s.endDrag);
  const chosen = columnsOf(settings);
  // The empty view can take the table's place while its menu is open or a row
  // is in a drag, and a row that goes sends no dragend.
  useEffect(
    () => () => {
      closeMenu();
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
                  className="relative h-8 px-2 first:pl-3"
                >
                  <button
                    type="button"
                    title={column.id === "queue" ? "Sort by the queue to drag waiting downloads into order" : undefined}
                    onClick={() => {
                      void savePreference({ sort: sortText(nextSort(sort, column)) }, "the sort");
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
            <th scope="col" className="h-8 pr-2">
              <ColumnMenu
                shown={chosen}
                onChange={(ids) => {
                  void savePreference({ columns: ids }, "the columns");
                }}
              />
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
      <RowMenu />
    </div>
  );
}
