import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { App } from "./App";
import type { Backend } from "./backend/backend";
import { createMockBackend, type SeedDownload } from "./backend/mock";
import { SHOWCASE } from "./backend/showcase";
import { createDownloadsStore } from "./state/downloads";
import "./styles/app.css";

const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

async function open(seed: readonly SeedDownload[], overrides: Partial<Backend> = {}) {
  const backend = createMockBackend({ seed });
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

async function showcase() {
  const opened = await open(SHOWCASE);
  act(() => {
    opened.backend.tick();
  });
  const queued = opened.store.getState().items.find((d) => d.state === "queued");
  act(() => {
    opened.store.getState().select(queued?.id ?? null);
  });
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
  it("shows every download state, live numbers and a selected row", async () => {
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
});
