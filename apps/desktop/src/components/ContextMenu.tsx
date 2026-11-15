import { Check } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

import { focusRow } from "../lib/dom";
import { type MenuEntry, menuFor } from "../lib/menus";
import { ICON } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import type { Menu } from "../state/downloads";

const EDGE = 4;
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
  const shape = groups.map((group) => group.map((entry) => entry.id).join(" ")).join("|");

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
    if (element.contains(document.activeElement)) return;
    const items = [...element.querySelectorAll<HTMLElement>(ITEMS)];
    (items[Math.min(focusAt.current, items.length - 1)] ?? element).focus();
  }, [menu, shape]);

  const empty = groups.length === 0;
  useEffect(() => {
    if (empty) closeMenu();
  }, [empty, closeMenu]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || box.current?.contains(target)) return;
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
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

  if (empty) return null;
  return (
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
      className="fixed z-30 flex w-max max-w-80 min-w-52 flex-col gap-0.5 rounded-md border border-line bg-surface-raised p-1 shadow-dialog"
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.id ?? index}>
          {index > 0 && <div role="separator" className="my-0.5 h-px bg-line" />}
          {group.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role={roleOf(entry)}
              aria-checked={entry.check?.on}
              aria-disabled={entry.disabled === true ? true : undefined}
              tabIndex={entry.disabled === true ? -1 : undefined}
              aria-keyshortcuts={entry.keys === undefined ? undefined : ariaKeys(entry.keys)}
              onClick={() => {
                if (entry.disabled === true) return;
                if (entry.check?.kind !== "checkbox") {
                  if (entry.keepsFocus === true) closeMenu();
                  else back();
                }
                entry.run();
              }}
              className={`flex h-7 items-center gap-2 rounded-xs px-2 text-left text-body outline-offset-[-2px] ${entry.disabled === true ? "cursor-default text-ink-muted" : "text-ink hover:bg-hover focus-visible:bg-hover"}`}
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
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function ContextMenu() {
  const menu = useDownloads((s) => s.menu);
  if (menu === null) return null;
  return <Open key={JSON.stringify(menu)} menu={menu} />;
}
