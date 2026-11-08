import { isTauri } from "@tauri-apps/api/core";

import type { Backend } from "./backend";
import { createMockBackend } from "./mock";
import { tauriBackend } from "./tauri";

export * from "./backend";

const EXAMPLES = [
  "https://download.example.org/fedora-kde-44-x86_64.iso",
  "https://mirror.example.org/blender/blender-5.1-linux-x64.tar.xz",
  "https://media.example.org/talks/conference-talk-1080p.mp4",
] as const;

export const backend: Backend = isTauri() ? tauriBackend : createMockBackend({ autoTick: true, seed: EXAMPLES });
