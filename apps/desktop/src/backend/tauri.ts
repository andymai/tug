import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { type Backend, BackendError, type Download, type ProgressBatch, type Settings } from "./backend";

export const PROGRESS_EVENT = "progress";

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
  settings: () => call<Settings>("get_settings"),
  updateSettings: (settings) => call("update_settings", { settings }),
  onProgress: (listener) =>
    listen<ProgressBatch>(PROGRESS_EVENT, (event) => {
      listener(event.payload);
    }),
};
