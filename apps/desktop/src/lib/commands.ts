import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkPlus,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderOpen,
  Keyboard,
  Layers,
  ListChecks,
  ListEnd,
  ListStart,
  ListX,
  Settings,
  type LucideIcon,
  Pause,
  Pencil,
  Search,
  Play,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";

import { canRename, chosen, type DownloadsStore, hasFinished, savedViewOf, single, type StateView } from "../state/downloads";
import { CATEGORIES } from "./categories";
import { covering } from "./covering";
import { focusRow } from "./dom";

export interface Keys {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: readonly string[];
}

export type Group = "Downloads" | "Views" | "Selected download" | "Selected downloads" | "Help";

export interface Command {
  id: string;
  title: string;
  group: Group;
  icon: LucideIcon;
  keys?: Keys;
  run: () => void;
}

const VIEW_COMMANDS: readonly { view: StateView; title: string; icon: LucideIcon; key: string }[] = covering<StateView>().by<"view">()([
  { view: "all", title: "Show all downloads", icon: Layers, key: "1" },
  { view: "active", title: "Show active downloads", icon: ArrowDown, key: "2" },
  { view: "done", title: "Show finished downloads", icon: Check, key: "3" },
  { view: "failed", title: "Show failed downloads", icon: CircleAlert, key: "4" },
]);

export function commands(store: DownloadsStore): Command[] {
  const state = store.getState();
  const list: Command[] = [
    {
      id: "add",
      title: "Add downloads",
      group: "Downloads",
      icon: Plus,
      keys: { key: "n", ctrl: true, label: ["Ctrl", "N"] },
      run: () => {
        state.openAdd();
      },
    },
    {
      id: "search",
      title: "Search downloads",
      group: "Downloads",
      icon: Search,
      keys: { key: "f", ctrl: true, label: ["Ctrl", "F"] },
      run: () => {
        state.openSearch();
      },
    },
    ...VIEW_COMMANDS.map(
      ({ view, title, icon, key }): Command => ({
        id: `view-${view}`,
        title,
        group: "Views",
        icon,
        keys: { key, ctrl: true, label: ["Ctrl", key] },
        run: () => {
          state.setView(view);
        },
      }),
    ),
    ...CATEGORIES.filter((category) => state.items.some((item) => item.category === category.id)).map(
      (category): Command => ({
        id: `view-${category.id}`,
        title: category.command,
        group: "Views",
        icon: category.icon,
        run: () => {
          state.setView(category.id);
        },
      }),
    ),
    ...(state.settings?.savedViews ?? []).map(
      (saved): Command => ({
        id: `saved-${saved.view}-${saved.query}`,
        title: `Open ${saved.name}`,
        group: "Views",
        icon: Bookmark,
        run: () => {
          state.openView(saved);
        },
      }),
    ),
  ];
  if (state.search.trim() !== "" && savedViewOf(state) === null) {
    list.push({
      id: "save-view",
      title: "Save this search as a view",
      group: "Views",
      icon: BookmarkPlus,
      run: () => {
        state.saveView();
      },
    });
  }

  const toggle = { key: "p", label: ["P"] };
  const removeKeys = { key: "delete", label: ["Del"] };
  if (state.page === "downloads") {
    list.push({
      id: "select-all",
      title: "Select all",
      group: "Downloads",
      icon: ListChecks,
      keys: { key: "a", ctrl: true, label: ["Ctrl", "A"] },
      run: () => {
        state.markAll();
      },
    });
    if (hasFinished(state)) {
      list.push({
        id: "clear-finished",
        title: "Clear finished…",
        group: "Downloads",
        icon: ListX,
        run: () => {
          state.askClearFinished();
        },
      });
    }
  }
  const many = chosen(state);
  const selected = many.length > 1 ? undefined : single(state);
  if (many.length > 1) {
    const ids = many.map((item) => item.id);
    const any = (...states: string[]) => many.some((item) => states.includes(item.state));
    const group = "Selected downloads";
    if (any("queued")) {
      list.push(
        { id: "start-next", title: "Start next", group, icon: ListStart, run: () => void state.moveMany(ids, "first") },
        { id: "move-last", title: "Move to the end", group, icon: ListEnd, run: () => void state.moveMany(ids, "last") },
      );
    }
    const active = any("downloading", "queued");
    if (active) list.push({ id: "pause", title: "Pause", group, icon: Pause, keys: toggle, run: () => void state.pauseMany(ids) });
    // P pauses a selection with anything running; Resume stays here for the rest.
    if (any("paused", "failed")) {
      const resume = any("paused");
      list.push({
        id: "resume",
        title: resume ? "Resume" : "Retry",
        group,
        icon: resume ? Play : RotateCw,
        ...(active ? {} : { keys: toggle }),
        run: () => void state.resumeMany(ids),
      });
    }
    list.push(
      {
        id: "copy",
        title: "Copy links",
        group,
        icon: Copy,
        run: () => {
          navigator.clipboard.writeText(many.map((item) => item.url).join("\n")).catch(() => {
            state.notify("couldn't copy the links");
          });
        },
      },
      {
        id: "remove",
        title: "Remove…",
        group,
        icon: Trash2,
        keys: removeKeys,
        run: () => {
          state.askRemove(ids);
        },
      },
      {
        id: "close",
        title: "Clear the selection",
        group,
        icon: X,
        keys: { key: "escape", label: ["Esc"] },
        run: () => {
          const back = state.selected;
          state.select(null);
          if (back !== null) focusRow(back);
        },
      },
    );
  }
  if (selected) {
    const { id } = selected;
    if (selected.state === "queued") {
      list.push(
        { id: "start-next", title: "Start next", group: "Selected download", icon: ListStart, run: () => void state.startNext(id) },
        {
          id: "move-up",
          title: "Move up in the queue",
          group: "Selected download",
          icon: ArrowUp,
          keys: { key: "arrowup", alt: true, label: ["Alt", "↑"] },
          run: () => void state.moveOne(id, "up"),
        },
        {
          id: "move-down",
          title: "Move down in the queue",
          group: "Selected download",
          icon: ArrowDown,
          keys: { key: "arrowdown", alt: true, label: ["Alt", "↓"] },
          run: () => void state.moveOne(id, "down"),
        },
        { id: "move-last", title: "Move to the end", group: "Selected download", icon: ListEnd, run: () => void state.moveMany([id], "last") },
      );
    }
    if (selected.state === "downloading" || selected.state === "queued") {
      list.push({ id: "pause", title: "Pause", group: "Selected download", icon: Pause, keys: toggle, run: () => void state.pause(id) });
    }
    if (selected.state === "paused") {
      list.push({ id: "resume", title: "Resume", group: "Selected download", icon: Play, keys: toggle, run: () => void state.resume(id) });
    }
    if (selected.state === "failed") {
      list.push({ id: "retry", title: "Retry", group: "Selected download", icon: RotateCw, keys: toggle, run: () => void state.resume(id) });
    }
    if (selected.state === "done") {
      list.push({
        id: "open",
        title: "Open",
        group: "Selected download",
        icon: ExternalLink,
        keys: { key: "o", ctrl: true, label: ["Ctrl", "O"] },
        run: () => void state.openFile(id),
      });
    }
    list.push(
      { id: "folder", title: "Open folder", group: "Selected download", icon: FolderOpen, run: () => void state.showInFolder(id) },
      ...(canRename(selected)
        ? [
            {
              id: "rename",
              title: "Rename…",
              group: "Selected download" as const,
              icon: Pencil,
              keys: { key: "f2", label: ["F2"] },
              run: () => {
                state.startRename(id);
              },
            },
          ]
        : []),
      {
        id: "copy",
        title: "Copy link",
        group: "Selected download",
        icon: Copy,
        run: () => {
          navigator.clipboard.writeText(selected.url).catch(() => {
            state.notify("couldn't copy the link");
          });
        },
      },
      {
        id: "remove",
        title: "Remove…",
        group: "Selected download",
        icon: Trash2,
        keys: removeKeys,
        run: () => {
          state.askRemove([id]);
        },
      },
      {
        id: "close",
        title: "Close details",
        group: "Selected download",
        icon: X,
        keys: { key: "escape", label: ["Esc"] },
        run: () => {
          state.select(null);
          focusRow(id);
        },
      },
    );
  }

  list.push({
    id: "settings",
    title: "Open settings",
    group: "Help",
    icon: Settings,
    keys: { key: ",", ctrl: true, label: ["Ctrl", ","] },
    run: () => {
      state.setPage("settings");
    },
  });
  list.push({
    id: "shortcuts",
    title: "Keyboard shortcuts",
    group: "Help",
    icon: Keyboard,
    keys: { key: "?", label: ["?"] },
    run: () => {
      state.setOverlay("shortcuts");
    },
  });
  return list;
}

