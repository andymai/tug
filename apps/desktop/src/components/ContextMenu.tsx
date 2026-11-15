import { Check, ChevronRight } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

import { focusRow } from "../lib/dom";
import { type MenuEntry, menuFor } from "../lib/menus";
import { ICON } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import type { Menu } from "../state/downloads";

const EDGE = 4;
// On its way to an open submenu, the pointer can cross other entries.
const SUB_DELAY = 250;
// The entries that the arrows reach.
const ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])';
// A click on the button that opened a menu closes it there, not here and again.
const OPENER = '[aria-haspopup="menu"][aria-expanded="true"]';

export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

// Where a menu opened from the keyboard shows: under the element, at its start.
export function under(element: Element, inset = 8): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + inset, y: box.bottom };
}

const ARIA_KEYS: Readonly<Record<string, string>> = { Ctrl: "Control", Del: "Delete", "↑": "ArrowUp", "↓": "ArrowDown", Esc: "Escape" };

// The hint is for the eye; a screen reader gets the keys as aria-keyshortcuts.
export function ariaKeys(label: readonly string[]): string {
  return label.map((key) => ARIA_KEYS[key] ?? key).join("+");
}

function roleOf(entry: MenuEntry): string {
  if (entry.check === undefined) return "menuitem";
  return entry.check.kind === "radio" ? "menuitemradio" : "menuitemcheckbox";
}

function shapeOf(groups: readonly MenuEntry[][]): string {
  return groups.map((group) => group.map((entry) => entry.id).join(" ")).join("|");
}

function Groups({ groups, children }: { groups: readonly MenuEntry[][]; children: (entry: MenuEntry) => ReactNode }) {
  return groups.map((group, index) => (
    <Fragment key={group[0]?.id ?? index}>
      {index > 0 && <div role="separator" className="my-0.5 h-px bg-line" />}
      {group.map(children)}
    </Fragment>
  ));
}

interface ItemProps {
  entry: MenuEntry;
  // The id of the submenu that this entry shows now.
  controls?: string | undefined;
  onActivate: (entry: MenuEntry, keyboard: boolean) => void;
  onHover?: (entry: MenuEntry) => void;
}

function Item({ entry, controls, onActivate, onHover }: ItemProps) {
  const parent = entry.sub !== undefined;
  return (
    <button
      type="button"
      data-entry={entry.id}
      role={roleOf(entry)}
      aria-checked={entry.check?.on}
      aria-haspopup={parent ? "menu" : undefined}
      aria-expanded={parent ? controls !== undefined : undefined}
      aria-controls={controls}
      aria-disabled={entry.disabled === true ? true : undefined}
      tabIndex={entry.disabled === true ? -1 : undefined}
      aria-keyshortcuts={entry.keys === undefined ? undefined : ariaKeys(entry.keys)}
      onClick={(event) => {
        if (entry.disabled !== true) onActivate(entry, event.detail === 0);
      }}
      onMouseEnter={() => onHover?.(entry)}
      className={`flex h-7 items-center gap-2 rounded-xs px-2 text-left text-body outline-offset-[-2px] ${entry.disabled === true ? "cursor-default text-ink-muted" : "text-ink hover:bg-hover focus-visible:bg-hover aria-expanded:bg-hover"}`}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-ink-muted">
        {entry.check !== undefined ? entry.check.on && <Check {...ICON} size={14} className="text-ink" /> : entry.icon && <entry.icon {...ICON} size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.keys !== undefined && (
        <span aria-hidden="true" className="shrink-0 pl-6 text-small text-ink-muted">
          {entry.keys.join("+")}
        </span>
      )}
      {parent && <ChevronRight {...ICON} size={14} className="-mr-1 shrink-0 text-ink-muted" />}
    </button>
  );
}

const BOX = "fixed z-30 flex w-max max-w-80 min-w-52 flex-col gap-0.5 rounded-md border border-line bg-surface-raised p-1 shadow-dialog";

// The arrows' next entry, or undefined for another key.
function stepTo(key: string, at: number, count: number): number | undefined {
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: count - 1 }[key];
  return to === undefined ? undefined : (to + count) % count;
}

