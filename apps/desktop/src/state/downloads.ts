import { createStore } from "zustand/vanilla";

import {
  type Backend,
  BackendError,
  type CaptureAnswer,
  type Category,
  type ColorScheme,
  type Download,
  type DownloadEvent,
  type DownloadState,
  type AddOptions,
  type CookiesChange,
  type Headers,
  type Inspection,
  type Place,
  type ProgressBatch,
  type TorrentView,
  type ProgressUpdate,
  type ResizeEdge,
  type SavedView,
  type Settings,
} from "../backend/backend";
import { isCategory } from "../lib/categories";
import { covering } from "../lib/covering";
import { queueRanks, sortItems, sortOf } from "../lib/columns";
import { shownLink } from "../lib/links";

export type StateView = "all" | "active" | "done" | "failed";
// A function patch reads the settings it lands on, so a change to a list never
// carries an earlier patch that failed.
export type SettingsPatch = Partial<Settings> | ((current: Settings) => Partial<Settings>);
export const MAX_SAVED_VIEWS = 50;
export const SAMPLES = 60;
const SAMPLE_MS = 1000;
const DEFAULT_LIMIT = 10 * (1 << 20);

function patched(settings: Settings, patch: SettingsPatch): Settings {
  return { ...settings, ...(typeof patch === "function" ? patch(settings) : patch) };
}
export type View = StateView | Category;

export const VIEWS: readonly { id: StateView; label: string; states: readonly DownloadState[] }[] = covering<StateView>().by<"id">()([
  { id: "all", label: "All", states: ["queued", "downloading", "paused", "done", "failed"] },
  { id: "active", label: "Active", states: ["queued", "downloading", "paused"] },
  { id: "done", label: "Done", states: ["done"] },
  { id: "failed", label: "Failed", states: ["failed"] },
]);

