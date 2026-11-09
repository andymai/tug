import { nameOf, SCHEMES } from "../lib/links";
import { siteOf } from "../lib/sites";
import {
  type Backend,
  BackendError,
  type Download,
  type ColorScheme,
  type DownloadEvent,
  type DownloadState,
  type ProgressBatch,
  type ProgressUpdate,
  type Settings,
} from "./backend";

const MB = 1 << 20;
const TICK_MS = 100;
const RATE = 18.4 * MB;

export interface MockBackend extends Backend {
  tick(): void;
  capture(url: string): Promise<void>;
  focus(id: number): void;
  windowCalls: string[];
  setMaximized(maximized: boolean): void;
  placed: string[];
  setColorScheme(scheme: ColorScheme | null): void;
  notice(message: string): void;
  dispose(): void;
}

export interface SeedDownload {
  url: string;
  state?: DownloadState;
  progress?: number;
  size?: number;
  dir?: string;
  error?: string;
}

export interface MockOptions {
  autoTick?: boolean;
  seed?: readonly (string | SeedDownload)[];
  now?: () => number;
  folder?: string;
  colorScheme?: ColorScheme | null;
  captures?: readonly string[];
}

function attempt<T>(action: () => T): Promise<T> {
  try {
    return Promise.resolve(action());
  } catch (error) {
    return Promise.reject(BackendError.from(error));
  }
}

function sizeOf(url: URL): number {
  let hash = 0;
  for (const char of url.href) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (16 + (hash % 240)) * MB;
}