function Open({ menu }: { menu: Menu }) {
  const store = useDownloadsStore();
  // Each of these can change what the menu offers while it is open.
  useDownloads(useShallow((s) => [s.items, s.marked, s.selected, s.settings, s.view, s.matches, s.page]));
  const closeMenu = useDownloads((s) => s.closeMenu);
  const { label, groups } = menuFor(menu.on, store.getState());
  const box = useRef<HTMLDivElement>(null);
  const [before] = useState(() => document.activeElement);
  const [place, setPlace] = useState({ x: menu.x, y: menu.y });
  // The entry the focus was last on, by place.
  const focusAt = useRef(0);
  const shape = shapeOf(groups);
  // One submenu at a time; focus says whether it takes the focus when it opens.
  const [sub, setSub] = useState<{ id: string; focus: boolean } | null>(null);
  const subBox = useRef<HTMLDivElement>(null);
  const subId = useId();
  const [subPlace, setSubPlace] = useState({ x: 0, y: 0 });
  const timer = useRef<number | undefined>(undefined);
  const subEntry = sub === null ? undefined : groups.flat().find((entry) => entry.id === sub.id);
  const subGroups = subEntry?.sub;
  const subShape = shapeOf(subGroups ?? []);
  // An entry that goes takes its submenu with it, so a later one with its id starts closed.
  if (sub !== null && subGroups === undefined) setSub(null);

  // Again when entries come or go: the menu stays in the window, and the focus
  // stays in the menu, where Escape and the arrows work.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    // Without room past the point, the menu opens back from it, as a desktop's menus do.
    const left = menu.end === true || menu.x + width > window.innerWidth - EDGE ? menu.x - width : menu.x;
    const top = menu.y + height > window.innerHeight - EDGE ? menu.y - height : menu.y;
    setPlace({
      x: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE)),
    });
    if (element.contains(document.activeElement) || subBox.current?.contains(document.activeElement) === true) return;
    const items = [...element.querySelectorAll<HTMLElement>(ITEMS)];
    (items[Math.min(focusAt.current, items.length - 1)] ?? element).focus();
  }, [menu, shape]);

  // Beside the menu, its first entry level with the one that opened it, or on
  // the other side when the window has no room.
  useLayoutEffect(() => {
    const element = subBox.current;
    const from = sub === null ? null : (box.current?.querySelector(`[data-entry="${sub.id}"]`) ?? null);
    if (sub === null || element === null || box.current === null || from === null) return;
    const outer = box.current.getBoundingClientRect();
    const own = element.getBoundingClientRect();
    const lead = (element.querySelector(ITEMS)?.getBoundingClientRect().top ?? own.top) - own.top;
    const x = outer.right - EDGE + own.width > window.innerWidth - EDGE ? outer.left + EDGE - own.width : outer.right - EDGE;
    const y = from.getBoundingClientRect().top - lead;
    setSubPlace({
      x: Math.max(EDGE, Math.min(x, window.innerWidth - own.width - EDGE)),
      y: Math.max(EDGE, Math.min(y, window.innerHeight - own.height - EDGE)),
    });
    if (sub.focus && !element.contains(document.activeElement)) element.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [sub, subShape, place]);

  useEffect(() => {
    const pending = timer;
    return () => {
      window.clearTimeout(pending.current);
    };
  }, []);

  const empty = groups.length === 0;
  useEffect(() => {
    if (empty) closeMenu();
  }, [empty, closeMenu]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || box.current?.contains(target) || subBox.current?.contains(target)) return;
      if (target instanceof Element && target.closest(OPENER) !== null) return;
      closeMenu();
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
    if (menu.on.kind === "rows") {
      const { selected } = store.getState();
      if (selected !== null) focusRow(selected);
    } else if (before instanceof HTMLElement && before.isConnected) {
      before.focus();
    }
  };

  // A submenu that goes while it has the focus gives it to the entry that opened it.
  const showSub = (next: { id: string; focus: boolean } | null) => {
    window.clearTimeout(timer.current);
    const opener = box.current?.querySelector<HTMLElement>('[aria-expanded="true"]');
    if (opener && subBox.current?.contains(document.activeElement) === true && opener.dataset.entry !== next?.id) opener.focus();
    setSub(next);
  };

  const hover = (entry: MenuEntry) => {
    window.clearTimeout(timer.current);
    if (entry.id === sub?.id) return;
    const next = entry.sub === undefined || entry.disabled === true ? null : { id: entry.id, focus: false };
    if (sub === null) setSub(next);
    else
      timer.current = window.setTimeout(() => {
        showSub(next);
      }, SUB_DELAY);
  };

  const activate = (entry: MenuEntry, keyboard: boolean) => {
    if (entry.sub !== undefined) {
      showSub({ id: entry.id, focus: keyboard });
      return;
    }
    if (entry.check?.kind !== "checkbox") {
      if (entry.keepsFocus === true) closeMenu();
      else back();
    }
    entry.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = items.findIndex((item) => item === document.activeElement);
    const to = stepTo(event.key, at, items.length);
    const parent = event.key === "ArrowRight" ? groups.flat().find((entry) => entry.sub !== undefined && entry.id === items[at]?.dataset.entry) : undefined;
    // A submenu that the pointer opened goes first, as one with the focus does.
    if (sub !== null && (event.key === "Escape" || event.key === "ArrowLeft")) {
      event.preventDefault();
      event.stopPropagation();
      showSub(null);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      back();
    } else if (to !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      // A submenu that the pointer opened goes when the keys move on.
      if (sub !== null) showSub(null);
      items[to]?.focus();
    } else if (parent !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      showSub({ id: parent.id, focus: true });
    }
  };

  const onSubKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(subBox.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const to = stepTo(
      event.key,
      items.findIndex((item) => item === document.activeElement),
      items.length,
    );
    if (event.key === "ArrowLeft" || event.key === "Escape" || event.key === "Tab" || to !== undefined) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key === "ArrowLeft" || event.key === "Escape") showSub(null);
    else if (event.key === "Tab") back();
    else if (to !== undefined) items[to]?.focus();
  };

  if (empty) return null;
  return (
    <>
      <div
        ref={box}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const at = [...(box.current?.querySelectorAll(ITEMS) ?? [])].indexOf(event.target);
          if (at !== -1) focusAt.current = at;
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        style={{ left: place.x, top: place.y }}
        className={BOX}
      >
        <Groups groups={groups}>
          {(entry) => <Item key={entry.id} entry={entry} controls={entry.id === sub?.id && subGroups !== undefined ? subId : undefined} onActivate={activate} onHover={hover} />}
        </Groups>
      </div>
      {sub !== null && subGroups !== undefined && (
        <div
          ref={subBox}
          id={subId}
          role="menu"
          aria-label={subEntry?.label}
          tabIndex={-1}
          onKeyDown={onSubKeyDown}
          onMouseEnter={() => {
            window.clearTimeout(timer.current);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
          }}
          style={{ left: subPlace.x, top: subPlace.y }}
          className={BOX}
        >
          <Groups groups={subGroups}>{(entry) => <Item key={entry.id} entry={entry} onActivate={activate} />}</Groups>
        </div>
      )}
    </>
  );
}

export function ContextMenu() {
  const menu = useDownloads((s) => s.menu);
  if (menu === null) return null;
  return <Open key={JSON.stringify(menu)} menu={menu} />;
}