export interface DownloadsState {
  items: Download[];
  live: Record<number, ProgressUpdate>;
  view: View;
  // The current row: it has the focus, and its details show when it is the only one marked.
  selected: number | null;
  // Every selected row; bulk actions take the ones the view shows (`chosen`).
  marked: number[];
  menu: { x: number; y: number } | null;
  removing: number[] | null;
  // The queued rows a drag carries, and where they would land.
  dragging: number[] | null;
  dropMark: { id: number; edge: "top" | "bottom" } | null;
  status: "loading" | "ready" | "error";
  loadError: string | null;
  notice: string | null;
  settings: Settings | null;
  systemScheme: ColorScheme | null;
  settingsError: string | null;
  page: Page;
  adding: Adding;
  fresh: number[];
  history: { id: number; data: DownloadEvent[] } | null;
  inspection: { id: number; data: Inspection | null } | null;
  inspectorTab: InspectorTab;
  overlay: Overlay;
  focusRequest: number | null;
  search: string;
  matches: number[] | null;
  searchRequest: number;
  // Total speed, one sample a second, the newest last.
  speeds: number[];
  diskFree: number | null;
  // The speed limit that turning the limit on brings back.
  lastLimit: number;
  captures: Download[];
  framed: boolean;
  maximized: boolean;
  init: () => Promise<() => void>;
  reload: () => Promise<void>;
  applyBatch: (batch: ProgressBatch) => void;
  setView: (view: View) => void;
  setPage: (page: Page) => void;
  saveSettings: (patch: SettingsPatch) => Promise<boolean>;
  // For a choice made outside the Settings page, whose error shows only there.
  savePreference: (patch: SettingsPatch, what: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
  select: (id: number | null) => void;
  toggleMark: (id: number) => void;
  markTo: (id: number) => void;
  markAll: () => void;
  step: (delta: number, extend?: boolean) => number | null;
  openMenu: (at: { x: number; y: number }) => void;
  closeMenu: () => void;
  askRemove: (ids: readonly number[]) => void;
  cancelRemove: () => void;
  pauseMany: (ids: readonly number[]) => Promise<void>;
  resumeMany: (ids: readonly number[]) => Promise<void>;
  moveMany: (ids: readonly number[], to: "first" | "last") => Promise<void>;
  moveNextTo: (ids: readonly number[], target: number, after: boolean) => Promise<void>;
  moveOne: (id: number, to: "up" | "down") => Promise<void>;
  startDrag: (ids: readonly number[]) => void;
  markDrop: (mark: { id: number; edge: "top" | "bottom" } | null) => void;
  endDrag: () => void;
  removeMany: (ids: readonly number[], deleteFiles: boolean) => Promise<void>;
  setOverlay: (overlay: Overlay) => void;
  requestFocus: (id: number | null) => void;
  setSearch: (text: string) => void;
  reveal: (id: number) => void;
  saveView: () => void;
  openView: (saved: SavedView) => void;
  removeView: (saved: SavedView) => void;
  openSearch: () => void;
  checkDisk: () => Promise<void>;
  pause: (id: number) => Promise<void>;
  resume: (id: number) => Promise<void>;
  startNext: (id: number) => Promise<void>;
  openFile: (id: number) => Promise<void>;
  showInFolder: (id: number) => Promise<void>;
  loadHistory: (id: number) => Promise<void>;
  inspect: (id: number) => Promise<void>;
  torrent: { id: number; data: TorrentView | null } | null;
  loadTorrent: (id: number) => Promise<void>;
  chooseFiles: (id: number, files: number[]) => Promise<void>;
  setInspectorTab: (tab: InspectorTab) => void;
  notify: (message: string) => void;
  dismissNotice: () => void;
  openAdd: (text?: string) => void;
  setAddText: (text: string) => void;
  closeAdd: () => void;
  addLinks: (hrefs: readonly string[], options?: { dir?: string; add?: AddOptions }) => Promise<void>;
  setOptions: (id: number, connections: number | null, speedLimit: number | null) => Promise<boolean>;
  // The download whose name the panel edits.
  renaming: number | null;
  startRename: (id: number | null) => void;
  rename: (id: number, name: string) => Promise<boolean>;
  headers: { id: number; data: Headers } | null;
  loadHeaders: (id: number) => Promise<void>;
  // The saved headers, or null when the save failed.
  setHeaders: (id: number, referrer: string | null, cookies: CookiesChange, userAgent: string | null) => Promise<Headers | null>;
  pickFolder: (from?: string) => Promise<string | null>;
  // Adds the chosen .torrent files to the open dialog's links.
  chooseTorrents: () => Promise<void>;
  settleFresh: (id: number) => void;
  answerCapture: (id: number, answer: CaptureAnswer) => Promise<void>;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  startResize: (edge: ResizeEdge) => void;
}

export type Overlay = "commands" | "shortcuts" | null;

export type InspectorTab = "overview" | "connections" | "log" | "files" | "peers";

type Slot = "history" | "inspection" | "torrent" | "headers";
type SlotData<K extends Slot> = NonNullable<DownloadsState[K]>["data"];

export type Page = "downloads" | "settings";

export interface Adding {
  open: boolean;
  text: string;
  busy: boolean;
  error: string | null;
  session: number;
}

const CLOSED: Adding = { open: false, text: "", busy: false, error: null, session: 0 };

export type DownloadsStore = ReturnType<typeof createDownloadsStore>;

export function createDownloadsStore(backend: Backend) {
  return createStore<DownloadsState>()((set, get) => {
    // Where a Shift-click or Shift+arrow range starts.
    let anchor: number | null = null;
    let disk: Promise<void> | null = null;
    let diskAsked = 0;
    const newest: Record<Slot, number> = { history: 0, inspection: 0, torrent: 0, headers: 0 };

    // The newest answer for the download on screen. An older answer, or one for a
    // download the panel no longer shows, goes nowhere, failures too; a removed
    // download is quiet. Every panel load goes through here (ESLint refuses others).
    const loadSlot = async <K extends Slot>(slot: K, id: number, ask: () => Promise<SlotData<K>>) => {
      const request = ++newest[slot];
      const current = () => request === newest[slot] && shownId(get()) === id;
      try {
        const data = await ask();
        if (current()) set({ [slot]: { id, data } } as Pick<DownloadsState, K>);
      } catch (error) {
        const failure = BackendError.from(error);
        if (current() && failure.kind !== "notFound") set({ notice: failure.message });
      }
    };
    const newestSave: Record<Slot, number> = { history: 0, inspection: 0, torrent: 0, headers: 0 };
    // A save's answer replaces the slot only if no later save started, and only for
    // the download on screen; only then it outdates a load on its way, so another
    // download's load goes on.
    const saveSlot = async <K extends Slot>(slot: K, id: number, ask: () => Promise<SlotData<K>>) => {
      const save = ++newestSave[slot];
      const data = await ask();
      if (save === newestSave[slot] && shownId(get()) === id) {
        ++newest[slot];
        set({ [slot]: { id, data } } as Pick<DownloadsState, K>);
      }
      return data;
    };

    // One by one, then one reload, and one notice for what failed.
    const many = async (order: readonly Download[], verb: string, action: (id: number) => Promise<void>) => {
      const failed: string[] = [];
      for (const item of order) {
        try {
          await action(item.id);
        } catch (error) {
          failed.push(BackendError.from(error).message);
        }
      }
      set({ menu: null });
      await get().reload();
      const [first] = failed;
      if (first === undefined) return;
      set({ notice: failed.length === 1 ? first : `couldn't ${verb} ${String(failed.length)} downloads: ${first}` });
    };

    const act = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        set({ notice: BackendError.from(error).message });
      }
    };

    let revision: number | null = null;
    let searches = 0;
    let answered = 0;
    let sampled = 0;
    // Answers can arrive out of order, so only the newest search may set the matches.
    const find = async (text: string) => {
      const asked = ++searches;
      if (text.trim() === "") {
        answered = asked;
        set({ matches: null });
        return;
      }
      try {
        const matches = await backend.search(text);
        if (asked === searches) {
          answered = asked;
          set({ matches });
        }
      } catch (error) {
        if (asked === searches) {
          answered = asked;
          set({ notice: BackendError.from(error).message });
        }
      }
    };
    let confirmed: Settings | null = null;
    let pending: { id: number; patch: SettingsPatch }[] = [];
    let patches = 0;
    let chooserFailed = false;
    let saving: Promise<void> = Promise.resolve();
    const queue = (task: () => Promise<void>) => {
      saving = saving.then(task);
      return saving;
    };
    const show = (settings: Settings) => {
      set(settings.speedLimit === null ? { settings } : { settings, lastLimit: settings.speedLimit });
    };
    const showSettings = () => {
      if (confirmed === null) return;
      show(pending.reduce<Settings>((settings, { patch }) => patched(settings, patch), confirmed));
    };

    const loadSettings = async () => {
      try {
        confirmed = await backend.settings();
        show(confirmed);
      } catch (error) {
        set({ notice: BackendError.from(error).message });
      }
    };

    return {
      items: [],
      live: {},
      view: "all",
      selected: null,
      marked: [],
      menu: null,
      removing: null,
      dragging: null,
      dropMark: null,
      renaming: null,
      headers: null,
      status: "loading",
      loadError: null,
      notice: null,
      settings: null,
      systemScheme: null,
      settingsError: null,
      page: "downloads",
      adding: CLOSED,
      fresh: [],
      history: null,
      inspection: null,
      torrent: null,
      inspectorTab: "overview",
      overlay: null,
      focusRequest: null,
      search: "",
      matches: null,
      searchRequest: 0,
      speeds: [],
      diskFree: null,
      lastLimit: DEFAULT_LIMIT,
      captures: [],
      framed: backend.windowControls !== null,
      maximized: false,

      init: async () => {
        let stop: () => void = () => undefined;
        try {
          stop = await backend.onProgress((batch) => {
            get().applyBatch(batch);
          });
        } catch (error) {
          set({ notice: BackendError.from(error).message });
        }
        const unnotice = await backend
          .onNotice((notice) => {
            set({ notice });
          })
          .catch((error: unknown) => {
            set({ notice: BackendError.from(error).message });
            return () => undefined;
          });
        let capturesEvent = false;
        const uncapture = await backend
          .onCaptures((captures) => {
            capturesEvent = true;
            set({ captures });
            void get().reload();
          })
          .catch(() => () => undefined);
        const unfocus = await backend
          .onFocusDownload((id) => {
            void get()
              .reload()
              .then(() => {
                const state = get();
                const item = state.items.find((download) => download.id === id);
                if (item === undefined) return;
                if (state.overlay !== null) state.setOverlay(null);
                state.reveal(id);
              });
          })
          .catch(() => () => undefined);
        const controls = backend.windowControls;
        let maximizedEvent = false;
        const unmaximized =
          controls === null
            ? () => undefined
            : await controls
                .onMaximized((maximized) => {
                  maximizedEvent = true;
                  set({ maximized });
                })
                .catch(() => () => undefined);
        void controls?.isMaximized().then(
          (maximized) => {
            if (!maximizedEvent) set({ maximized });
          },
          () => undefined,
        );
        let schemeEvent = false;
        const unwatch = await backend
          .onColorScheme((systemScheme) => {
            schemeEvent = true;
            set({ systemScheme });
          })
          .catch(() => () => undefined);
        await Promise.all([
          get().reload(),
          loadSettings(),
          backend.systemColorScheme().then(
            (systemScheme) => {
              if (!schemeEvent) set({ systemScheme });
            },
            () => undefined,
          ),
          backend.pendingCaptures().then(
            (captures) => {
              if (!capturesEvent) set({ captures });
            },
            () => undefined,
          ),
        ]);
        return () => {
          stop();
          unwatch();
          unnotice();
          uncapture();
          unfocus();
          unmaximized();
        };
      },

      reload: async () => {
        try {
          const items = await backend.list();
          set({ items, status: "ready", loadError: null });
          if (get().search.trim() !== "") void find(get().search);
        } catch (error) {
          set({ status: "error", loadError: BackendError.from(error).message });
        }
      },

      applyBatch: (batch) => {
        const live = Object.fromEntries(batch.updates.map((update) => [update.id, update]));
        set(batch.error === null ? { live } : { live, notice: batch.error });
        const at = Date.now();
        if (at - sampled >= SAMPLE_MS) {
          sampled = at;
          const total = batch.updates.reduce((sum, update) => sum + update.speed, 0);
          set((state) => ({ speeds: [...state.speeds, total].slice(-SAMPLES) }));
        }
        const states = new Map(get().items.map((item) => [item.id, item.state]));
        const news = batch.revision !== revision;
        revision = batch.revision;
        if (news || batch.updates.some((update) => states.get(update.id) !== "downloading")) {
          void get().reload();
        }
      },

      setView: (view) => {
        anchor = null;
        set({ view, selected: null, marked: [], menu: null, page: "downloads" });
      },

      setPage: (page) => {
        set({ page, settingsError: null });
      },

      saveSettings: (patch) => {
        const id = ++patches;
        pending.push({ id, patch });
        chooserFailed = false;
        set({ settingsError: null });
        showSettings();
        let saved = false;
        return queue(async () => {
          if (confirmed === null) return;
          const next = patched(confirmed, patch);
          try {
            await backend.updateSettings(next);
            confirmed = next;
            saved = true;
          } catch (error) {
            set({ settingsError: BackendError.from(error).message });
          } finally {
            pending = pending.filter((entry) => entry.id !== id);
            showSettings();
          }
        }).then(() => saved);
      },

      savePreference: async (patch, what) => {
        const saved = await get().saveSettings(patch);
        if (!saved) set({ notice: `couldn't save ${what}: ${get().settingsError ?? "the settings didn't save"}` });
      },

      chooseFolder: () =>
        queue(async () => {
          try {
            const chosen = await backend.chooseDownloadFolder();
            if (chosen !== null) confirmed = chosen;
            if (chooserFailed) set({ settingsError: null });
            chooserFailed = false;
          } catch (error) {
            chooserFailed = true;
            set({ settingsError: BackendError.from(error).message });
          } finally {
            showSettings();
          }
        }),

      select: (id) => {
        anchor = id;
        set({ selected: id, marked: id === null ? [] : [id] });
      },

      toggleMark: (id) => {
        const { marked } = get();
        if (marked.includes(id)) {
          const rest = marked.filter((other) => other !== id);
          anchor = rest.at(-1) ?? null;
          set({ marked: rest, selected: anchor });
        } else {
          anchor = id;
          set({ marked: [...marked, id], selected: id });
        }
      },

      markTo: (id) => {
        const visible = visibleItems(get()).map((item) => item.id);
        const from = visible.indexOf(anchor ?? id);
        const to = visible.indexOf(id);
        if (from === -1 || to === -1) {
          get().select(id);
          return;
        }
        set({ marked: visible.slice(Math.min(from, to), Math.max(from, to) + 1), selected: id });
      },

      markAll: () => {
        const visible = visibleItems(get()).map((item) => item.id);
        if (visible.length === 0) return;
        const selected = get().selected ?? visible[0] ?? null;
        anchor ??= selected;
        set({ marked: visible, selected });
      },

      step: (delta, extend = false) => {
        const visible = visibleItems(get());
        if (visible.length === 0) return null;
        const at = visible.findIndex((item) => item.id === get().selected);
        const next =
          at === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, at + delta));
        const id = visible[next]?.id ?? null;
        if (id === null) return null;
        if (extend) get().markTo(id);
        else get().select(id);
        return id;
      },