export function createMockBackend(options: MockOptions = {}): MockBackend {
  const now = options.now ?? (() => Date.now());
  const downloads = new Map<number, Download>();
  const history = new Map<number, DownloadEvent[]>();
  const log = (id: number, kind: DownloadEvent["kind"], atMs: number, bytes: number | null = null, detail: string | null = null) => {
    history.set(id, [...(history.get(id) ?? []), { kind, atMs, bytes, detail }]);
  };
  const listeners = new Set<(batch: ProgressBatch) => void>();
  let settings: Settings = { downloadDir: "/home/you/Downloads", connections: 8, speedLimit: null, appearance: "system", excludedSites: [], confirmCaptures: true, maxActive: 3 };
  let scheme = options.colorScheme ?? null;
  const schemeListeners = new Set<(scheme: ColorScheme | null) => void>();
  const noticeListeners = new Set<(message: string) => void>();
  const captureListeners = new Set<(captures: Download[]) => void>();
  const focusListeners = new Set<(id: number) => void>();
  const maximizedListeners = new Set<(maximized: boolean) => void>();
  const windowCalls: string[] = [];
  let maximized = false;
  const setMaximized = (next: boolean) => {
    maximized = next;
    for (const listener of maximizedListeners) listener(next);
  };
  const placed: string[] = [];
  let waiting: number[] = [];
  let nextId = 1;
  let seq = 0;

  const find = (id: number): Download => {
    const download = downloads.get(id);
    if (!download) throw new BackendError("notFound", `there is no download ${String(id)}`);
    return download;
  };

  const addNow = (link: string, dir?: string): Download => {
    let url: URL;
    try {
      url = new URL(link.trim());
    } catch {
      throw new BackendError("invalid", `${link} is not a link`);
    }
    if (!SCHEMES.has(url.protocol)) {
      throw new BackendError("invalid", `Tug can't download ${url.protocol.slice(0, -1)} links`);
    }
    const download: Download = {
      id: nextId++,
      url: url.href,
      name: nameOf(url),
      dir: dir ?? settings.downloadDir,
      file: null,
      state: "downloading",
      size: sizeOf(url),
      received: 0,
      error: null,
      addedMs: now(),
      finishedMs: null,
    };
    downloads.set(download.id, download);
    log(download.id, "added", download.addedMs);
    log(download.id, "started", download.addedMs);
    return download;
  };

  const tick = () => {
    const perTick = Math.floor((settings.speedLimit ?? RATE) / (1000 / TICK_MS));
    const updates: ProgressUpdate[] = [];
    const settled: number[] = [];
    for (const download of downloads.values()) {
      if (download.state !== "downloading" || download.size === null) continue;
      const step = Math.min(perTick, download.size - download.received);
      download.received += step;
      download.file ??= `${download.dir}/${download.name}`;
      const speed = step * (1000 / TICK_MS);
      if (download.received >= download.size) {
        download.state = "done";
        download.finishedMs = now();
        log(download.id, "finished", download.finishedMs, download.size);
        settled.push(download.id);
      } else {
        updates.push({
          id: download.id,
          phase: "downloading",
          received: download.received,
          total: download.size,
          speed,
          leftMs: speed > 0 ? Math.ceil(((download.size - download.received) / speed) * 1000) : null,
          connections: settings.connections,
        });
      }
    }
    const batch: ProgressBatch = { seq: ++seq, updates, settled, error: null };
    for (const listener of listeners) listener(batch);
  };

  (options.seed ?? []).forEach((entry, index) => {
    const spec = typeof entry === "string" ? { url: entry } : entry;
    const download = addNow(spec.url, spec.dir);
    const size = Math.round(spec.size ?? download.size ?? 0);
    const state = spec.state ?? "downloading";
    download.size = size;
    download.state = state;
    download.addedMs -= (index + 1) * 60_000;
    download.received = state === "done" ? size : Math.min(size, Math.ceil(size * (spec.progress ?? 0)));
    if (download.received > 0) download.file = `${download.dir}/${download.name}`;
    if (state === "done") download.finishedMs = download.addedMs + 30_000;
    if (state === "failed") download.error = spec.error ?? "the server closed the connection";
    const start = download.addedMs;
    history.set(download.id, []);
    log(download.id, "added", start);
    if (state === "queued") return;
    log(download.id, "started", start);
    if (state === "paused") log(download.id, "paused", start + 20_000, download.received);
    if (state === "done") log(download.id, "finished", start + 30_000, size);
    if (state === "failed") log(download.id, "failed", start + 20_000, download.received, download.error);
  });
  const pending = () =>
    waiting.flatMap((id) => {
      const download = downloads.get(id);
      return download?.state === "paused" ? [{ ...download }] : [];
    });
  const announce = () => {
    const captures = pending();
    for (const listener of captureListeners) listener(captures);
  };
  const ask = (url: string) => {
    const download = addNow(url);
    download.state = "paused";
    history.set(download.id, []);
    log(download.id, "added", download.addedMs);
    waiting.push(download.id);
  };
  for (const url of options.captures ?? []) ask(url);
  const timer = options.autoTick ? setInterval(tick, TICK_MS) : undefined;

  return {
    list: () => Promise.resolve([...downloads.values()].map((d) => ({ ...d }))),
    add: (url, dir) => attempt(() => ({ ...addNow(url, dir) })),
    pause: (id) =>
      attempt(() => {
        const download = find(id);
        if (download.state === "downloading" || download.state === "queued") {
          download.state = "paused";
          log(id, "paused", now(), download.received);
        }
      }),
    resume: (id) =>
      attempt(() => {
        const download = find(id);
        if (waiting.includes(id)) {
          waiting = waiting.filter((entry) => entry !== id);
          announce();
        }
        if (download.state === "paused" || download.state === "failed") {
          download.state = "downloading";
          download.error = null;
          if (download.received > 0) log(id, "resumed", now(), download.received);
          else log(id, "started", now());
        }
      }),
    remove: (id) =>
      attempt(() => {
        find(id);
        downloads.delete(id);
        history.delete(id);
      }),
    openFile: (id) =>
      attempt(() => {
        const download = find(id);
        if (download.state !== "done") throw new BackendError("invalid", `${download.name} isn't finished yet`);
      }),
    events: (id) =>
      attempt(() => {
        find(id);
        return (history.get(id) ?? []).map((event) => ({ ...event }));
      }),
    showInFolder: (id) =>
      attempt(() => {
        find(id);
      }),
    settings: () => Promise.resolve({ ...settings }),
    updateSettings: (next) =>
      attempt(() => {
        if (next.connections < 1 || next.connections > 32) {
          throw new BackendError("invalid", `connections must be between 1 and 32, not ${String(next.connections)}`);
        }
        if (next.speedLimit === 0) throw new BackendError("invalid", "a speed limit must be above zero");
        if (next.maxActive < 1 || next.maxActive > 16) {
          throw new BackendError("invalid", `downloads at once must be between 1 and 16, not ${String(next.maxActive)}`);
        }
        for (const [at, site] of next.excludedSites.entries()) {
          if (siteOf(site) !== site) throw new BackendError("invalid", `${JSON.stringify(site)} isn't a site, like example.org`);
          if (next.excludedSites.indexOf(site) !== at) throw new BackendError("invalid", `${site} is in the list twice`);
        }
        settings = { ...next };
      }),
    chooseDownloadFolder: () =>
      attempt(() => {
        settings = { ...settings, downloadDir: options.folder ?? "/home/you/Media/Downloads" };
        return { ...settings };
      }),
    systemColorScheme: () => Promise.resolve(scheme),
    onColorScheme: (listener) => {
      schemeListeners.add(listener);
      return Promise.resolve(() => {
        schemeListeners.delete(listener);
      });
    },
    onNotice: (listener) => {
      noticeListeners.add(listener);
      return Promise.resolve(() => {
        noticeListeners.delete(listener);
      });
    },
    notice: (message) => {
      for (const listener of noticeListeners) listener(message);
    },
    setColorScheme: (next) => {
      scheme = next;
      for (const listener of schemeListeners) listener(next);
    },
    onProgress: (listener) => {
      listeners.add(listener);
      return Promise.resolve(() => {
        listeners.delete(listener);
      });
    },
    pendingCaptures: () => Promise.resolve(pending()),
    answerCapture: (id, answer) =>
      attempt(() => {
        const download = find(id);
        waiting = waiting.filter((entry) => entry !== id);
        if (answer === "download") {
          download.state = "downloading";
          log(id, "started", now());
        } else if (answer === "cancel") {
          downloads.delete(id);
          history.delete(id);
        }
        announce();
      }),
    onCaptures: (listener) => {
      captureListeners.add(listener);
      return Promise.resolve(() => {
        captureListeners.delete(listener);
      });
    },
    onFocusDownload: (listener) => {
      focusListeners.add(listener);
      return Promise.resolve(() => {
        focusListeners.delete(listener);
      });
    },
    windowControls: {
      minimize: () => {
        windowCalls.push("minimize");
        return Promise.resolve();
      },
      toggleMaximize: () => {
        windowCalls.push("toggleMaximize");
        setMaximized(!maximized);
        return Promise.resolve();
      },
      close: () => {
        windowCalls.push("close");
        return Promise.resolve();
      },
      startResize: (edge) => {
        windowCalls.push(`resize ${edge}`);
        return Promise.resolve();
      },
      isMaximized: () => Promise.resolve(maximized),
      onMaximized: (listener) => {
        maximizedListeners.add(listener);
        return Promise.resolve(() => {
          maximizedListeners.delete(listener);
        });
      },
    },
    windowCalls,
    setMaximized,
    placed,
    place: (id, where) =>
      attempt(() => {
        find(id);
        placed.push(`${String(id)} ${where}`);
      }),
    focus: (id) => {
      for (const listener of focusListeners) listener(id);
    },
    capture: (url) =>
      attempt(() => {
        if (!settings.confirmCaptures) {
          addNow(url);
          return;
        }
        ask(url);
        announce();
      }),
    tick,
    dispose: () => {
      if (timer !== undefined) clearInterval(timer);
      listeners.clear();
      schemeListeners.clear();
      noticeListeners.clear();
      captureListeners.clear();
      focusListeners.clear();
      maximizedListeners.clear();
    },
  };
}
