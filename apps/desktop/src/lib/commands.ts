import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderOpen,
  Keyboard,
  Layers,
  Settings,
  type LucideIcon,
  Pause,
  Play,
  Plus,
  RotateCw,
  X,
} from "lucide-react";

import type { DownloadsStore, View } from "../state/downloads";
import { focusRow } from "./dom";

export interface Keys {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  label: readonly string[];
}

export type Group = "Downloads" | "Views" | "Selected download" | "Help";

export interface Command {
  id: string;
  title: string;
  group: Group;
  icon: LucideIcon;
  keys?: Keys;
  run: () => void;
}

const VIEW_COMMANDS: readonly { view: View; title: string; icon: LucideIcon; key: string }[] = [
  { view: "all", title: "Show all downloads", icon: Layers, key: "1" },
  { view: "active", title: "Show active downloads", icon: ArrowDown, key: "2" },
  { view: "done", title: "Show finished downloads", icon: Check, key: "3" },
  { view: "failed", title: "Show failed downloads", icon: CircleAlert, key: "4" },
];

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
  ];

  const selected = state.items.find((item) => item.id === state.selected);
  if (selected) {
    const { id } = selected;
    const toggle = { key: "p", label: ["P"] };
    if (selected.state === "downloading") {
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
  if (key !== keys.key || event.altKey) return false;
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
      { title: "Pause, resume or retry", label: ["P"] },
      { title: "Open a finished file", label: ["Ctrl", "O"] },
    ],
  },
];