      openMenu: (at) => {
        set({ menu: at });
      },

      closeMenu: () => {
        set({ menu: null });
      },

      askRemove: (ids) => {
        if (ids.length > 0) set({ removing: [...ids], menu: null });
      },

      cancelRemove: () => {
        set({ removing: null });
      },

      pauseMany: (ids) => {
        // The waiting ones first, so a slot that a pause frees doesn't start one of them.
        const waiting = (state: Download["state"]) => (state === "queued" ? 0 : 1);
        const order = chosenOf(get(), ids)
          .filter((item) => item.state === "downloading" || item.state === "queued")
          .sort((a, b) => waiting(a.state) - waiting(b.state));
        return many(order, "pause", (id) => backend.pause(id));
      },

      resumeMany: (ids) => {
        const order = chosenOf(get(), ids).filter((item) => item.state === "paused" || item.state === "failed");
        return many(order, "resume", (id) => backend.resume(id));
      },

      // To the top in reverse and to the end in order, so the moved keep their order.
      moveMany: (ids, to) => {
        const waiting = chosenOf(get(), ids)
          .filter((item) => item.state === "queued")
          .sort((a, b) => a.position - b.position);
        return many(to === "first" ? waiting.reverse() : waiting, "move", (id) => backend.place(id, to));
      },

