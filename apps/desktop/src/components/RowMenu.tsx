import { Copy, ExternalLink, FolderOpen, ListEnd, ListStart, type LucideIcon, Pause, Play, RotateCw, Trash2 } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

import type { Download } from "../backend/backend";
import { focusRow } from "../lib/dom";
import { ICON } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import { chosen, type DownloadsState } from "../state/downloads";

interface Entry {
  id: string;
  label: string;
  icon: LucideIcon;
  // A dialog takes the focus; other entries give it back to the row.
  keepsFocus?: boolean;
  run: () => void;
}

const EDGE = 4;

export function entriesFor(list: readonly Download[], state: DownloadsState): Entry[][] {
  const ids = list.map((item) => item.id);
  const any = (...states: Download["state"][]) => list.some((item) => states.includes(item.state));
  const [first] = list;
  const one = list.length === 1 ? first : undefined;
  const open: Entry[] = [];
  if (one?.state === "done") open.push({ id: "open", label: "Open", icon: ExternalLink, run: () => void state.openFile(one.id) });
  if (one !== undefined) open.push({ id: "folder", label: "Open folder", icon: FolderOpen, run: () => void state.showInFolder(one.id) });
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
  const act: Entry[] = [];
  if (any("queued")) {
    act.push(
      { id: "start-next", label: "Start next", icon: ListStart, run: () => void state.moveMany(ids, "first") },
      { id: "move-last", label: "Move to the end", icon: ListEnd, run: () => void state.moveMany(ids, "last") },
    );
  }
  if (any("downloading", "queued")) act.push({ id: "pause", label: "Pause", icon: Pause, run: () => void state.pauseMany(ids) });
  if (any("paused")) act.push({ id: "resume", label: "Resume", icon: Play, run: () => void state.resumeMany(ids) });
  else if (any("failed")) act.push({ id: "retry", label: "Retry", icon: RotateCw, run: () => void state.resumeMany(ids) });
  const remove: Entry[] = [
    {
      id: "remove",
      label: "Remove…",
      icon: Trash2,
      keepsFocus: true,
      run: () => {
        state.askRemove(ids);
      },
    },
  ];
  return [open, act, remove].filter((group) => group.length > 0);
}

function MenuBox({ at }: { at: { x: number; y: number } }) {
  const store = useDownloadsStore();
  const list = useDownloads(useShallow((s) => chosen(s)));
  const closeMenu = useDownloads((s) => s.closeMenu);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    setPlace({
      x: Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE)),
    });
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [at]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) closeMenu();
    };
    const close = () => {
      closeMenu();
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [closeMenu]);

  const back = () => {
    closeMenu();
    const { selected } = store.getState();
    if (selected !== null) focusRow(selected);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.findIndex((item) => item === document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      back();
    } else if (to !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      items[(to + items.length) % items.length]?.focus();
    }
  };

  if (list.length === 0) return null;
  const groups = entriesFor(list, store.getState());
  const [first] = list;
  return (
    <div
      ref={box}
      role="menu"
      aria-label={list.length === 1 && first !== undefined ? first.name : `${String(list.length)} downloads`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ left: place.x, top: place.y }}
      className="fixed z-30 flex w-52 flex-col gap-0.5 rounded-md border border-line bg-surface-raised p-1 shadow-dialog"
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.id ?? index}>
          {index > 0 && <div role="separator" className="my-0.5 h-px bg-line" />}
          {group.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              onClick={() => {
                if (entry.keepsFocus) closeMenu();
                else back();
                entry.run();
              }}
              className="flex h-7 items-center gap-2 rounded-xs px-2 text-left text-body text-ink outline-offset-[-2px] hover:bg-hover focus-visible:bg-hover"
            >
              <entry.icon {...ICON} size={14} className="shrink-0 text-ink-muted" />
              {entry.label}
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function RowMenu() {
  const menu = useDownloads((s) => s.menu);
  if (menu === null) return null;
  return <MenuBox key={`${String(menu.x)},${String(menu.y)}`} at={menu} />;
}
