import { useEffect } from "react";

import { commands, matches, NAVIGATION, PALETTE_KEYS } from "../lib/commands";
import { editable, focusRow } from "../lib/dom";
import { useDownloadsStore } from "../state/context";
import { modalOpen } from "../state/downloads";

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
      const step = NAVIGATION.findIndex(({ keys }) => matches(keys, event));
      if (step !== -1 && onList) {
        event.preventDefault();
        const id = state.step(step === 0 ? -1 : 1);
        if (id !== null) focusRow(id);
        return;
      }
      const command = commands(store).find(
        (c) => c.id !== "close" && c.keys !== undefined && (onList || c.group !== "Selected download") && matches(c.keys, event),
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