      // Before the target in order, after it in reverse, so the moved keep their order.
      moveNextTo: (ids, target, after) => {
        const moving = chosenOf(get(), ids)
          .filter((item) => item.state === "queued" && item.id !== target)
          .sort((a, b) => a.position - b.position);
        const place: Place = after ? { after: target } : { before: target };
        return many(after ? moving.reverse() : moving, "move", (id) => backend.place(id, place));
      },

      moveOne: (id, to) =>
        act(async () => {
          await backend.place(id, to);
          await get().reload();
        }),

      startDrag: (ids) => {
        set({ dragging: [...ids], menu: null });
      },

      markDrop: (mark) => {
        const now = get().dropMark;
        if (now?.id === mark?.id && now?.edge === mark?.edge) return;
        set({ dropMark: mark });
      },

      endDrag: () => {
        set({ dragging: null, dropMark: null });
      },

      removeMany: async (ids, deleteFiles) => {
        const order = chosenOf(get(), ids);
        set({ removing: null });
        if (order.some((item) => item.id === get().selected) || order.some((item) => get().marked.includes(item.id))) {
          anchor = null;
          set({ selected: null, marked: [] });
        }
        await many(order, "remove", (id) => backend.remove(id, deleteFiles));
      },

      setOverlay: (overlay) => {
        set({ overlay });
      },

