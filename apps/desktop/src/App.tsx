import { useEffect } from "react";

import { AddDialog } from "./components/AddDialog";
import { CaptureSheet } from "./components/CaptureSheet";
import { CommandBar } from "./components/CommandBar";
import { DownloadList } from "./components/DownloadList";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { LinkCapture } from "./components/LinkCapture";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { DownloadsContext, useDownloads } from "./state/context";
import { useTheme } from "./state/theme";
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
        <Page />
      </div>
      <AddDialog />
      <CommandBar />
      <ShortcutsDialog />
      <LinkCapture />
      <CaptureSheet />
      <KeyboardShortcuts />
      <Theme />
    </DownloadsContext>
  );
}

function Page() {
  const page = useDownloads((s) => s.page);
  return page === "settings" ? <SettingsPage /> : <DownloadList />;
}

function Theme() {
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);
  return null;
}
