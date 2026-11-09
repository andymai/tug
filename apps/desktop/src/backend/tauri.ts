import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  type Backend,
  BackendError,
  type CaptureAnswer,
  type ColorScheme,
  type Download,
  type DownloadEvent,
  type ProgressBatch,
  type Settings,
} from "./backend";

export const PROGRESS_EVENT = "progress";
export const COLOR_SCHEME_EVENT = "color-scheme";
export const NOTICE_EVENT = "notice";
export const CAPTURES_EVENT = "captures";
export const FOCUS_EVENT = "focus-download";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw BackendError.from(error);
  }
}

export const tauriBackend: Backend = {
  list: () => call<Download[]>("list_downloads"),
  add: (url, dir) => call<Download>("add_download", { url, dir: dir ?? null }),
  pause: (id) => call("pause_download", { id }),
  resume: (id) => call("resume_download", { id }),
  remove: (id, deleteFile) => call("remove_download", { id, deleteFile }),
  openFile: (id) => call("open_file", { id }),
  showInFolder: (id) => call("show_in_folder", { id }),
  events: (id) => call<DownloadEvent[]>("download_events", { id }),
  settings: () => call<Settings>("get_settings"),
  updateSettings: (settings) => call("update_settings", { settings }),
  chooseDownloadFolder: () => call<Settings | null>("choose_download_folder"),
  systemColorScheme: () => call<ColorScheme | null>("system_color_scheme"),
  onColorScheme: (listener) =>
    listen<ColorScheme | null>(COLOR_SCHEME_EVENT, (event) => {
      listener(event.payload);
    }),
  onNotice: (listener) =>
    listen<string>(NOTICE_EVENT, (event) => {
      listener(event.payload);
    }),
  onProgress: (listener) =>
    listen<ProgressBatch>(PROGRESS_EVENT, (event) => {
      listener(event.payload);
    }),
  pendingCaptures: () => call<Download[]>("pending_captures"),
  answerCapture: (id, answer: CaptureAnswer) => call("answer_capture", { id, answer }),
  onCaptures: (listener) =>
    listen<Download[]>(CAPTURES_EVENT, (event) => {
      listener(event.payload);
    }),
  onFocusDownload: (listener) =>
    listen<number>(FOCUS_EVENT, (event) => {
      listener(event.payload);
    }),
  windowControls: {
    minimize: () => getCurrentWindow().minimize(),
    toggleMaximize: () => getCurrentWindow().toggleMaximize(),
    close: () => getCurrentWindow().close(),
    startResize: (edge) => getCurrentWindow().startResizeDragging(edge),
    isMaximized: () => getCurrentWindow().isMaximized(),
    onMaximized: (listener) => {
      const window = getCurrentWindow();
      return window.onResized(() => {
        void window.isMaximized().then(listener, () => undefined);
      });
    },
  },
};