      setSearch: (text) => {
        set({ search: text });
        void find(text);
      },

      reveal: (id) => {
        const state = get();
        const item = state.items.find((download) => download.id === id);
        if (item === undefined) return;
        if (!inView(state.view, item)) state.setView("all");
        else state.setPage("downloads");
        const shown = answered === searches && (state.matches?.includes(id) ?? true);
        if (!shown) state.setSearch("");
        state.select(id);
        state.requestFocus(id);
      },

      saveView: () => {
        const { settings, search, view } = get();
        const query = queryOf(search);
        if (settings === null || query === "" || settings.savedViews.some((saved) => sameView(saved, { view, query }))) return;
        if (settings.savedViews.length >= MAX_SAVED_VIEWS) {
          set({ notice: `Tug keeps at most ${String(MAX_SAVED_VIEWS)} saved views. Remove one to save this search.` });
          return;
        }
        const entry = { name: Array.from(query).slice(0, 60).join(""), view, query };
        void get()
          .saveSettings((current) =>
            current.savedViews.some((saved) => sameView(saved, entry)) || current.savedViews.length >= MAX_SAVED_VIEWS
              ? {}
              : { savedViews: [...current.savedViews, entry] },
          )
          .then((saved) => {
            if (!saved) set({ notice: `couldn't save the view: ${get().settingsError ?? "the settings didn't save"}` });
          });
      },

