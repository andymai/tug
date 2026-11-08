import { describe, expect, it } from "vitest";

import type { DownloadEvent, Settings } from "../backend/backend";
import { createMockBackend } from "../backend/mock";
import { countFor, createDownloadsStore, visibleItems } from "./downloads";

const MB = 1 << 20;

const showcase = [
  { url: "https://example.org/fedora.iso", state: "downloading", progress: 0.5, size: 64 * MB },
  { url: "https://example.org/blender.tar.xz", state: "queued" },
  { url: "https://example.org/talk.mp4", state: "paused", progress: 0.38 },
  { url: "https://example.org/fonts.zip", state: "done" },
  { url: "https://example.org/shard.parquet", state: "failed", error: "Couldn't reach mirror.example.org" },
] as const;

async function ready() {
  const backend = createMockBackend({ seed: showcase });
  const store = createDownloadsStore(backend);
  const stop = await store.getState().init();
  return { backend, store, stop };
}

describe("downloads store", () => {
  it("loads the list and counts each view", async () => {
    const { store } = await ready();
    const { items, status } = store.getState();
    expect(status).toBe("ready");
    expect([countFor(items, "all"), countFor(items, "active"), countFor(items, "done"), countFor(items, "failed")]).toEqual([5, 3, 1, 1]);
  });

  it("filters by view and clears the selection when the view changes", async () => {
    const { store } = await ready();
    store.getState().select(1);
    store.getState().setView("active");
    expect(store.getState().selected).toBeNull();
    expect(visibleItems(store.getState()).map((d) => d.name)).toEqual(["fedora.iso", "blender.tar.xz", "talk.mp4"]);
  });

  it("puts the newest download first", async () => {
    const { backend, store } = await ready();
    await backend.add("https://example.org/new.img");
    await store.getState().reload();
    expect(visibleItems(store.getState())[0]?.name).toBe("new.img");
  });

  it("applies live progress and reloads when a download settles", async () => {
    const { backend, store } = await ready();
    backend.tick();
    const fedora = store.getState().items.find((d) => d.name === "fedora.iso");
    expect(fedora && store.getState().live[fedora.id]?.speed).toBeGreaterThan(0);

    for (let i = 0; i < 100; i++) backend.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().items.find((d) => d.name === "fedora.iso")?.state).toBe("done");
  });

  it("retries a failed download", async () => {
    const { store } = await ready();
    const failed = store.getState().items.find((d) => d.state === "failed");
    expect(failed).toBeDefined();
    await store.getState().resume(failed?.id ?? -1);
    expect(store.getState().items.find((d) => d.id === failed?.id)?.state).toBe("downloading");
  });

  it("loads the list even when progress can't be followed, and says why", async () => {
    const backend = createMockBackend({ seed: showcase });
    const store = createDownloadsStore({
      ...backend,
      onProgress: () => Promise.reject(new Error("the event bus is closed")),
    });
    const stop = await store.getState().init();
    expect(store.getState()).toMatchObject({ status: "ready", loadError: null, notice: "the event bus is closed" });
    expect(store.getState().items).toHaveLength(5);
    expect(() => {
      stop();
    }).not.toThrow();
  });

  it("keeps both reasons when the subscription and the list fail", async () => {
    const store = createDownloadsStore({
      ...createMockBackend(),
      onProgress: () => Promise.reject(new Error("the event bus is closed")),
      list: () => Promise.reject(new Error("the library is locked")),
    });
    await store.getState().init();
    expect(store.getState()).toMatchObject({
      status: "error",
      loadError: "the library is locked",
      notice: "the event bus is closed",
    });
  });

  it("keeps a batch's warning through the reload that a settled download starts", async () => {
    const { store } = await ready();
    const done = store.getState().items.find((d) => d.state === "done");
    store.getState().applyBatch({ seq: 9, updates: [], settled: [done?.id ?? -1], error: "couldn't save progress" });
    await store.getState().reload();
    expect(store.getState().notice).toBe("couldn't save progress");
    store.getState().dismissNotice();
    expect(store.getState().notice).toBeNull();
  });

  it("loads the settings, saves them, and says why a save failed", async () => {
    const { store } = await ready();
    const settings = store.getState().settings;
    expect(settings?.downloadDir).toBe("/home/you/Downloads");
    if (settings === null) return;

    await store.getState().saveSettings({ ...settings, connections: 16 });
    expect(store.getState().settings?.connections).toBe(16);

    await store.getState().saveSettings({ ...settings, connections: 0 });
    expect(store.getState().settings?.connections).toBe(16);
    expect(store.getState().settingsError).toMatch(/between 1 and 32/);
  });

  it("keeps two quick changes, saved in order, and rolls back one the backend refuses", async () => {
    const backend = createMockBackend();
    const writes: Settings[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createDownloadsStore({
      ...backend,
      updateSettings: async (next) => {
        await gate;
        writes.push(next);
        return backend.updateSettings(next);
      },
    });
    await store.getState().init();
    const start = store.getState().settings;
    if (start === null) return;

    const first = store.getState().saveSettings({ ...start, connections: 12 });
    const latest = store.getState().settings;
    if (latest === null) return;
    const second = store.getState().saveSettings({ ...latest, speedLimit: 1 << 20 });
    release();
    await Promise.all([first, second]);
    expect(writes.map((w) => [w.connections, w.speedLimit])).toEqual([
      [12, null],
      [12, 1 << 20],
    ]);
    expect(await backend.settings()).toMatchObject({ connections: 12, speedLimit: 1 << 20 });

    await store.getState().saveSettings({ ...latest, connections: 0 });
    expect(store.getState().settings).toMatchObject({ connections: 12, speedLimit: 1 << 20 });
    expect(store.getState().settingsError).toMatch(/between 1 and 32/);
  });

  it("takes the folder the person chooses, and leaves settings alone on cancel", async () => {
    const backend = createMockBackend({ folder: "/data/iso" });
    const store = createDownloadsStore(backend);
    await store.getState().init();
    await store.getState().chooseFolder();
    expect(store.getState().settings?.downloadDir).toBe("/data/iso");

    const cancelled = createDownloadsStore({ ...backend, chooseDownloadFolder: () => Promise.resolve(null) });
    await cancelled.getState().init();
    await cancelled.getState().chooseFolder();
    expect(cancelled.getState().settings?.downloadDir).toBe("/data/iso");
  });

  it("leaves the settings page when a view is chosen", async () => {
    const { store } = await ready();
    store.getState().setPage("settings");
    store.getState().setView("done");
    expect(store.getState().page).toBe("downloads");
  });

  it("opens the add dialog, and adds to the text when it is already open", async () => {
    const { store } = await ready();
    store.getState().openAdd("https://example.org/a.iso");
    store.getState().openAdd("https://example.org/b.iso");
    expect(store.getState().adding).toMatchObject({ open: true, text: "https://example.org/a.iso\nhttps://example.org/b.iso" });
    store.getState().closeAdd();
    store.getState().openAdd();
    expect(store.getState().adding.text).toBe("");
  });

  it("adds links, closes the dialog, marks them fresh and shows them", async () => {
    const { store } = await ready();
    store.getState().setView("done");
    store.getState().openAdd();
    await store.getState().addLinks(["https://example.org/a.iso", "https://example.org/b.iso"]);
    const { adding, fresh, items, view } = store.getState();
    expect(adding.open).toBe(false);
    expect(view).toBe("all");
    expect(fresh).toHaveLength(2);
    expect(items.filter((d) => fresh.includes(d.id)).map((d) => d.name)).toEqual(["a.iso", "b.iso"]);
    store.getState().settleFresh(fresh[0] ?? -1);
    expect(store.getState().fresh).toHaveLength(1);
  });

  it("keeps the dialog open when nothing could be added, and says why", async () => {
    const backend = createMockBackend();
    const store = createDownloadsStore({ ...backend, add: () => Promise.reject(new Error("the disk is full")) });
    store.getState().openAdd();
    await store.getState().addLinks(["https://example.org/a.iso"]);
    expect(store.getState().adding).toMatchObject({
      open: true,
      busy: false,
      error: "couldn't add https://example.org/a.iso: the disk is full",
    });
  });

  it("closes the dialog and leaves a notice when only some links fail", async () => {
    const backend = createMockBackend();
    const store = createDownloadsStore({
      ...backend,
      add: (url, dir) => (url.endsWith("bad.iso") ? Promise.reject(new Error("the server said no")) : backend.add(url, dir)),
    });
    store.getState().openAdd();
    await store.getState().addLinks(["https://example.org/good.iso", "https://example.org/bad.iso"]);
    expect(store.getState().adding.open).toBe(false);
    expect(store.getState().notice).toBe("couldn't add https://example.org/bad.iso: the server said no");
    expect(store.getState().items.map((d) => d.name)).toEqual(["good.iso"]);
  });

  it("leaves a dialog opened during an earlier add alone", async () => {
    const backend = createMockBackend();
    let finish: () => void = () => undefined;
    const store = createDownloadsStore({
      ...backend,
      add: async (url, dir) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return backend.add(url, dir);
      },
    });
    store.getState().openAdd("https://example.org/slow.iso");
    const pending = store.getState().addLinks(["https://example.org/slow.iso"]);
    store.getState().closeAdd();
    store.getState().openAdd("https://example.org/next.iso");
    finish();
    await pending;
    expect(store.getState().adding).toMatchObject({ open: true, busy: false, text: "https://example.org/next.iso" });
    expect(store.getState().items.map((d) => d.name)).toEqual(["slow.iso"]);
  });

  it("loads the history of the selected download only", async () => {
    const { store } = await ready();
    const fedora = store.getState().items.find((d) => d.name === "fedora.iso");
    store.getState().select(fedora?.id ?? null);
    await store.getState().loadHistory(fedora?.id ?? -1);
    expect(store.getState().history?.events.map((e) => e.kind)).toEqual(["added", "started"]);

    store.getState().select(null);
    await store.getState().loadHistory(fedora?.id ?? -1);
    expect(store.getState().history?.id).toBe(fedora?.id);
    store.getState().select(2);
    await store.getState().loadHistory(fedora?.id ?? -1);
    expect(store.getState().history?.id).toBe(fedora?.id);
  });

  it("keeps the newest history when an older answer arrives last", async () => {
    const backend = createMockBackend({ seed: showcase });
    const answers: ((events: DownloadEvent[]) => void)[] = [];
    const store = createDownloadsStore({
      ...backend,
      events: () =>
        new Promise<DownloadEvent[]>((resolve) => {
          answers.push(resolve);
        }),
    });
    store.getState().select(1);
    const older = store.getState().loadHistory(1);
    const newer = store.getState().loadHistory(1);
    const event = (kind: DownloadEvent["kind"]): DownloadEvent => ({ kind, atMs: 0, bytes: null, detail: null });
    answers[1]?.([event("added"), event("paused")]);
    await newer;
    answers[0]?.([event("added")]);
    await older;
    expect(store.getState().history?.events.map((e) => e.kind)).toEqual(["added", "paused"]);
  });

  it("steps through the visible downloads and stops at the ends", async () => {
    const { store } = await ready();
    const names = () => store.getState().items.find((d) => d.id === store.getState().selected)?.name;
    store.getState().setView("active");
    store.getState().step(1);
    expect(names()).toBe("fedora.iso");
    store.getState().step(1);
    store.getState().step(1);
    store.getState().step(1);
    expect(names()).toBe("talk.mp4");
    store.getState().step(-1);
    expect(names()).toBe("blender.tar.xz");
    store.getState().select(null);
    store.getState().step(-1);
    expect(names()).toBe("talk.mp4");
  });

  it("records an error instead of throwing when the backend refuses", async () => {
    const { store } = await ready();
    await store.getState().resume(999);
    expect(store.getState().notice).toMatch(/no download 999/);
  });
});
