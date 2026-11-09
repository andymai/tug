import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

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

const MB = 1 << 20;
// A minute of total speed, so the status bar's graph has a shape to show.
const SPEEDS = Array.from({ length: 60 }, (_, at) => Math.round((14 + 4 * Math.sin(at / 6) + (at % 7) * 0.3) * MB));

async function showcase(select?: string) {
  const opened = await open(SHOWCASE);
  act(() => {
    opened.backend.tick();
    opened.store.setState({ speeds: SPEEDS });
  });
  if (select !== undefined) {
    const item = opened.store.getState().items.find((d) => d.name === select);
    act(() => {
      opened.store.getState().select(item?.id ?? null);
    });
  }
  return opened;
}

// A shot taken mid-transition, or under a pointer left over another test's
// controls, differs by a few pixels from run to run.
const still = document.createElement("style");
still.textContent = "*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }";
document.head.append(still);

async function capture(window: ReturnType<typeof page.elementLocator>, name: string) {
  await document.fonts.ready;
  const logo = document.querySelector("aside img");
  if (logo !== null) await userEvent.hover(page.elementLocator(logo), { force: true });
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

  it("scrolls a crowded sidebar and keeps Settings in reach", async () => {
    await page.viewport(720, 480);
    const names = ["talk.mp4", "album.flac", "scan.png", "report.pdf", "fonts.zip", "Tug.AppImage", "fedora.iso", "shard.parquet"];
    const { window } = await open(names.map((name) => ({ url: `https://example.org/${name}`, state: "done" as const })));
    const last = document.querySelector<HTMLElement>('nav[aria-labelledby="types-label"] li:last-child');
    expect(last?.textContent).toBe("Other files1");
    last?.scrollIntoView({ block: "end" });
    const settings = [...document.querySelectorAll("aside button")].find((button) => button.textContent === "Settings");
    expect(settings?.getBoundingClientRect().bottom).toBeLessThanOrEqual(480);
    await capture(window, "crowded");
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

  it("sorts by a column and picks its columns", async () => {
    const { store, window } = await showcase();
    await act(async () => {
      await store.getState().saveSettings({ sort: "-size", columns: ["name", "status", "progress", "size", "type", "added", "queue"] });
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Columns"]')?.click();
    });
    await capture(window, "columns");
  });

  it("shows the downloads of one type", async () => {
    const { store, window } = await showcase();
    act(() => {
      store.getState().setView("archive");
    });
    await capture(window, "type");
  });

  it("narrows the list to a search", async () => {
    const { store, window } = await showcase();
    act(() => {
      store.getState().setSearch("mirror");
    });
    await vi.waitFor(() => {
      expect(store.getState().matches).not.toBeNull();
    });
    await capture(window, "search");
  });

  it("keeps saved searches in the sidebar", async () => {
    const { store, window } = await showcase();
    await act(async () => {
      await store.getState().saveSettings({
        savedViews: [
          { name: "mirror", view: "all", query: "mirror" },
          { name: "fonts", view: "done", query: "fonts" },
        ],
      });
      store.getState().openView({ name: "mirror", view: "all", query: "mirror" });
    });
    await vi.waitFor(() => {
      expect(store.getState().matches).not.toBeNull();
    });
    await capture(window, "saved");
  });

  it("shows a running download's details beside the list", async () => {
    const { window } = await showcase("fedora-kde-44-x86_64.iso");
    await capture(window, "detail");
  });

  it("shows a running download's segments, connections and server", async () => {
    const { store, window } = await showcase("fedora-kde-44-x86_64.iso");
    act(() => {
      store.getState().setInspectorTab("connections");
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[role="tabpanel"] table')).not.toBeNull();
    });
    await capture(window, "detail-connections");
  });

  it("keeps a failed download's engine log", async () => {
    const { store, window } = await showcase("dataset-shard-07.parquet");
    act(() => {
      store.getState().setInspectorTab("log");
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[role="tabpanel"] li')).not.toBeNull();
    });
    await capture(window, "detail-log");
  });

  it("shows what several selected downloads hold, and acts on all of them", async () => {
    const { store, window } = await showcase("blender-5.1-linux-x64.tar.xz");
    const id = (name: string) => store.getState().items.find((d) => d.name === name)?.id ?? -1;
    act(() => {
      store.getState().markTo(id("noto-fonts-2026.11.zip"));
    });
    await capture(window, "selection");
  });

  it("opens a menu for the selected rows", async () => {
    const { store, window } = await showcase("fedora-kde-44-x86_64.iso");
    const id = (name: string) => store.getState().items.find((d) => d.name === name)?.id ?? -1;
    act(() => {
      store.getState().toggleMark(id("blender-5.1-linux-x64.tar.xz"));
      store.getState().openMenu({ x: 320, y: 130 });
    });
    await capture(window, "row-menu");
  });

  it("shows where a dragged download lands in the queue", async () => {
    const seed: SeedDownload[] = [
      { url: "https://download.example.org/fedora-kde-44-x86_64.iso", state: "downloading", progress: 0.71, size: 4.2 * 1024 * MB },
      ...["blender-5.1-linux-x64.tar.xz", "gimp-3.2.tar.xz", "inkscape-1.5.AppImage", "kdenlive-26.08.AppImage"].map((name) => ({
        url: `https://mirror.example.org/${name}`,
        state: "queued" as const,
        size: 412 * MB,
      })),
    ];
    const { store, window } = await open(seed);
    await act(() => store.getState().saveSettings({ sort: "queue", columns: ["status", "size", "queue"], maxActive: 1 }));
    const id = (name: string) => store.getState().items.find((d) => d.name === name)?.id ?? -1;
    act(() => {
      store.getState().select(id("kdenlive-26.08.AppImage"));
      store.getState().startDrag([id("kdenlive-26.08.AppImage")]);
      store.getState().markDrop({ id: id("gimp-3.2.tar.xz"), edge: "top" });
    });
    await capture(window, "queue-drag");
  });

  it("asks before it removes downloads", async () => {
    const { store, window } = await showcase();
    act(() => {
      store.getState().markAll();
      store.getState().askRemove(store.getState().marked);
    });
    await capture(window, "remove");
  });

  it("offers Start next for a download that waits in the queue", async () => {
    const { window } = await showcase("blender-5.1-linux-x64.tar.xz");
    await capture(window, "detail-queued");
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

  it("sets the hours and days on which downloads run", async () => {
    const { store, window } = await open(SHOWCASE);
    await act(async () => {
      await store.getState().saveSettings({ schedule: { days: 0b001_1111, start: 23 * 60, stop: 7 * 60 } });
      store.getState().setPage("settings");
    });
    document.getElementById("settings-schedule")?.scrollIntoView({ block: "start" });
    await capture(window, "settings-schedule");
  });

  it("sets a slower limit for the working day", async () => {
    const { store, window } = await open(SHOWCASE);
    await act(async () => {
      await store.getState().saveSettings({
        speedLimit: 12 * 1024 * 1024,
        slowHours: { limit: 2 * 1024 * 1024, hours: { days: 0b001_1111, start: 9 * 60, stop: 17 * 60 } },
      });
      store.getState().setPage("settings");
    });
    document.getElementById("settings-speed")?.scrollIntoView({ block: "start" });
    await capture(window, "settings-slower");
  });

  it("asks before a download from the browser", async () => {
    const { window } = await open(
      SHOWCASE,
      {},
      { captures: ["https://cdn.example.org/files/fedora-workstation-44-x86_64.iso", "https://media.example.net/talk.mp4"] },
    );
    await capture(window, "capture-sheet");
  });

  it("moves focus past the command bar to the download a notification shows", async () => {
    const { backend, store } = await open(SHOWCASE);
    act(() => {
      store.getState().setOverlay("commands");
    });
    const done = (await backend.list()).find((download) => download.state === "done");
    act(() => {
      backend.focus(done?.id ?? 0);
    });
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toContain(done?.name ?? "missing");
    });
  });

  it("stays dark when the person picks dark, whatever the system says", async () => {
    const { store, window } = await showcase();
    await act(async () => {
      await store.getState().saveSettings({ appearance: "dark" });
    });
    await capture(window, "forced-dark");
  });
});
