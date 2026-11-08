import { useEffect } from "react";

import { AddDialog } from "./components/AddDialog";
import { CommandBar } from "./components/CommandBar";
import { DownloadList } from "./components/DownloadList";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { LinkCapture } from "./components/LinkCapture";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Sidebar } from "./components/Sidebar";
import { DownloadsContext } from "./state/context";
import type { DownloadsStore } from "./state/downloads";

export function App({ store }: { store: DownloadsStore }) {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void store
      .getState()
      .init()
      .then((unsubscribe) => {
        if (gone) unsubscribe();
        else stop = unsubscribe;
      });
    return () => {
      gone = true;
      stop?.();
    };
  }, [store]);

  return (
    <DownloadsContext value={store}>
      <div className="flex h-full bg-bg text-ink">
        <Sidebar />
        <DownloadList />
      </div>
      <AddDialog />
      <CommandBar />
      <ShortcutsDialog />
      <LinkCapture />
      <KeyboardShortcuts />
    </DownloadsContext>
  );
}
