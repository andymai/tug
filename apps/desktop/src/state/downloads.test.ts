import { describe, expect, it } from "vitest";

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
    await store.getState().retry(failed?.id ?? -1);
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

  it("records an error instead of throwing when the backend refuses", async () => {
    const { store } = await ready();
    await store.getState().retry(999);
    expect(store.getState().notice).toMatch(/no download 999/);
  });
});