      openView: (saved) => {
        get().setView(isView(saved.view) ? saved.view : "all");
        get().setSearch(saved.query);
      },

      removeView: (saved) => {
        void get()
          .saveSettings((current) => ({ savedViews: current.savedViews.filter((other) => !sameView(other, saved)) }))
          .then((removed) => {
            if (!removed) set({ notice: `couldn't remove the view: ${get().settingsError ?? "the settings didn't save"}` });
          });
      },

      // One check at a time, so a stalled folder can't pile them up; a request
      // during a check runs once after it, for a folder that just changed.
      checkDisk: () => {
        diskAsked += 1;
        if (disk !== null) return disk;
        disk = (async () => {
          let answered = 0;
          while (answered < diskAsked) {
            answered = diskAsked;
            try {
              set({ diskFree: await backend.diskFree() });
            } catch {
              set({ diskFree: null });
            }
          }
          disk = null;
        })();
        return disk;
      },

      openSearch: () => {
        set((state) => ({ page: "downloads", searchRequest: state.searchRequest + 1 }));
      },

      requestFocus: (id) => {
        set({ focusRequest: id });
      },

      pause: (id) =>
        act(async () => {
          await backend.pause(id);
          await get().reload();
        }),

      resume: (id) =>
        act(async () => {
          await backend.resume(id);
          await get().reload();
        }),

      startNext: (id) =>
        act(async () => {
          await backend.place(id, "first");
          await get().reload();
        }),

      openFile: (id) => act(() => backend.openFile(id)),

      showInFolder: (id) => act(() => backend.showInFolder(id)),

      loadHistory: (id) => loadSlot("history", id, () => backend.events(id)),

      inspect: (id) => loadSlot("inspection", id, () => backend.inspect(id)),

