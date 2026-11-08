import {
  type Backend,
  BackendError,
  type Download,
  type DownloadState,
  type ProgressBatch,
  type ProgressUpdate,
  type Settings,
} from "./backend";

const MB = 1 << 20;
const TICK_MS = 100;
const RATE = 18.4 * MB;
const SCHEMES = new Set(["http:", "https:", "ftp:", "ftps:"]);

export interface MockBackend extends Backend {
  tick(): void;
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
}

function attempt<T>(action: () => T): Promise<T> {
  try {
    return Promise.resolve(action());
  } catch (error) {
    return Promise.reject(BackendError.from(error));
  }
}

function nameOf(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).at(-1);
  return segment ? decodeURIComponent(segment) : url.hostname;
}

function sizeOf(url: URL): number {
  let hash = 0;
  for (const char of url.href) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (16 + (hash % 240)) * MB;
}

export function createMockBackend(options: MockOptions = {}): MockBackend {
  const now = options.now ?? (() => Date.now());
  const downloads = new Map<number, Download>();
  const listeners = new Set<(batch: ProgressBatch) => void>();
  let settings: Settings = { downloadDir: "/home/you/Downloads", connections: 8, speedLimit: null };
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
  });
  const timer = options.autoTick ? setInterval(tick, TICK_MS) : undefined;

  return {
    list: () => Promise.resolve([...downloads.values()].map((d) => ({ ...d }))),
    add: (url, dir) => attempt(() => ({ ...addNow(url, dir) })),
    pause: (id) =>
      attempt(() => {
        const download = find(id);
        if (download.state === "downloading") download.state = "paused";
      }),
    resume: (id) =>
      attempt(() => {
        const download = find(id);
        if (download.state === "paused" || download.state === "failed") {
          download.state = "downloading";
          download.error = null;
        }
      }),
    remove: (id) =>
      attempt(() => {
        find(id);
        downloads.delete(id);
      }),
    settings: () => Promise.resolve({ ...settings }),
    updateSettings: (next) =>
      attempt(() => {
        if (next.connections < 1 || next.connections > 32) {
          throw new BackendError("invalid", `connections must be between 1 and 32, not ${String(next.connections)}`);
        }
        if (next.speedLimit === 0) throw new BackendError("invalid", "a speed limit must be above zero");
        settings = { ...next };
      }),
    onProgress: (listener) => {
      listeners.add(listener);
      return Promise.resolve(() => {
        listeners.delete(listener);
      });
    },
    tick,
    dispose: () => {
      if (timer !== undefined) clearInterval(timer);
      listeners.clear();
    },
  };
}
