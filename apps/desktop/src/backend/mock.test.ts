import { describe, expect, it } from "vitest";

import type { ProgressBatch } from "./backend";
import { createMockBackend } from "./mock";

const MB = 1 << 20;

async function collect(backend: ReturnType<typeof createMockBackend>) {
  const batches: ProgressBatch[] = [];
  const stop = await backend.onProgress((batch) => batches.push(batch));
  return { batches, stop };
}

describe("mock backend", () => {
  it("adds a link and reports it downloading under its file name", async () => {
    const backend = createMockBackend({ now: () => 1000 });
    const added = await backend.add("https://example.org/iso/fedora.iso");
    expect(added).toMatchObject({ id: 1, name: "fedora.iso", state: "downloading", received: 0, addedMs: 1000 });
    expect(added.dir).toBe("/home/you/Downloads");
    expect(await backend.list()).toHaveLength(1);
  });

  it("streams progress with a speed and a time left, then settles the download", async () => {
    const backend = createMockBackend();
    const { id, size } = await backend.add("https://example.org/a.bin");
    const { batches } = await collect(backend);

    backend.tick();
    const first = batches.at(-1)?.updates.find((u) => u.id === id);
    expect(first?.speed).toBeGreaterThan(0);
    expect(first?.leftMs).toBeGreaterThan(0);

    for (let i = 0; i < 1000 && !batches.at(-1)?.settled.includes(id); i++) backend.tick();
    expect(batches.at(-1)?.settled).toContain(id);
    const [done] = await backend.list();
    expect(done).toMatchObject({ state: "done", received: size });
    expect(done?.finishedMs).not.toBeNull();
  });

  it("stops moving while paused and continues after resume", async () => {
    const backend = createMockBackend();
    const { id } = await backend.add("https://example.org/b.bin");
    backend.tick();
    await backend.pause(id);
    const paused = (await backend.list())[0]?.received;
    backend.tick();
    expect((await backend.list())[0]).toMatchObject({ state: "paused", received: paused });
    await backend.resume(id);
    backend.tick();
    expect((await backend.list())[0]?.received).toBeGreaterThan(paused ?? 0);
  });

  it("honours the speed limit per tick", async () => {
    const backend = createMockBackend();
    await backend.updateSettings({ downloadDir: "/d", connections: 4, speedLimit: 2 * MB, appearance: "system" });
    await backend.add("https://example.org/c.bin");
    backend.tick();
    expect((await backend.list())[0]?.received).toBe(Math.floor((2 * MB) / 10));
  });

  it("refuses what is not a download link, and unknown ids", async () => {
    const backend = createMockBackend();
    await expect(backend.add("not a link")).rejects.toMatchObject({ kind: "invalid" });
    await expect(backend.add("mailto:a@example.org")).rejects.toMatchObject({ kind: "invalid" });
    await expect(backend.pause(99)).rejects.toMatchObject({ kind: "notFound" });
    const { id } = await backend.add("https://example.org/d.bin");
    await backend.remove(id, true);
    await expect(backend.remove(id, true)).rejects.toMatchObject({ kind: "notFound" });
  });

  it("validates settings like the core does", async () => {
    const backend = createMockBackend();
    const settings = await backend.settings();
    await expect(backend.updateSettings({ ...settings, connections: 0 })).rejects.toMatchObject({ kind: "invalid" });
    await expect(backend.updateSettings({ ...settings, speedLimit: 0 })).rejects.toMatchObject({ kind: "invalid" });
    expect(await backend.settings()).toEqual(settings);
  });

  it("stops calling a listener after it unsubscribes", async () => {
    const backend = createMockBackend();
    const { batches, stop } = await collect(backend);
    backend.tick();
    stop();
    backend.tick();
    expect(batches).toHaveLength(1);
  });

  it("opens only a finished file, and any download's folder", async () => {
    const backend = createMockBackend({
      seed: [
        { url: "https://example.org/done.zip", state: "done" },
        { url: "https://example.org/half.iso", state: "paused", progress: 0.5 },
      ],
    });
    await expect(backend.openFile(1)).resolves.toBeUndefined();
    await expect(backend.openFile(2)).rejects.toMatchObject({ kind: "invalid", message: "half.iso isn't finished yet" });
    await expect(backend.showInFolder(2)).resolves.toBeUndefined();
    await expect(backend.showInFolder(9)).rejects.toMatchObject({ kind: "notFound" });
  });

  it("keeps each download's history", async () => {
    let clock = 1000;
    const backend = createMockBackend({ now: () => clock, seed: [{ url: "https://example.org/x.zip", state: "failed", progress: 0.5, size: 100, error: "refused" }] });
    expect((await backend.events(1)).map((e) => e.kind)).toEqual(["added", "started", "failed"]);
    expect((await backend.events(1))[2]).toMatchObject({ bytes: 50, detail: "refused" });

    const { id } = await backend.add("https://example.org/a.bin");
    backend.tick();
    clock = 2000;
    await backend.pause(id);
    await backend.resume(id);
    for (let i = 0; i < 1000 && (await backend.list()).find((d) => d.id === id)?.state !== "done"; i++) backend.tick();
    const events = await backend.events(id);
    expect(events.map((e) => e.kind)).toEqual(["added", "started", "paused", "resumed", "finished"]);
    expect(events[2]).toMatchObject({ atMs: 2000 });
    await backend.remove(id, false);
    await expect(backend.events(id)).rejects.toMatchObject({ kind: "notFound" });
  });

  it("stops calling scheme listeners once disposed", async () => {
    const backend = createMockBackend();
    const seen: unknown[] = [];
    await backend.onColorScheme((scheme) => seen.push(scheme));
    backend.setColorScheme("dark");
    backend.dispose();
    backend.setColorScheme("light");
    expect(seen).toEqual(["dark"]);
  });

  it("starts with the seed links", async () => {
    const backend = createMockBackend({ seed: ["https://example.org/one.zip", "https://example.org/two.zip"] });
    expect((await backend.list()).map((d) => d.name)).toEqual(["one.zip", "two.zip"]);
  });
});
