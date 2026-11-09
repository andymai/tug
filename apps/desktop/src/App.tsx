import { type ReactNode, useEffect } from "react";

import { AddDialog } from "./components/AddDialog";
import { CaptureSheet } from "./components/CaptureSheet";
import { CommandBar } from "./components/CommandBar";
import { DownloadList } from "./components/DownloadList";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { LinkCapture } from "./components/LinkCapture";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ResizeEdges } from "./components/WindowControls";
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
      <Frame>
        <Sidebar />
        <Page />
      </Frame>
      <ResizeEdges />
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

// Without the window manager's frame, a thin line keeps the window's edge visible.
function Frame({ children }: { children: ReactNode }) {
  const framed = useDownloads((s) => s.framed && !s.maximized);
  return <div className={`flex h-full bg-bg text-ink ${framed ? "border border-line" : ""}`}>{children}</div>;
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