      loadTorrent: (id) => loadSlot("torrent", id, () => backend.torrentView(id)),

      chooseFiles: async (id, files) => {
        try {
          await saveSlot("torrent", id, () => backend.chooseFiles(id, files));
          await get().reload();
        } catch (error) {
          set({ notice: `couldn't choose the files: ${BackendError.from(error).message}` });
        }
      },

      setInspectorTab: (tab) => {
        set({ inspectorTab: tab });
      },

      notify: (message) => {
        set({ notice: message });
      },

      dismissNotice: () => {
        set({ notice: null });
      },

      openAdd: (text = "") => {
        const { adding } = get();
        if (adding.open) {
          const joined = [adding.text.trimEnd(), text].filter((part) => part !== "").join("\n");
          set({ adding: { ...adding, text: joined } });
        } else {
          set({ adding: { ...CLOSED, open: true, text, session: adding.session + 1 } });
        }
      },

      setAddText: (text) => {
        set({ adding: { ...get().adding, text, error: null } });
      },

      closeAdd: () => {
        set({ adding: { ...CLOSED, session: get().adding.session } });
      },

      addLinks: async (hrefs, options = {}) => {
        const { session } = get().adding;
        const ours = () => get().adding.open && get().adding.session === session;
        set({ adding: { ...get().adding, busy: true, error: null } });
        const added: number[] = [];
        const failed: { href: string; message: string }[] = [];
        for (const href of hrefs) {
          try {
            added.push((await backend.add(href, options.dir, options.add)).id);
          } catch (error) {
            failed.push({ href, message: BackendError.from(error).message });
          }
        }
        const [first] = failed;
        const reason =
          first === undefined
            ? null
            : failed.length === 1
              ? `couldn't add ${shownLink(first.href)}: ${first.message}`
              : `couldn't add ${String(failed.length)} links: ${first.message}`;
        if (added.length === 0) {
          if (ours()) set({ adding: { ...get().adding, busy: false, error: reason } });
          else if (reason !== null) set({ notice: reason });
          return;
        }
        const { view, fresh } = get();
        set({
          ...(ours() ? { adding: { ...CLOSED, session } } : {}),
          fresh: [...fresh, ...added],
          view: view === "all" || view === "active" ? view : "all",
          ...(reason === null ? {} : { notice: reason }),
        });
        await get().reload();
      },

      setOptions: async (id, connections, speedLimit) => {
        try {
          await backend.setOptions(id, connections, speedLimit);
          await get().reload();
          return true;
        } catch (error) {
          set({ notice: `couldn't change the download: ${BackendError.from(error).message}` });
          return false;
        }
      },

      loadHeaders: (id) => loadSlot("headers", id, () => backend.headers(id)),

      setHeaders: async (id, referrer, cookies, userAgent) => {
        try {
          return await saveSlot("headers", id, () => backend.setHeaders(id, referrer, cookies, userAgent));
        } catch (error) {
          set({ notice: `couldn't change the headers: ${BackendError.from(error).message}` });
          return null;
        }
      },

      startRename: (id) => {
        set({ renaming: id, menu: null });
      },

      rename: async (id, name) => {
        try {
          await backend.rename(id, name);
          await get().reload();
          return true;
        } catch (error) {
          set({ notice: `couldn't rename it: ${BackendError.from(error).message}` });
          return false;
        }
      },

      pickFolder: async (from) => {
        try {
          return await backend.chooseFolder(from);
        } catch (error) {
          set({ notice: BackendError.from(error).message });
          return null;
        }
      },

      chooseTorrents: async () => {
        const { session } = get().adding;
        let files: string[];
        try {
          files = await backend.chooseTorrents();
        } catch (error) {
          set({ notice: BackendError.from(error).message });
          return;
        }
        const { adding } = get();
        if (!adding.open || adding.session !== session || adding.busy || files.length === 0) return;
        const text = [adding.text.trimEnd(), ...files].filter((part) => part !== "").join("\n");
        set({ adding: { ...adding, text, error: null } });
      },

