import { useEffect } from "react";

import { commands, matches, NAVIGATION, PALETTE_KEYS } from "../lib/commands";
import { editable, focusRow } from "../lib/dom";
import { useDownloadsStore } from "../state/context";
import { modalOpen } from "../state/downloads";
import { isMenuKey } from "./ContextMenu";

// Where the menu key opens the list's own menu: nothing in focus, the title, or
// the list's empty space. A row, a header cell and a button open their own first.
function onListArea(target: EventTarget | null): boolean {
  if (target === document.body) return true;
  return target instanceof Element && (target.id === "list-title" || target.closest("[data-list-area]") !== null);
}

export function KeyboardShortcuts() {
  const store = useDownloadsStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = store.getState();
      if (event.defaultPrevented || modalOpen(state)) return;
      if (matches(PALETTE_KEYS, event)) {
        event.preventDefault();
        state.setOverlay("commands");
        return;
      }
      if (editable(event.target)) return;
      const onList = state.page === "downloads";
      if (isMenuKey(event) && onList && state.status === "ready" && onListArea(event.target)) {
        event.preventDefault();
        const area = document.querySelector("[data-list-area]")?.getBoundingClientRect();
        state.openMenu({ x: (area?.left ?? 0) + 8, y: (area?.top ?? 0) + 8 }, { kind: "list" });
        return;
      }
      const plain = { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: false };
      const step = NAVIGATION.findIndex(({ keys }) => matches(keys, plain));
      if (step !== -1 && onList) {
        event.preventDefault();
        const id = state.step(step === 0 ? -1 : 1, event.shiftKey);
        if (id !== null) focusRow(id);
        return;
      }
      const command = commands(store).find(
        (c) => c.id !== "close" && c.keys !== undefined && (onList || !c.group.startsWith("Selected")) && matches(c.keys, event),
      );
      if (command) {
        event.preventDefault();
        command.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [store]);

  return null;
}
