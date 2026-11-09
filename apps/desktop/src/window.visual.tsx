import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { App } from "./App";
import type { Backend } from "./backend/backend";
import { createMockBackend, type SeedDownload, type MockOptions } from "./backend/mock";
import { SHOWCASE } from "./backend/showcase";
import { createDownloadsStore } from "./state/downloads";
import "./styles/app.css";

const NOW = Date.UTC(2026, 10, 8, 13, 5);
const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

async function open(seed: readonly SeedDownload[], overrides: Partial<Backend> = {}, options: MockOptions = {}) {
  const backend = createMockBackend({ ...options, seed, now: () => NOW });
  const store = createDownloadsStore({ ...backend, ...overrides });
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  render(<App store={store} />, { container: root });
  await vi.waitFor(() => {
    expect(store.getState().status).not.toBe("loading");
  });
  return { backend, store, window: page.elementLocator(root) };
}

async function showcase(select?: string) {
  const opened = await open(SHOWCASE);
  act(() => {
    opened.backend.tick();
  });
  if (select !== undefined) {
    const item = opened.store.getState().items.find((d) => d.name === select);
    act(() => {
      opened.store.getState().select(item?.id ?? null);
    });
  }
  return opened;
}

async function capture(window: ReturnType<typeof page.elementLocator>, name: string) {
  await document.fonts.ready;
  await expect(window).toMatchScreenshot(`${name}-${scheme}`);
}

afterEach(async () => {
  document.getElementById("root")?.remove();
  await page.viewport(1100, 720);
});

describe("main window", () => {
  it("shows every download state and live numbers", async () => {
    const { window } = await showcase();
    await capture(window, "window");
  });

  it("keeps its columns at the minimum window width", async () => {
    await page.viewport(720, 480);
    const { window } = await showcase();
    await capture(window, "narrow");
  });

  it("opens on the empty state", async () => {
    const { window } = await open([]);
    await capture(window, "empty");
  });

  it("says why the list can't load, with a notice above", async () => {
    const { window } = await open(SHOWCASE, {
      onProgress: () => Promise.reject(new Error("the event bus is closed")),
      list: () => Promise.reject(new Error("the library is locked by another Tug")),
    });
    await capture(window, "load-error");
  });

  it("checks links in the add dialog", async () => {
    const { store, window } = await open(SHOWCASE);
    act(() => {
      store
        .getState()
        .openAdd(
          [
            "https://download.example.org/kde-neon-user-20261105.iso",
            "https://fonts.example.org/noto-fonts-2026.11.zip",
            "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056",
            "download.example.org",
          ].join("\n"),
        );
    });
    await capture(window, "add-dialog");
  });

  it("shows where to drop a link", async () => {
    const { window } = await open(SHOWCASE);
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/uri-list", "https://example.org/a.iso");
    act(() => {
      document.body.dispatchEvent(new DragEvent("dragenter", { dataTransfer, bubbles: true }));
    });
    await capture(window, "drop");
  });

  it("shows a running download's details beside the list", async () => {
    const { window } = await showcase("fedora-kde-44-x86_64.iso");
    await capture(window, "detail");
  });

  it("floats the details over the list at the minimum width", async () => {
    await page.viewport(720, 480);
    const { window } = await showcase("noto-fonts-2026.11.zip");
    await capture(window, "detail-narrow");
  });

  it("lists commands for the selected download in the command bar", async () => {
    const { store, window } = await showcase("fedora-kde-44-x86_64.iso");
    act(() => {
      store.getState().setOverlay("commands");
    });
    await capture(window, "commands");
  });

  it("shows the keyboard shortcuts", async () => {
    const { store, window } = await open(SHOWCASE);
    act(() => {
      store.getState().setOverlay("shortcuts");
    });
    await capture(window, "shortcuts");
  });

  it("shows the settings with a speed limit on", async () => {
    const { store, window } = await open(SHOWCASE);
    await act(async () => {
      await store.getState().saveSettings({ speedLimit: 12 * 1024 * 1024 });
      store.getState().setPage("settings");
    });
    await capture(window, "settings");
  });

  it("lists the sites Tug leaves to the browser", async () => {
    const { store, window } = await open(SHOWCASE);
    await act(async () => {
      await store.getState().saveSettings({ excludedSites: ["mail.example.org", "bank.example.com"] });
      store.getState().setPage("settings");
    });
    document.getElementById("settings-browsers")?.scrollIntoView({ block: "start" });
    await capture(window, "settings-sites");
  });

  it("asks before a download from the browser", async () => {
    const { window } = await open(
      SHOWCASE,
      {},
      { captures: ["https://cdn.example.org/files/fedora-workstation-44-x86_64.iso", "https://media.example.net/talk.mp4"] },
    );
    await capture(window, "capture-sheet");
  });

  it("stays dark when the person picks dark, whatever the system says", async () => {
    const { store, window } = await showcase();
    await act(async () => {
      await store.getState().saveSettings({ appearance: "dark" });
    });
    await capture(window, "forced-dark");
  });
});