      settleFresh: (id) => {
        set({ fresh: get().fresh.filter((item) => item !== id) });
      },

      minimizeWindow: () => {
        void act(() => backend.windowControls?.minimize() ?? Promise.resolve());
      },

      toggleMaximizeWindow: () => {
        void act(() => backend.windowControls?.toggleMaximize() ?? Promise.resolve());
      },

      closeWindow: () => {
        void act(() => backend.windowControls?.close() ?? Promise.resolve());
      },

      startResize: (edge) => {
        void act(() => backend.windowControls?.startResize(edge) ?? Promise.resolve());
      },

      answerCapture: (id, answer) => {
        set({ captures: get().captures.filter((capture) => capture.id !== id) });
        return act(async () => {
          await backend.answerCapture(id, answer);
          await get().reload();
        });
      },
    };
  });
}

export function isView(value: string): value is View {
  return VIEWS.some((v) => v.id === value) || isCategory(value);
}

export function queryOf(search: string): string {
  return search.trim().replace(/\s+/gu, " ");
}

export function sameView(a: Pick<SavedView, "view" | "query">, b: Pick<SavedView, "view" | "query">): boolean {
  return a.view === b.view && a.query === b.query;
}

export function savedViewOf(state: Pick<DownloadsState, "settings" | "view" | "search" | "page">): SavedView | null {
  if (state.page !== "downloads") return null;
  return state.settings?.savedViews.find((saved) => sameView(saved, { view: state.view, query: queryOf(state.search) })) ?? null;
}

export function inView(view: View, item: Download): boolean {
  const states = VIEWS.find((v) => v.id === view)?.states;
  return states === undefined ? item.category === view : states.includes(item.state);
}

export function visibleItems(state: Pick<DownloadsState, "items" | "view" | "matches" | "settings" | "live">): Download[] {
  const found = state.matches === null ? null : new Set(state.matches);
  const shown = state.items.filter((item) => inView(state.view, item) && (found === null || found.has(item.id)));
  return sortItems(shown, sortOf(state.settings), state.live, queueRanks(state.items));
}

export function countFor(items: readonly Download[], view: View): number {
  return items.filter((item) => inView(view, item)).length;
}

export function modalOpen(state: Pick<DownloadsState, "adding" | "overlay" | "captures" | "removing" | "menu">): boolean {
  return state.adding.open || state.overlay !== null || state.captures.length > 0 || state.removing !== null || state.menu !== null;
}

// Before it starts it takes a name; after it finishes its file does. A torrent's
// name is its own.
export function canRename(download: Pick<Download, "url" | "file" | "state">): boolean {
  if (download.url.startsWith("magnet:")) return false;
  return download.state === "done" ? download.file !== null : download.file === null && download.state !== "downloading";
}

// The download that the details and the commands for one act on: the selected
// row, or of several marked, the only one that the view still shows.
export function single(state: Pick<DownloadsState, "items" | "view" | "matches" | "settings" | "live" | "marked" | "selected">): Download | undefined {
  if (state.marked.length > 1) {
    const list = chosen(state);
    return list.length === 1 ? list[0] : undefined;
  }
  return state.items.find((item) => item.id === state.selected);
}

function shownId(state: Parameters<typeof single>[0]): number | null {
  return state.marked.length > 1 ? (single(state)?.id ?? null) : state.selected;
}

// The marked downloads that the view shows, in its order.
export function chosen(state: Pick<DownloadsState, "items" | "view" | "matches" | "settings" | "live" | "marked">): Download[] {
  return chosenOf(state, state.marked);
}

function chosenOf(state: Pick<DownloadsState, "items" | "view" | "matches" | "settings" | "live">, ids: readonly number[]): Download[] {
  const wanted = new Set(ids);
  return visibleItems(state).filter((item) => wanted.has(item.id));
}
