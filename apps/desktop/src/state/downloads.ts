import { createStore } from "zustand/vanilla";

import { type Backend, BackendError, type Download, type DownloadState, type ProgressBatch, type ProgressUpdate } from "../backend/backend";

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
  error: string | null;
  init: () => Promise<() => void>;
  reload: () => Promise<void>;
  applyBatch: (batch: ProgressBatch) => void;
  setView: (view: View) => void;
  select: (id: number | null) => void;
  retry: (id: number) => Promise<void>;
}

export type DownloadsStore = ReturnType<typeof createDownloadsStore>;

export function createDownloadsStore(backend: Backend) {
  return createStore<DownloadsState>()((set, get) => ({
    items: [],
    live: {},
    view: "all",
    selected: null,
    status: "loading",
    error: null,

    init: async () => {
      let stop: () => void = () => undefined;
      let failure: string | null = null;
      try {
        stop = await backend.onProgress((batch) => {
          get().applyBatch(batch);
        });
      } catch (error) {
        failure = BackendError.from(error).message;
      }
      await get().reload();
      if (failure !== null) set({ error: failure });
      return stop;
    },

    reload: async () => {
      try {
        const items = await backend.list();
        set({ items, status: "ready", error: null });
      } catch (error) {
        set({ status: "error", error: BackendError.from(error).message });
      }
    },

    applyBatch: (batch) => {
      const live = Object.fromEntries(batch.updates.map((update) => [update.id, update]));
      set(batch.error === null ? { live } : { live, error: batch.error });
      const known = new Set(get().items.map((item) => item.id));
      if (batch.settled.length > 0 || batch.updates.some((update) => !known.has(update.id))) {
        void get().reload();
      }
    },

    setView: (view) => {
      set({ view, selected: null });
    },

    select: (id) => {
      set({ selected: id });
    },

    retry: async (id) => {
      try {
        await backend.resume(id);
        await get().reload();
      } catch (error) {
        set({ error: BackendError.from(error).message });
      }
    },
  }));
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
