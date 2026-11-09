import { createStore } from "zustand/vanilla";

import {
  type Backend,
  BackendError,
  type CaptureAnswer,
  type ColorScheme,
  type Download,
  type DownloadEvent,
  type DownloadState,
  type ProgressBatch,
  type ProgressUpdate,
  type ResizeEdge,
  type Settings,
} from "../backend/backend";

export type View = "all" | "active" | "done" | "failed";

export const VIEWS: readonly { id: View; label: string; states: readonly DownloadState[] }[] = [
  { id: "all", label: "All", states: ["queued", "downloading", "paused", "done", "failed"] },
  { id: "active", label: "Active", states: ["queued", "downloading", "paused"] },
  { id: "done", label: "Done", states: ["done"] },
  { id: "failed", label: "Failed", states: ["failed"] },
];

export interface DownloadsState {
  items: Download[];
  live: Record<number, ProgressUpdate>;
  view: View;
  selected: number | null;
  status: "loading" | "ready" | "error";
  loadError: string | null;
  notice: string | null;
  settings: Settings | null;
  systemScheme: ColorScheme | null;
  settingsError: string | null;
  page: Page;
  adding: Adding;
  fresh: number[];
  history: { id: number; events: DownloadEvent[] } | null;
  overlay: Overlay;
  focusRequest: number | null;
  captures: Download[];
  framed: boolean;
  maximized: boolean;
  init: () => Promise<() => void>;
  reload: () => Promise<void>;
  applyBatch: (batch: ProgressBatch) => void;
  setView: (view: View) => void;
  setPage: (page: Page) => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  chooseFolder: () => Promise<void>;
  select: (id: number | null) => void;
  step: (delta: number) => number | null;
  setOverlay: (overlay: Overlay) => void;
  requestFocus: (id: number | null) => void;
  pause: (id: number) => Promise<void>;
  resume: (id: number) => Promise<void>;
  startNext: (id: number) => Promise<void>;
  openFile: (id: number) => Promise<void>;
  showInFolder: (id: number) => Promise<void>;
  loadHistory: (id: number) => Promise<void>;
  notify: (message: string) => void;
  dismissNotice: () => void;
  openAdd: (text?: string) => void;
  setAddText: (text: string) => void;
  closeAdd: () => void;
  addLinks: (hrefs: readonly string[]) => Promise<void>;
  settleFresh: (id: number) => void;
  answerCapture: (id: number, answer: CaptureAnswer) => Promise<void>;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  startResize: (edge: ResizeEdge) => void;
}

export type Overlay = "commands" | "shortcuts" | null;

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
    let historyRequest = 0;

    const act = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        set({ notice: BackendError.from(error).message });
      }
    };

    let confirmed: Settings | null = null;
    let pending: { id: number; patch: Partial<Settings> }[] = [];
    let patches = 0;
    let chooserFailed = false;
    let saving: Promise<void> = Promise.resolve();
    const queue = (task: () => Promise<void>) => {
      saving = saving.then(task);
      return saving;
    };
    const showSettings = () => {
      if (confirmed === null) return;
      set({ settings: pending.reduce<Settings>((settings, { patch }) => ({ ...settings, ...patch }), confirmed) });
    };

    const loadSettings = async () => {
      try {
        confirmed = await backend.settings();
        set({ settings: confirmed });
      } catch (error) {
        set({ notice: BackendError.from(error).message });
      }
    };

    return {
      items: [],
      live: {},
      view: "all",
      selected: null,
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
      overlay: null,
      focusRequest: null,
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
                if (!inView(state.view, item)) state.setView("all");
                else state.setPage("downloads");
                state.select(id);
                state.requestFocus(id);
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
        } catch (error) {
          set({ status: "error", loadError: BackendError.from(error).message });
        }
      },

      applyBatch: (batch) => {
        const live = Object.fromEntries(batch.updates.map((update) => [update.id, update]));
        set(batch.error === null ? { live } : { live, notice: batch.error });
        const states = new Map(get().items.map((item) => [item.id, item.state]));
        if (batch.settled.length > 0 || batch.updates.some((update) => states.get(update.id) !== "downloading")) {
          void get().reload();
        }
      },

      setView: (view) => {
        set({ view, selected: null, page: "downloads" });
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
        return queue(async () => {
          if (confirmed === null) return;
          const next = { ...confirmed, ...patch };
          try {
            await backend.updateSettings(next);
            confirmed = next;
          } catch (error) {
            set({ settingsError: BackendError.from(error).message });
          } finally {
            pending = pending.filter((entry) => entry.id !== id);
            showSettings();
          }
        });
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
        set({ selected: id });
      },

      step: (delta) => {
        const visible = visibleItems(get());
        if (visible.length === 0) return null;
        const at = visible.findIndex((item) => item.id === get().selected);
        const next =
          at === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, at + delta));
        const id = visible[next]?.id ?? null;
        set({ selected: id });
        return id;
      },

      setOverlay: (overlay) => {
        set({ overlay });
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

      loadHistory: (id) =>
        act(async () => {
          const request = ++historyRequest;
          const events = await backend.events(id);
          if (request === historyRequest && get().selected === id) set({ history: { id, events } });
        }),

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

      addLinks: async (hrefs) => {
        const { session } = get().adding;
        const ours = () => get().adding.open && get().adding.session === session;
        set({ adding: { ...get().adding, busy: true, error: null } });
        const added: number[] = [];
        const failed: { href: string; message: string }[] = [];
        for (const href of hrefs) {
          try {
            added.push((await backend.add(href)).id);
          } catch (error) {
            failed.push({ href, message: BackendError.from(error).message });
          }
        }
        const [first] = failed;
        const reason =
          first === undefined
            ? null
            : failed.length === 1
              ? `couldn't add ${first.href}: ${first.message}`
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
          view: view === "done" || view === "failed" ? "all" : view,
          ...(reason === null ? {} : { notice: reason }),
        });
        await get().reload();
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

export function inView(view: View, item: Download): boolean {
  return VIEWS.find((v) => v.id === view)?.states.includes(item.state) ?? false;
}

export function visibleItems(state: Pick<DownloadsState, "items" | "view">): Download[] {
  return state.items.filter((item) => inView(state.view, item)).sort((a, b) => b.addedMs - a.addedMs || b.id - a.id);
}

export function countFor(items: readonly Download[], view: View): number {
  return items.filter((item) => inView(view, item)).length;
}

export function modalOpen(state: Pick<DownloadsState, "adding" | "overlay" | "captures">): boolean {
  return state.adding.open || state.overlay !== null || state.captures.length > 0;
}
