import type { Download, ProgressUpdate, Settings } from "../backend/backend";
import { CATEGORIES } from "./categories";
import { percentOf } from "./format";

export type ColumnId = "name" | "status" | "progress" | "size" | "speed" | "left" | "connections" | "source" | "type" | "added" | "queue";

export interface Column {
  id: ColumnId;
  label: string;
  // Width of a fixed column in pixels; the name takes what is left.
  px?: number;
  // Numbers line up on the right.
  numeric: boolean;
  // Sorted down first: the biggest, fastest or newest on top.
  down: boolean;
}

export const COLUMNS: readonly Column[] = [
  { id: "name", label: "Name", numeric: false, down: false },
  { id: "status", label: "Status", px: 112, numeric: false, down: false },
  { id: "progress", label: "Progress", px: 144, numeric: false, down: true },
  { id: "size", label: "Size", px: 96, numeric: true, down: true },
  { id: "speed", label: "Speed", px: 96, numeric: true, down: true },
  { id: "left", label: "Left", px: 64, numeric: true, down: false },
  { id: "connections", label: "Conn.", px: 56, numeric: true, down: true },
  { id: "source", label: "Source", px: 176, numeric: false, down: false },
  { id: "type", label: "Type", px: 112, numeric: false, down: false },
  { id: "added", label: "Added", px: 144, numeric: true, down: true },
  { id: "queue", label: "Queue", px: 64, numeric: true, down: false },
];

// In a narrow list the chosen columns leave in this order, so the name keeps room to read.
const DROP_ORDER: readonly ColumnId[] = ["source", "type", "added", "connections", "left", "queue", "speed", "size", "progress"];
const NAME_ROOM = 160;
const EDGES = 48;

export function fit(columns: readonly Column[], width: number | null): Column[] {
  let shown = [...columns];
  if (width === null) return shown;
  for (const id of DROP_ORDER) {
    const used = shown.reduce((sum, column) => sum + (column.px ?? 0), EDGES);
    if (width - used >= NAME_ROOM) break;
    shown = shown.filter((column) => column.id !== id);
  }
  return shown;
}

// Name and status always show: every download names its state in a word.
export const FIXED: readonly ColumnId[] = ["name", "status"];
export const DEFAULT_COLUMNS: readonly ColumnId[] = ["name", "status", "progress", "size", "speed", "left", "connections", "source"];
export const DEFAULT_SORT: Sort = { by: "added", down: true };

export interface Sort {
  by: ColumnId;
  down: boolean;
}

function isColumn(value: string): value is ColumnId {
  return COLUMNS.some((column) => column.id === value);
}

// The same bounds as tug_core's MIN_COLUMN_WIDTH and MAX_COLUMN_WIDTH.
export const MIN_WIDTH = 40;
export const MAX_WIDTH = 800;

export function clampWidth(px: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));
}

// The chosen columns, each at the width the person dragged it to, else its own.
export function columnsOf(settings: (Pick<Settings, "columns"> & Partial<Pick<Settings, "widths">>) | null): Column[] {
  const chosen = (settings?.columns ?? []).filter(isColumn);
  const ids = new Set<ColumnId>(chosen.length === 0 ? DEFAULT_COLUMNS : [...FIXED, ...chosen]);
  const widths = settings?.widths ?? {};
  return COLUMNS.filter((column) => ids.has(column.id)).map((column) => {
    const px = widths[column.id];
    return column.px === undefined || px === undefined ? column : { ...column, px: clampWidth(px) };
  });
}

// The widest a column can go while the name keeps its room.
export function widest(columns: readonly Column[], id: ColumnId, width: number | null): number {
  if (width === null) return MAX_WIDTH;
  const others = columns.reduce((sum, column) => sum + (column.id === id ? 0 : (column.px ?? 0)), EDGES);
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width - others - NAME_ROOM));
}

export function sortOf(settings: Pick<Settings, "sort"> | null): Sort {
  const text = settings?.sort ?? "";
  const by = text.replace(/^-/, "");
  return isColumn(by) ? { by, down: text.startsWith("-") } : DEFAULT_SORT;
}

export function sortText(sort: Sort): string {
  return `${sort.down ? "-" : ""}${sort.by}`;
}

export function nextSort(current: Sort, column: Column): Sort {
  return current.by === column.id ? { by: column.id, down: !current.down } : { by: column.id, down: column.down };
}

const STATE_ORDER = { downloading: 0, queued: 1, paused: 2, failed: 3, done: 4 } as const;

export function hostOf(download: Download): string {
  try {
    const url = new URL(download.url);
    return url.protocol === "magnet:" ? "torrent" : url.hostname;
  } catch {
    return "";
  }
}

export function typeOf(download: Download): string {
  return CATEGORIES.find((category) => category.id === download.category)?.label ?? "";
}

// The place of each queued download in the queue: 1 starts next.
export function queueRanks(items: readonly Download[]): Map<number, number> {
  const queued = items.filter((item) => item.state === "queued").sort((a, b) => a.position - b.position || a.id - b.id);
  return new Map(queued.map((item, at) => [item.id, at + 1]));
}

type Live = Readonly<Record<number, ProgressUpdate>>;

function key(column: ColumnId, download: Download, live: Live, ranks: Map<number, number>): number | string {
  const now = live[download.id];
  switch (column) {
    case "name":
      return download.name.toLowerCase();
    case "status":
      return STATE_ORDER[download.state];
    case "progress":
      return percentOf(now?.received ?? download.received, now?.total ?? download.size);
    case "size":
      return now?.total ?? download.size ?? download.received;
    case "speed":
      return now?.speed ?? 0;
    case "left":
      return now?.leftMs ?? Number.MAX_SAFE_INTEGER;
    case "connections":
      return now?.connections ?? 0;
    case "source":
      return hostOf(download);
    case "type":
      return typeOf(download);
    case "added":
      return download.addedMs;
    case "queue":
      return ranks.get(download.id) ?? Number.MAX_SAFE_INTEGER;
  }
}

export function sortItems(items: Download[], sort: Sort, live: Live, ranks: Map<number, number>): Download[] {
  const sign = sort.down ? -1 : 1;
  return items.sort((a, b) => {
    const left = key(sort.by, a, live, ranks);
    const right = key(sort.by, b, live, ranks);
    const order = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return sign * order || b.addedMs - a.addedMs || b.id - a.id;
  });
}