export const NAVIGATION: readonly { title: string; icon: LucideIcon; keys: Keys }[] = [
  { title: "Previous download", icon: ArrowUp, keys: { key: "arrowup", label: ["↑"] } },
  { title: "Next download", icon: ArrowDown, keys: { key: "arrowdown", label: ["↓"] } },
];

export const PALETTE_KEYS: Keys = { key: "k", ctrl: true, label: ["Ctrl", "K"] };

export function matches(keys: Keys, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  const key = event.key.toLowerCase();
  if (key !== keys.key || event.altKey !== Boolean(keys.alt)) return false;
  if ((event.ctrlKey || event.metaKey) !== Boolean(keys.ctrl)) return false;
  const symbol = keys.key.length === 1 && !/[a-z0-9]/.test(keys.key);
  return symbol || event.shiftKey === Boolean(keys.shift);
}

export function rank(title: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === "") return 1;
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s._-]+/).some((word) => word.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

export const KEYMAP: readonly { group: string; entries: readonly { title: string; label: readonly string[] }[] }[] = [
  {
    group: "General",
    entries: [
      { title: "Command bar", label: PALETTE_KEYS.label },
      { title: "Add downloads", label: ["Ctrl", "N"] },
      { title: "Search downloads", label: ["Ctrl", "F"] },
      { title: "Settings", label: ["Ctrl", ","] },
      { title: "Keyboard shortcuts", label: ["?"] },
      { title: "Close details or a dialog", label: ["Esc"] },
    ],
  },
  { group: "Views", entries: VIEW_COMMANDS.map(({ title, key }) => ({ title, label: ["Ctrl", key] })) },
  {
    group: "Downloads",
    entries: [
      ...NAVIGATION.map(({ title, keys }) => ({ title, label: keys.label })),
      { title: "Select more, one by one", label: ["Ctrl", "Click"] },
      { title: "Select a range", label: ["Shift", "↑", "↓"] },
      { title: "Select all", label: ["Ctrl", "A"] },
      { title: "Move up in the queue", label: ["Alt", "↑"] },
      { title: "Move down in the queue", label: ["Alt", "↓"] },
      { title: "Menu for the selection", label: ["Shift", "F10"] },
      { title: "Pause, resume or retry", label: ["P"] },
      { title: "Rename", label: ["F2"] },
      { title: "Remove", label: ["Del"] },
      { title: "Open a finished file", label: ["Ctrl", "O"] },
    ],
  },
];
