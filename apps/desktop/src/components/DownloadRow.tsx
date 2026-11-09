import { RotateCw } from "lucide-react";
import { memo, type ReactNode, useEffect, useRef } from "react";

import type { Download } from "../backend/backend";
import { type Column, type ColumnId, hostOf, typeOf } from "../lib/columns";
import { formatBytes, formatDate, formatDuration, formatPercent, formatSpeed, percentOf, sentence, shortDir } from "../lib/format";
import { ICON, STATES } from "../lib/states";
import { ROW_DRAG } from "../lib/dom";
import { useDownloads, useDownloadsStore } from "../state/context";
import { Button } from "./Button";

export interface DownloadRowProps {
  download: Download;
  columns: readonly Column[];
  rank: number | undefined;
  // The row that Tab reaches: the selected one, else the first.
  tabbable: boolean;
  // The queue's order when the table is sorted by it; only then can a row be dragged.
  queueOrder: "up" | "down" | null;
}

const CELL = "h-8 px-2 first:pl-3 last:pr-3 whitespace-nowrap overflow-hidden";

export const DownloadRow = memo(function DownloadRow({ download, columns, rank, tabbable, queueOrder }: DownloadRowProps) {
  const store = useDownloadsStore();
  const live = useDownloads((s) => s.live[download.id]);
  const marked = useDownloads((s) => s.marked.includes(download.id));
  const select = useDownloads((s) => s.select);
  const toggleMark = useDownloads((s) => s.toggleMark);
  const markTo = useDownloads((s) => s.markTo);
  const openMenu = useDownloads((s) => s.openMenu);
  const carried = useDownloads((s) => s.dragging?.includes(download.id) ?? false);
  const dropEdge = useDownloads((s) => (s.dropMark?.id === download.id ? s.dropMark.edge : null));
  const startDrag = useDownloads((s) => s.startDrag);
  const markDrop = useDownloads((s) => s.markDrop);
  const endDrag = useDownloads((s) => s.endDrag);
  const moveNextTo = useDownloads((s) => s.moveNextTo);
  const canDrag = queueOrder !== null && download.state === "queued";
  const resume = useDownloads((s) => s.resume);
  const fresh = useDownloads((s) => s.fresh.includes(download.id));
  const settleFresh = useDownloads((s) => s.settleFresh);
  const wantsFocus = useDownloads((s) => s.focusRequest === download.id);
  const requestFocus = useDownloads((s) => s.requestFocus);
  const row = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!wantsFocus) return;
    row.current?.focus();
    requestFocus(null);
  }, [wantsFocus, requestFocus]);

  const look = STATES[download.state];
  const received = live?.received ?? download.received;
  const total = live?.total ?? download.size;
  const running = download.state === "downloading";
  const toggle = () => {
    const { marked: all } = store.getState();
    select(all.length === 1 && all[0] === download.id ? null : download.id);
  };
  const menuAt = (at: { x: number; y: number }) => {
    if (!store.getState().marked.includes(download.id)) select(download.id);
    openMenu(at);
  };

  const cell = (id: ColumnId): ReactNode => {
    switch (id) {
      case "name":
        return <span className="block truncate text-body-strong text-ink">{download.name}</span>;
      case "status":
        return (
          <span className="flex items-center gap-2">
            <look.Icon
              {...ICON}
              className={fresh ? `${look.tone} shrink-0 animate-tug` : `${look.tone} shrink-0`}
              onAnimationEnd={
                fresh
                  ? () => {
                      settleFresh(download.id);
                    }
                  : undefined
              }
            />
            <span className={`text-small ${look.colorWord ? look.tone : "text-ink-muted"}`}>{look.word}</span>
          </span>
        );
      case "progress":
        if (download.state === "failed") {
          return (
            <span className="block truncate text-small text-ink-muted" title={download.error ?? undefined}>
              {sentence(download.error ?? "Tug couldn't finish this download")}
            </span>
          );
        }
        if (download.state === "done") {
          return <span className="block truncate text-small text-ink-muted">{`Saved to ${shortDir(download.dir)}`}</span>;
        }
        if (download.state === "queued") return null;
        return (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
              <span
                className={`block h-full rounded-full transition-[width] duration-100 ease-linear ${running ? "bg-accent" : "bg-ink-faint"}`}
                style={{ width: `${String(percentOf(received, total))}%` }}
              />
            </span>
            <span className="w-9 text-right text-mono text-ink-muted">{formatPercent(received, total) ?? ""}</span>
          </span>
        );
      case "size":
        return <span className="text-mono-strong text-ink">{total === null && received === 0 ? "" : formatBytes(total ?? received)}</span>;
      case "speed":
        return running && live !== undefined && live.speed > 0 ? <span className="text-mono text-ink">{formatSpeed(live.speed)}</span> : null;
      case "left":
        return running && live?.leftMs != null ? <span className="text-mono text-ink">{formatDuration(live.leftMs)}</span> : null;
      case "connections":
        return running && live !== undefined ? <span className="text-mono text-ink">{live.connections}</span> : null;
      case "source":
        return <span className="block truncate text-small text-ink-muted">{hostOf(download)}</span>;
      case "type":
        return <span className="block truncate text-small text-ink-muted">{typeOf(download)}</span>;
      case "added":
        return <span className="text-mono text-ink-muted">{formatDate(download.addedMs)}</span>;
      case "queue":
        return rank === undefined ? null : <span className="text-mono text-ink">{`#${String(rank)}`}</span>;
    }
  };

  return (
    <tr
      ref={row}
      data-download={download.id}
      aria-selected={marked}
      tabIndex={tabbable ? 0 : -1}
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey) toggleMark(download.id);
        else if (event.shiftKey) {
          markTo(download.id);
          event.currentTarget.focus();
        }
        else toggle();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        menuAt({ x: event.clientX, y: event.clientY });
      }}
      draggable={canDrag || undefined}
      onDragStart={(event) => {
        if (!canDrag) return;
        const { marked } = store.getState();
        const ids = marked.includes(download.id) ? marked : [download.id];
        if (!marked.includes(download.id)) select(download.id);
        event.dataTransfer.setData(ROW_DRAG, ids.join(","));
        event.dataTransfer.effectAllowed = "move";
        startDrag(ids);
      }}
      onDragOver={(event) => {
        const { dragging } = store.getState();
        if (dragging === null || download.state !== "queued" || dragging.includes(download.id)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const box = event.currentTarget.getBoundingClientRect();
        markDrop({ id: download.id, edge: event.clientY - box.top < box.height / 2 ? "top" : "bottom" });
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (store.getState().dropMark?.id === download.id) markDrop(null);
      }}
      onDrop={(event) => {
        const { dragging, dropMark } = store.getState();
        if (dragging === null || dropMark?.id !== download.id) return;
        event.preventDefault();
        // The top half of a row lands before it in the view, which is after it in a falling queue.
        const below = dropMark.edge === "bottom";
        endDrag();
        void moveNextTo(dragging, download.id, queueOrder === "down" ? !below : below);
      }}
      onDragEnd={endDrag}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          menuAt({ x: box.left + 24, y: box.bottom });
        } else if (event.key === " " && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          toggleMark(download.id);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
      className={`cursor-default border-t border-line transition-colors duration-(--duration-fast) ease-(--ease-out) outline-offset-[-2px] first:border-t-0 hover:bg-hover focus-visible:bg-selection aria-selected:bg-selection ${carried ? "opacity-60" : ""} ${dropEdge === "top" ? "shadow-[inset_0_2px_0_var(--color-accent)]" : dropEdge === "bottom" ? "shadow-[inset_0_-2px_0_var(--color-accent)]" : ""}`}
    >
      {columns.map((column) => (
        <td key={column.id} className={`${CELL} ${column.numeric ? "text-right" : "text-left"}`}>
          {cell(column.id)}
        </td>
      ))}
      <td className="w-8 pr-2 text-right">
        {download.state === "failed" && (
          <Button
            size="icon"
            variant="quiet"
            icon={RotateCw}
            aria-label={`Retry ${download.name}`}
            title="Retry"
            onClick={(event) => {
              event.stopPropagation();
              void resume(download.id);
            }}
          />
        )}
      </td>
    </tr>
  );
});
