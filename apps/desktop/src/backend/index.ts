import { isTauri } from "@tauri-apps/api/core";

import type { Backend } from "./backend";
import { createMockBackend } from "./mock";
import { SHOWCASE } from "./showcase";
import { tauriBackend } from "./tauri";

export * from "./backend";

export const backend: Backend = isTauri() ? tauriBackend : createMockBackend({ autoTick: true, seed: SHOWCASE });
