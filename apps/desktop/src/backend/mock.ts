import { nameOf, SCHEMES } from "../lib/links";
import { openAt } from "../lib/schedule";
import { siteOf } from "../lib/sites";
import {
  type Backend,
  BackendError,
  type Category,
  type Download,
  type ColorScheme,
  type DownloadEvent,
  type DownloadState,
  type Place,
  type ProgressBatch,
  type ProgressUpdate,
  type Settings,
} from "./backend";

const MB = 1 << 20;
const GB = 1 << 30;
const TICK_MS = 100;
const RATE = 18.4 * MB;

export interface MockBackend extends Backend {
  tick(): void;
  capture(url: string): Promise<void>;
  focus(id: number): void;
  windowCalls: string[];
  setMaximized(maximized: boolean): void;
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
  diskFree?: number | null;
}

function attempt<T>(action: () => T): Promise<T> {
  try {
    return Promise.resolve(action());
  } catch (error) {
    return Promise.reject(BackendError.from(error));
  }
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

// The same lists as tug_core::Category; a test reads category.rs to keep them equal.
export const EXTENSIONS: readonly [Category, readonly string[]][] = [
  ["video", ["3gp", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "ogv", "webm", "wmv"]],
  ["audio", ["aac", "aiff", "alac", "ape", "flac", "m4a", "mka", "mp3", "oga", "ogg", "opus", "wav", "wma"]],
  ["image", ["avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "jxl", "png", "psd", "svg", "tif", "tiff", "webp", "xcf"]],
  ["document", ["azw3", "csv", "djvu", "doc", "docx", "epub", "md", "mobi", "odp", "ods", "odt", "pdf", "ppt", "pptx", "rtf", "txt", "xls", "xlsx"]],
  ["archive", ["7z", "bz2", "cab", "gz", "lz", "lz4", "lzma", "rar", "tar", "tbz2", "tgz", "txz", "tzst", "xz", "zip", "zst"]],
  ["program", ["apk", "appimage", "deb", "exe", "flatpak", "flatpakref", "jar", "msi", "rpm", "run", "sh", "snap"]],
  ["disk", ["dmg", "img", "iso", "qcow2", "vdi", "vhd", "vhdx", "vmdk"]],
];

export function categoryOf(name: string): Category {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "other";
  const extension = name.slice(dot + 1).toLowerCase();
  return EXTENSIONS.find(([, extensions]) => extensions.includes(extension))?.[0] ?? "other";
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
  let settings: Settings = { downloadDir: "/home/you/Downloads", connections: 8, speedLimit: null, appearance: "system", excludedSites: [], confirmCaptures: true, maxActive: 3, schedule: null, slowHours: null, savedViews: [], columns: [], sort: null };
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
  let waiting: number[] = [];
  let nextId = 1;
  let seq = 0;
  let revision = 0;

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
      category: categoryOf(nameOf(url)),
      dir: dir ?? settings.downloadDir,
      file: null,
      state: "queued",
      size: sizeOf(url),
      received: 0,
      error: null,
      addedMs: now(),
      finishedMs: null,
      position: Math.max(0, ...[...downloads.values()].map((d) => d.position)) + 1,
    };
    downloads.set(download.id, download);
    log(download.id, "added", download.addedMs);
    return download;
  };

  const queue = () =>
    [...downloads.values()].filter((d) => d.state === "queued").sort((a, b) => a.position - b.position);

  // Like Tug, a place that frees up goes to the next queued download; the seed keeps its states.
  const fill = () => {
    if (settings.schedule !== null && !openAt(settings.schedule, new Date(now()))) return;
    let running = [...downloads.values()].filter((d) => d.state === "downloading").length;
    for (const download of queue()) {
      if (running >= settings.maxActive) return;
      download.state = "downloading";
      if (download.received > 0) log(download.id, "resumed", now(), download.received);
      else log(download.id, "started", now());
      running += 1;
    }
  };

  const place = (id: number, where: Place) => {
    const waiting = queue();
    const at = waiting.findIndex((d) => d.id === id);
    if (at < 0) return;
    const mine = waiting[at];
    if (mine === undefined) return;
    const positions = [...downloads.values()].map((d) => d.position);
    if (where === "first") mine.position = Math.min(...positions) - 1;
    else if (where === "last") mine.position = Math.max(...positions) + 1;
    else {
      const other = waiting[where === "up" ? at - 1 : at + 1];
      if (other === undefined) return;
      [mine.position, other.position] = [other.position, mine.position];
    }
  };

  const limitNow = () => {
    const slow = settings.slowHours;
    if (slow === null || !openAt(slow.hours, new Date(now()))) return settings.speedLimit;
    return Math.min(slow.limit, settings.speedLimit ?? slow.limit);
  };

  // Only a schedule moves downloads on a tick, so without one the seeded states stay for the screenshots.
  const keepHours = () => {
    if (settings.schedule === null) return 0;
    if (openAt(settings.schedule, new Date(now()))) {
      fill();
      return 0;
    }
    let stopped = 0;
    for (const download of downloads.values()) {
      if (download.state !== "downloading") continue;
      download.state = "queued";
      log(download.id, "paused", now(), download.received);
      stopped += 1;
    }
    return stopped;
  };

  const tick = () => {
    revision += keepHours();
    const perTick = Math.floor((limitNow() ?? RATE) / (1000 / TICK_MS));
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
    if (settled.length > 0) fill();
    revision += settled.length;
    const batch: ProgressBatch = { seq: ++seq, updates, settled, revision, error: null };
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
    diskFree: () => Promise.resolve(options.diskFree === undefined ? 412 * GB : options.diskFree),
    search: (query) => {
      const asked = words(query);
      if (asked.length === 0) return Promise.resolve([]);
      const found = [...downloads.values()].filter((d) => {
        const own = [...words(d.name), ...words(d.url)];
        return asked.every((word) => own.some((w) => w.startsWith(word)));
      });
      return Promise.resolve(found.map((d) => d.id));
    },
    add: (url, dir) =>
      attempt(() => {
        const download = addNow(url, dir);
        fill();
        return { ...download };
      }),
    pause: (id) =>
      attempt(() => {
        const download = find(id);
        if (download.state === "downloading" || download.state === "queued") {
          download.state = "paused";
          log(id, "paused", now(), download.received);
          fill();
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
          download.state = "queued";
          download.error = null;
          fill();
        }
      }),
    remove: (id) =>
      attempt(() => {
        find(id);
        downloads.delete(id);
        history.delete(id);
        fill();
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
        if (next.slowHours !== null && next.slowHours.limit <= 0) throw new BackendError("invalid", "a speed limit must be above zero");
        for (const hours of [next.schedule, next.slowHours?.hours ?? null]) {
          if (hours === null) continue;
          const { days, start, stop } = hours;
          if (days < 1 || days > 0b111_1111) throw new BackendError("invalid", "a schedule needs at least one day");
          if (start >= 1440 || stop >= 1440) throw new BackendError("invalid", `${String(Math.max(start, stop))} minutes is past the end of a day`);
          if (start === stop) throw new BackendError("invalid", "a schedule must start and stop at different times");
        }
        if (next.savedViews.length > 50) throw new BackendError("invalid", "Tug keeps at most 50 saved views");
        for (const [at, saved] of next.savedViews.entries()) {
          const plain = (text: string) => text.trim() !== "" && !/\p{Cc}/u.test(text);
          if (!plain(saved.name) || !plain(saved.query) || !/^[a-z]+$/.test(saved.view) || Array.from(saved.name).length > 60) {
            throw new BackendError("invalid", `${JSON.stringify(saved.name)} can't be a saved view`);
          }
          if (next.savedViews.slice(0, at).some((other) => other.view === saved.view && other.query === saved.query)) {
            throw new BackendError("invalid", `${JSON.stringify(saved.name)} is saved twice`);
          }
        }
        for (const [at, site] of next.excludedSites.entries()) {
          if (siteOf(site) !== site) throw new BackendError("invalid", `${JSON.stringify(site)} isn't a site, like example.org`);
          if (next.excludedSites.indexOf(site) !== at) throw new BackendError("invalid", `${site} is in the list twice`);
        }
        settings = { ...next };
        fill();
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
          download.state = "queued";
          fill();
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
    place: (id, where) =>
      attempt(() => {
        find(id);
        place(id, where);
      }),
    focus: (id) => {
      for (const listener of focusListeners) listener(id);
    },
    capture: (url) =>
      attempt(() => {
        revision += 1;
        if (!settings.confirmCaptures) {
          addNow(url);
          fill();
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
