import { ArrowDown, Check, CircleAlert, Clock, type LucideIcon, Pause } from "lucide-react";

import type { DownloadState } from "../backend/backend";

export interface StateLook {
  word: string;
  Icon: LucideIcon;
  tone: string;
  colorWord: boolean;
}

export const STATES: Record<DownloadState, StateLook> = {
  downloading: { word: "Downloading", Icon: ArrowDown, tone: "text-accent", colorWord: false },
  queued: { word: "Queued", Icon: Clock, tone: "text-state-paused", colorWord: false },
  paused: { word: "Paused", Icon: Pause, tone: "text-state-paused", colorWord: false },
  done: { word: "Done", Icon: Check, tone: "text-state-done", colorWord: true },
  failed: { word: "Failed", Icon: CircleAlert, tone: "text-state-error", colorWord: true },
};

export const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
