import { type ReactNode, useEffect } from "react";

import { AddDialog } from "./components/AddDialog";
import { CaptureSheet } from "./components/CaptureSheet";
import { CommandBar } from "./components/CommandBar";
import { DownloadList } from "./components/DownloadList";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { LinkCapture } from "./components/LinkCapture";
import { RemoveDialog } from "./components/RemoveDialog";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ResizeEdges } from "./components/WindowControls";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { DownloadsContext, useDownloads } from "./state/context";
import { useTheme } from "./state/theme";
import type { DownloadsStore } from "./state/downloads";

const TEXT_INPUTS = new Set(["email", "number", "password", "search", "tel", "text", "url"]);

// WebKit's own menu offers Back, Forward and Reload, and Reload resets the window. A text
// field and the text that someone selected keep it, for Cut, Copy and Paste, and Shift keeps
// it for Inspect Element in a debug build.
function keepsWebKitMenu(event: MouseEvent): boolean {
  if (event.shiftKey && import.meta.env.DEV) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest("input, textarea");
  if (field instanceof HTMLInputElement) return TEXT_INPUTS.has(field.type);
  if (field !== null || target.isContentEditable) return true;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    for (const box of selection.getRangeAt(index).getClientRects()) {
      if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return true;
    }
  }
  return false;
}

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

  useEffect(() => {
    const hideWebKitMenu = (event: MouseEvent) => {
      if (!keepsWebKitMenu(event)) event.preventDefault();
    };
    document.addEventListener("contextmenu", hideWebKitMenu);
    return () => {
      document.removeEventListener("contextmenu", hideWebKitMenu);
    };
  }, []);

  return (
    <DownloadsContext value={store}>
      <Frame>
        <Sidebar />
        <Page />
      </Frame>
      <ResizeEdges />
      <AddDialog />
      <RemoveDialog />
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
