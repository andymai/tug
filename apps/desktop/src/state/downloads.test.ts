import { describe, expect, it, vi } from "vitest";

import { BackendError, type DownloadEvent, type Inspection, type Settings } from "../backend/backend";
import { createMockBackend } from "../backend/mock";
import { countFor, createDownloadsStore, savedViewOf, visibleItems } from "./downloads";

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

  it("shows one type in a type view, and goes to All when an add lands outside it", async () => {
    const { store } = await ready();
    store.getState().setView("archive");
    expect(visibleItems(store.getState()).map((d) => d.name)).toEqual(["blender.tar.xz", "fonts.zip"]);
    expect(countFor(store.getState().items, "disk")).toBe(1);
    await store.getState().addLinks(["https://example.org/new.iso"]);
    expect(store.getState().view).toBe("all");
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

  it("reloads when a download starts or changes outside a tick, not on each tick of a running one", async () => {
    const backend = createMockBackend({ seed: showcase });
    let lists = 0;
    const store = createDownloadsStore({
      ...backend,
      list: () => {
        lists += 1;
        return backend.list();
      },
    });
    await store.getState().init();
    const id = (state: string) => store.getState().items.find((d) => d.state === state)?.id ?? -1;
    const update = (of: number) => ({ id: of, phase: "downloading" as const, received: MB, total: null, speed: MB, leftMs: null, connections: 1 });
    const before = lists;

    const batch = (seq: number, of: string, revision: number) => ({ seq, updates: [update(id(of))], settled: [], revision, error: null });

    store.getState().applyBatch(batch(1, "downloading", 4));
    expect(lists, "the first batch brings a revision to compare").toBe(before + 1);
    store.getState().applyBatch(batch(2, "downloading", 4));
    expect(lists).toBe(before + 1);
    store.getState().applyBatch(batch(3, "queued", 4));
    expect(lists, "a waiting download started").toBe(before + 2);
    store.getState().applyBatch(batch(4, "downloading", 6));
    expect(lists, "something changed, also in a batch the window never saw").toBe(before + 3);
  });

  it("shows a browser download that waits in the queue after the next tick", async () => {
    const { backend, store } = await ready();
    await backend.updateSettings({ ...(await backend.settings()), confirmCaptures: false, maxActive: 1 });
    backend.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await backend.capture("https://example.org/later.iso");
    expect(store.getState().items.some((d) => d.name === "later.iso")).toBe(false);

    backend.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().items.find((d) => d.name === "later.iso")?.state).toBe("queued");
  });

  it("keeps only the newest search's answer", async () => {
    const backend = createMockBackend({ seed: showcase });
    const answers: ((ids: number[]) => void)[] = [];
    const store = createDownloadsStore({
      ...backend,
      search: () =>
        new Promise<number[]>((resolve) => {
          answers.push(resolve);
        }),
    });
    await store.getState().init();
    store.getState().setSearch("fed");
    store.getState().setSearch("fedora");
    answers[1]?.([1]);
    answers[0]?.([1, 2, 3]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(visibleItems(store.getState()).map((d) => d.id)).toEqual([1]);

    store.getState().setSearch("  ");
    expect(store.getState().matches).toBeNull();
  });

  it("searches again after a reload, also while the first answer is on its way", async () => {
    const backend = createMockBackend({ seed: showcase });
    const asked: string[] = [];
    const store = createDownloadsStore({
      ...backend,
      search: (query) => {
        asked.push(query);
        return new Promise<number[]>(() => undefined);
      },
    });
    await store.getState().init();
    store.getState().setSearch("fedora");
    await store.getState().reload();
    expect(asked).toEqual(["fedora", "fedora"]);
  });

  it("clears a search that hides the download it goes to", async () => {
    const { store } = await ready();
    store.getState().setSearch("fedora");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const talk = store.getState().items.find((d) => d.name === "talk.mp4")?.id ?? -1;
    store.getState().reveal(talk);
    expect(store.getState()).toMatchObject({ search: "", matches: null, selected: talk, focusRequest: talk });

    store.getState().setSearch("talk");
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.getState().reveal(talk);
    expect(store.getState().search, "a search that shows it stays").toBe("talk");
  });

  it("clears a search for a jump while the search's answer is on its way", async () => {
    const backend = createMockBackend({ seed: showcase });
    const answers: ((ids: number[]) => void)[] = [];
    const store = createDownloadsStore({
      ...backend,
      search: (query) =>
        query === "talk"
          ? backend.search(query)
          : new Promise<number[]>((resolve) => {
              answers.push(resolve);
            }),
    });
    await store.getState().init();
    const talk = store.getState().items.find((d) => d.name === "talk.mp4")?.id ?? -1;

    store.getState().setSearch("fedora");
    store.getState().reveal(talk);
    answers[0]?.([1]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState()).toMatchObject({ search: "", matches: null });
    expect(visibleItems(store.getState()).map((d) => d.id)).toContain(talk);

    store.getState().setSearch("talk");
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.getState().setSearch("fedora");
    store.getState().reveal(talk);
    answers[1]?.([1]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().search, "an older answer that showed it doesn't count").toBe("");
  });

  it("saves a search once, and opens a view the window doesn't know as All", async () => {
    const { backend, store } = await ready();
    store.getState().setView("done");
    store.getState().setSearch("  fonts ");
    store.getState().saveView();
    store.getState().saveView();
    await vi.waitFor(async () => {
      expect((await backend.settings()).savedViews).toEqual([{ name: "fonts", view: "done", query: "fonts" }]);
    });
    expect(savedViewOf(store.getState())?.name).toBe("fonts");

    store.getState().openView({ name: "old", view: "gone", query: "iso" });
    expect(store.getState()).toMatchObject({ view: "all", search: "iso" });
    expect(savedViewOf(store.getState())).toBeNull();
  });

  it("saves a long search under a shorter name, and stops at the most views", async () => {
    const { backend, store } = await ready();
    const long = `fedora ${"x".repeat(80)}`;
    store.getState().setSearch(` ${long.replace(" ", "\t  ")} `);
    store.getState().saveView();
    await vi.waitFor(async () => {
      expect((await backend.settings()).savedViews).toHaveLength(1);
    });
    const [saved] = (await backend.settings()).savedViews;
    expect(saved?.query).toBe(long);
    expect(saved?.name).toBe(long.slice(0, 60));

    const full = Array.from({ length: 50 }, (_, n) => ({ name: `v${String(n)}`, view: "all", query: `q${String(n)}` }));
    await store.getState().saveSettings({ savedViews: full });
    store.getState().setSearch("one more");
    store.getState().saveView();
    expect(store.getState().notice).toMatch(/at most 50 saved views/);
    expect((await backend.settings()).savedViews).toHaveLength(50);
  });

  it("knows a saved search however its spaces are typed", async () => {
    const { backend, store } = await ready();
    store.getState().setSearch(" report  june ");
    store.getState().saveView();
    await vi.waitFor(async () => {
      expect((await backend.settings()).savedViews.map((v) => v.query)).toEqual(["report june"]);
    });
    expect(savedViewOf(store.getState())?.query).toBe("report june");
  });

  it("says why a view didn't save, and a failed save doesn't take the next one down", async () => {
    const backend = createMockBackend({ seed: showcase });
    let fail = true;
    const store = createDownloadsStore({
      ...backend,
      updateSettings: (next) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("the disk is full"));
        }
        return backend.updateSettings(next);
      },
    });
    await store.getState().init();
    store.getState().setSearch("fedora");
    store.getState().saveView();
    store.getState().setSearch("talk");
    store.getState().saveView();
    await vi.waitFor(async () => {
      expect((await backend.settings()).savedViews.map((v) => v.query)).toEqual(["talk"]);
    });
    expect(store.getState().notice).toBe("couldn't save the view: the disk is full");
  });

  it("keeps one total speed a second, newest last, for a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { store } = await ready();
      const batch = (speed: number) => ({
        seq: 1,
        updates: [{ id: 1, phase: "downloading" as const, received: 0, total: null, speed, leftMs: null, connections: 1 }],
        settled: [],
        revision: 0,
        error: null,
      });
      store.getState().applyBatch(batch(5));
      store.getState().applyBatch(batch(7));
      vi.setSystemTime(Date.now() + 1000);
      store.getState().applyBatch(batch(9));
      expect(store.getState().speeds).toEqual([5, 9]);
      for (let at = 0; at < 70; at++) {
        vi.setSystemTime(Date.now() + 1000);
        store.getState().applyBatch(batch(at));
      }
      expect(store.getState().speeds).toHaveLength(60);
      expect(store.getState().speeds.at(-1)).toBe(69);
    } finally {
      vi.useRealTimers();
    }
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
    store.getState().applyBatch({ seq: 9, updates: [], settled: [done?.id ?? -1], revision: 1, error: "couldn't save progress" });
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

    await store.getState().saveSettings({ connections: 16 });
    expect(store.getState().settings?.connections).toBe(16);

    await store.getState().saveSettings({ connections: 0 });
    expect(store.getState().settings?.connections).toBe(16);
    expect(store.getState().settingsError).toMatch(/between 1 and 32/);
  });

  function gated(backend: ReturnType<typeof createMockBackend>) {
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
    return { store, writes, release };
  }

  it("keeps two quick changes, saved in order", async () => {
    const backend = createMockBackend();
    const { store, writes, release } = gated(backend);
    await store.getState().init();
    const first = store.getState().saveSettings({ connections: 12 });
    const second = store.getState().saveSettings({ speedLimit: 1 << 20 });
    expect(store.getState().settings).toMatchObject({ connections: 12, speedLimit: 1 << 20 });
    release();
    await Promise.all([first, second]);
    expect(writes.map((w) => [w.connections, w.speedLimit])).toEqual([
      [12, null],
      [12, 1 << 20],
    ]);
    expect(await backend.settings()).toMatchObject({ connections: 12, speedLimit: 1 << 20 });
  });

  it("drops a refused change and keeps a later one that saved", async () => {
    const backend = createMockBackend();
    const { store, release } = gated(backend);
    await store.getState().init();
    const refused = store.getState().saveSettings({ connections: 0 });
    const saved = store.getState().saveSettings({ speedLimit: 1 << 20 });
    release();
    await Promise.all([refused, saved]);
    expect(store.getState().settings).toMatchObject({ connections: 8, speedLimit: 1 << 20 });
    expect(await backend.settings()).toMatchObject({ connections: 8, speedLimit: 1 << 20 });
    expect(store.getState().settingsError).toMatch(/between 1 and 32/);
  });

  it("clears the chooser's failure when a retry succeeds, and keeps a refused change's reason", async () => {
    const backend = createMockBackend({ folder: "/data/iso" });
    let fail = true;
    const store = createDownloadsStore({
      ...backend,
      chooseDownloadFolder: () => (fail ? Promise.reject(new Error("the folder chooser failed: no portal")) : backend.chooseDownloadFolder()),
    });
    await store.getState().init();
    await store.getState().chooseFolder();
    expect(store.getState().settingsError).toMatch(/no portal/);
    fail = false;
    await store.getState().chooseFolder();
    expect(store.getState().settingsError).toBeNull();
    expect(store.getState().settings?.downloadDir).toBe("/data/iso");

    await store.getState().saveSettings({ connections: 0 });
    await store.getState().chooseFolder();
    expect(store.getState().settingsError).toMatch(/between 1 and 32/);
  });

  it("keeps a chosen folder when a change was queued after it", async () => {
    const backend = createMockBackend({ folder: "/data/iso" });
    const { store, release } = gated(backend);
    await store.getState().init();
    const slow = store.getState().saveSettings({ connections: 4 });
    const folder = store.getState().chooseFolder();
    const after = store.getState().saveSettings({ connections: 16 });
    release();
    await Promise.all([slow, folder, after]);
    expect(await backend.settings()).toMatchObject({ downloadDir: "/data/iso", connections: 16 });
    expect(store.getState().settings).toMatchObject({ downloadDir: "/data/iso", connections: 16 });
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

  it("checks the disk once at a time, and once more for a request made during a check", async () => {
    const backend = createMockBackend({ seed: showcase });
    const answers: ((free: number) => void)[] = [];
    const store = createDownloadsStore({
      ...backend,
      diskFree: () =>
        new Promise<number>((resolve) => {
          answers.push(resolve);
        }),
    });
    const first = store.getState().checkDisk();
    void store.getState().checkDisk();
    void store.getState().checkDisk();
    expect(answers).toHaveLength(1);
    answers[0]?.(100);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    answers[1]?.(200);
    await first;
    expect(store.getState().diskFree).toBe(200);
    expect(answers).toHaveLength(2);
  });

  it("keeps the newest inspection of the selected download, quiet when it went", async () => {
    const backend = createMockBackend({ seed: showcase });
    const answers: { resolve: (seen: Inspection | null) => void; reject: (error: unknown) => void }[] = [];
    const store = createDownloadsStore({
      ...backend,
      inspect: () =>
        new Promise<Inspection | null>((resolve, reject) => {
          answers.push({ resolve, reject });
        }),
    });
    const seen = (text: string): Inspection => ({ segments: [], connections: [], server: null, log: [{ seq: 1, atMs: 0, text }] });
    store.getState().select(1);
    const older = store.getState().inspect(1);
    const newer = store.getState().inspect(1);
    answers[1]?.resolve(seen("newer"));
    await newer;
    answers[0]?.resolve(seen("older"));
    await older;
    expect(store.getState().inspection?.data?.log[0]?.text).toBe("newer");

    store.getState().select(2);
    const other = store.getState().inspect(1);
    answers[2]?.resolve(seen("not shown"));
    await other;
    expect(store.getState().inspection?.data?.log[0]?.text).toBe("newer");

    const gone = store.getState().inspect(2);
    answers[3]?.reject(new BackendError("notFound", "there is no download 2"));
    await gone;
    expect(store.getState().notice).toBeNull();
    const broken = store.getState().inspect(2);
    answers[4]?.reject(new BackendError("internal", "the run lock is poisoned"));
    await broken;
    expect(store.getState().notice).toBe("the run lock is poisoned");
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

  it("keeps a scheme change that arrives while the first read is pending", async () => {
    const backend = createMockBackend({ colorScheme: "light" });
    let answer: (scheme: "light" | "dark" | null) => void = () => undefined;
    let asked: () => void = () => undefined;
    const reading = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const store = createDownloadsStore({
      ...backend,
      systemColorScheme: () =>
        new Promise((resolve) => {
          answer = resolve;
          asked();
        }),
    });
    const started = store.getState().init();
    await reading;
    backend.setColorScheme("dark");
    answer("light");
    await started;
    expect(store.getState().systemScheme).toBe("dark");
  });

  it("shows a notice the backend sends, until it stops listening", async () => {
    const { backend, store, stop } = await ready();
    backend.notice("couldn't resume a download: the server refused");
    expect(store.getState().notice).toBe("couldn't resume a download: the server refused");
    store.getState().dismissNotice();
    stop();
    backend.notice("another");
    expect(store.getState().notice).toBeNull();
  });

  it("says why notices can't be followed, and still loads", async () => {
    const backend = createMockBackend({ seed: showcase });
    const store = createDownloadsStore({ ...backend, onNotice: () => Promise.reject(new Error("the event bus is closed")) });
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: "ready", notice: "the event bus is closed" });
  });

  it("records an error instead of throwing when the backend refuses", async () => {
    const { store } = await ready();
    await store.getState().resume(999);
    expect(store.getState().notice).toMatch(/no download 999/);
  });
});
