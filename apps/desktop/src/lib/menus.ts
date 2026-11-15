import {
  ArrowDown,
  ArrowUp,
  CirclePause,
  CirclePlay,
  Clock,
  Copy,
  Eye,
  ExternalLink,
  FolderOpen,
  ListChecks,
  ListEnd,
  ListStart,
  ListX,
  type LucideIcon,
  MoveHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import type { Download, SavedView } from "../backend/backend";
import { canPauseAll, canRename, canResumeAll, chosen, type DownloadsState, hasFinished, inView, type MenuOn, VIEWS, type View, visibleItems } from "../state/downloads";
import { CATEGORIES } from "./categories";
import { type ColumnId, COLUMNS, columnsOf, FIXED, sortOf, sortText } from "./columns";
import { KEYS } from "./commands";
import { MB, megabytes } from "./format";
import { limitInForce } from "./schedule";

export interface MenuEntry {
  id: string;
  label: string;
  icon?: LucideIcon;
  keys?: readonly string[];
  // A checkbox leaves the menu open, so several can change; a radio closes it.
  check?: { kind: "checkbox" | "radio"; on: boolean };
  // A dialog takes the focus; other entries give it back.
  keepsFocus?: boolean;
  // Shown for what it says; it does nothing and the arrows pass it.
  disabled?: boolean;
  run: () => void;
}

export interface MenuModel {
  label: string;
  groups: MenuEntry[][];
}

export const LIMIT_PRESETS: readonly number[] = [1, 2, 5, 10, 20, 50].map((n) => n * MB);

export function limitLabel(bytes: number): string {
  return `${megabytes(bytes)} MB/s`;
}

export function menuFor(on: MenuOn, state: DownloadsState, now = new Date()): MenuModel {
  switch (on.kind) {
    case "rows":
      return rowMenu(state);
    case "columns":
      return { label: "Columns", groups: columnGroups(state, on.column) };
    case "list":
      return { label: "Downloads", groups: listGroups(state) };
    case "view":
      return { label: viewLabel(on.view), groups: viewGroups(state, on.view) };
    case "saved":
      return { label: on.saved.name, groups: savedGroups(state, on.saved) };
    case "status":
      return { label: "Status", groups: statusGroups(state, now) };
  }
}

function filled(groups: MenuEntry[][]): MenuEntry[][] {
  return groups.filter((group) => group.length > 0);
}

function count(n: number): string {
  return n === 1 ? "1 download" : `${String(n)} downloads`;
}

function rowMenu(state: DownloadsState): MenuModel {
  const list = chosen(state);
  const [first] = list;
  const label = list.length === 1 && first !== undefined ? first.name : count(list.length);
  return { label, groups: list.length === 0 ? [] : rowGroups(list, state) };
}

export function rowGroups(list: readonly Download[], state: DownloadsState): MenuEntry[][] {
  const ids = list.map((item) => item.id);
  const any = (...states: Download["state"][]) => list.some((item) => states.includes(item.state));
  const [first] = list;
  const one = list.length === 1 ? first : undefined;
  const open: MenuEntry[] = [];
  if (one?.state === "done") open.push({ id: "open", label: "Open", icon: ExternalLink, keys: KEYS.open.label, run: () => void state.openFile(one.id) });
  if (one !== undefined) open.push({ id: "folder", label: "Open folder", icon: FolderOpen, run: () => void state.showInFolder(one.id) });
  if (one !== undefined && canRename(one)) {
    open.push({
      id: "rename",
      label: "Rename…",
      icon: Pencil,
      keys: KEYS.rename.label,
      keepsFocus: true,
      run: () => {
        state.startRename(one.id);
      },
    });
  }
  open.push({
    id: "copy",
    label: one === undefined ? "Copy links" : "Copy link",
    icon: Copy,
    run: () => {
      navigator.clipboard.writeText(list.map((item) => item.url).join("\n")).catch(() => {
        state.notify(one === undefined ? "couldn't copy the links" : "couldn't copy the link");
      });
    },
  });
  const act: MenuEntry[] = [];
  if (any("queued")) {
    act.push({ id: "start-next", label: "Start next", icon: ListStart, run: () => void state.moveMany(ids, "first") });
    if (one !== undefined) {
      act.push(
        { id: "move-up", label: "Move up", icon: ArrowUp, keys: KEYS.moveUp.label, run: () => void state.moveOne(one.id, "up") },
        { id: "move-down", label: "Move down", icon: ArrowDown, keys: KEYS.moveDown.label, run: () => void state.moveOne(one.id, "down") },
      );
    }
    act.push({ id: "move-last", label: "Move to the end", icon: ListEnd, run: () => void state.moveMany(ids, "last") });
  }
  // P pauses a selection with anything running, else it resumes or retries.
  const pausing = any("downloading", "queued");
  const toggle = pausing ? {} : { keys: KEYS.toggle.label };
  if (pausing) act.push({ id: "pause", label: "Pause", icon: Pause, keys: KEYS.toggle.label, run: () => void state.pauseMany(ids) });
  if (any("paused")) act.push({ id: "resume", label: "Resume", icon: Play, ...toggle, run: () => void state.resumeMany(ids) });
  else if (any("failed")) act.push({ id: "retry", label: "Retry", icon: RotateCw, ...toggle, run: () => void state.resumeMany(ids) });
  const remove: MenuEntry[] = [
    {
      id: "remove",
      label: "Remove…",
      icon: Trash2,
      keys: KEYS.remove.label,
      keepsFocus: true,
      run: () => {
        state.askRemove(ids);
      },
    },
  ];
  return filled([open, act, remove]);
}

function columnGroups(state: DownloadsState, column: ColumnId | null): MenuEntry[][] {
  const sort = sortOf(state.settings);
  const sortBy = (down: boolean) => () => {
    if (column !== null) void state.savePreference({ sort: sortText({ by: column, down }) }, "the sort");
  };
  const order: MenuEntry[] =
    column === null
      ? []
      : [
          { id: "sort-up", label: "Sort ascending", check: { kind: "radio", on: sort.by === column && !sort.down }, run: sortBy(false) },
          { id: "sort-down", label: "Sort descending", check: { kind: "radio", on: sort.by === column && sort.down }, run: sortBy(true) },
        ];
  const shown = new Set(columnsOf(state.settings).map((c) => c.id));
  const columns = COLUMNS.filter((c) => !FIXED.includes(c.id)).map(
    (c): MenuEntry => ({
      id: `column-${c.id}`,
      label: c.label,
      check: { kind: "checkbox", on: shown.has(c.id) },
      run: () => {
        // From the settings the save lands on, so quick clicks each count.
        void state.savePreference((current) => {
          const now = new Set(columnsOf(current).map((other) => other.id));
          return { columns: COLUMNS.filter((other) => (other.id === c.id ? !now.has(c.id) : now.has(other.id))).map((other) => other.id) };
        }, "the columns");
      },
    }),
  );
  const widths: MenuEntry[] =
    Object.keys(state.settings?.widths ?? {}).length === 0
      ? []
      : [
          {
            id: "reset-widths",
            label: "Reset column widths",
            icon: MoveHorizontal,
            run: () => void state.savePreference({ widths: {} }, "the column widths"),
          },
        ];
  return filled([order, columns, widths]);
}

function allGroup(state: DownloadsState): MenuEntry[] {
  const group: MenuEntry[] = [];
  if (canPauseAll(state.items)) {
    group.push({ id: "pause-all", label: "Pause all", icon: CirclePause, run: () => void state.pauseAll() });
  }
  if (canResumeAll(state.items)) {
    group.push({ id: "resume-all", label: "Resume all", icon: CirclePlay, run: () => void state.resumeAll() });
  }
  return group;
}

function listGroups(state: DownloadsState): MenuEntry[][] {
  const start: MenuEntry[] = [
    {
      id: "add",
      label: "Add downloads…",
      icon: Plus,
      keys: KEYS.add.label,
      keepsFocus: true,
      run: () => {
        state.openAdd();
      },
    },
  ];
  if (visibleItems(state).length > 0) {
    start.push({
      id: "select-all",
      label: "Select all",
      icon: ListChecks,
      keys: KEYS.selectAll.label,
      run: () => {
        state.markAll();
      },
    });
  }
  const clear: MenuEntry[] = hasFinished(state)
    ? [
        {
          id: "clear",
          label: "Clear finished…",
          icon: ListX,
          keepsFocus: true,
          run: () => {
            state.askClearFinished();
          },
        },
      ]
    : [];
  return filled([start, allGroup(state), clear]);
}

export function viewLabel(view: View): string {
  return VIEWS.find((v) => v.id === view)?.label ?? CATEGORIES.find((category) => category.id === view)?.label ?? view;
}

function viewGroups(state: DownloadsState, view: View): MenuEntry[][] {
  const list = state.items.filter((item) => inView(view, item));
  const n = (...states: Download["state"][]) => list.filter((item) => states.includes(item.state)).length;
  const open: MenuEntry[] = [
    {
      id: "open",
      label: "Open",
      icon: Eye,
      run: () => {
        state.setView(view);
      },
    },
  ];
  const act: MenuEntry[] = [];
  const running = n("downloading", "queued");
  if (running > 0) act.push({ id: "pause", label: `Pause ${count(running)}`, icon: Pause, run: () => void state.pauseIn(view) });
  const paused = n("paused");
  if (paused > 0) act.push({ id: "resume", label: `Resume ${count(paused)}`, icon: Play, run: () => void state.resumeIn(view, "paused") });
  const failed = n("failed");
  if (failed > 0) act.push({ id: "retry", label: `Retry ${count(failed)}`, icon: RotateCw, run: () => void state.resumeIn(view, "failed") });
  const done = n("done");
  // The dialog lists what the list shows, so the view opens without the search first.
  const clear: MenuEntry[] =
    done === 0
      ? []
      : [
          {
            id: "clear",
            label: done === 1 ? "Clear 1 finished…" : `Clear ${String(done)} finished…`,
            icon: ListX,
            keepsFocus: true,
            run: () => {
              state.setView(view);
              state.setSearch("");
              state.askClearFinished();
            },
          },
        ];
  return filled([open, act, clear]);
}

function savedGroups(state: DownloadsState, saved: SavedView): MenuEntry[][] {
  return [
    [
      {
        id: "open",
        label: "Open",
        icon: Eye,
        run: () => {
          state.openView(saved);
        },
      },
      {
        id: "remove",
        label: "Remove",
        icon: X,
        run: () => {
          state.removeView(saved);
        },
      },
    ],
  ];
}

function statusGroups(state: DownloadsState, at: Date): MenuEntry[][] {
  const { settings } = state;
  const limits: MenuEntry[] = [];
  if (settings !== null) {
    // The radios set the plain limit; while the slower hours hold a lower one, the menu says so.
    const held = limitInForce(settings, at);
    if (held.slower && held.limit !== null) {
      limits.push({ id: "slower", label: `Slower hours: ${limitLabel(held.limit)}`, icon: Clock, disabled: true, run: () => undefined });
    }
    const now = settings.speedLimit;
    const setLimit = (speedLimit: number | null) => () => void state.savePreference({ speedLimit }, "the speed limit");
    const presets = now === null || LIMIT_PRESETS.includes(now) ? LIMIT_PRESETS : [...LIMIT_PRESETS, now].sort((a, b) => a - b);
    limits.push(
      { id: "limit-none", label: "No limit", check: { kind: "radio", on: now === null }, run: setLimit(null) },
      ...presets.map((bytes): MenuEntry => ({ id: `limit-${String(bytes)}`, label: limitLabel(bytes), check: { kind: "radio", on: now === bytes }, run: setLimit(bytes) })),
    );
  }
  const more: MenuEntry[] = [
    {
      id: "settings",
      label: "Speed settings…",
      icon: Settings,
      keys: KEYS.settings.label,
      keepsFocus: true,
      run: () => {
        state.setPage("settings");
      },
    },
  ];
  return filled([limits, allGroup(state), more]);
}
