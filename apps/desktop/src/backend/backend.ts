import type { AddOptions } from "./bindings/AddOptions";
import type { CaptureAnswer } from "./bindings/CaptureAnswer";
import type { CookiesChange } from "./bindings/CookiesChange";
import type { Headers } from "./bindings/Headers";
import type { ColorScheme } from "./bindings/ColorScheme";
import type { CommandError } from "./bindings/CommandError";
import type { ErrorKind } from "./bindings/ErrorKind";
import type { Download } from "./bindings/Download";
import type { DownloadEvent } from "./bindings/DownloadEvent";
import type { Inspection } from "./bindings/Inspection";
import type { Place } from "./bindings/Place";
import type { ProgressBatch } from "./bindings/ProgressBatch";
import type { Settings } from "./bindings/Settings";
import type { TorrentView } from "./bindings/TorrentView";

export type { AddOptions } from "./bindings/AddOptions";
export type { Appearance } from "./bindings/Appearance";
export type { CaptureAnswer } from "./bindings/CaptureAnswer";
export type { CookiesChange } from "./bindings/CookiesChange";
export type { Headers } from "./bindings/Headers";
export type { ColorScheme } from "./bindings/ColorScheme";
export type { CommandError } from "./bindings/CommandError";
export type { Download } from "./bindings/Download";
export type { DownloadEvent } from "./bindings/DownloadEvent";
export type { EventKind } from "./bindings/EventKind";
export type { Category } from "./bindings/Category";
export type { Connection } from "./bindings/Connection";
export type { ConnectionStatus } from "./bindings/ConnectionStatus";
export type { DownloadState } from "./bindings/DownloadState";
export type { ErrorKind } from "./bindings/ErrorKind";
export type { Inspection } from "./bindings/Inspection";
export type { LogLine } from "./bindings/LogLine";
export type { Phase } from "./bindings/Phase";
export type { Place } from "./bindings/Place";
export type { ProgressBatch } from "./bindings/ProgressBatch";
export type { ProgressUpdate } from "./bindings/ProgressUpdate";
export type { SavedView } from "./bindings/SavedView";
export type { Schedule } from "./bindings/Schedule";
export type { Segment } from "./bindings/Segment";
export type { Server } from "./bindings/Server";
export type { Settings } from "./bindings/Settings";
export type { TorrentFile } from "./bindings/TorrentFile";
export type { TorrentPeer } from "./bindings/TorrentPeer";
export type { TorrentView } from "./bindings/TorrentView";

export type ResizeEdge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startResize(edge: ResizeEdge): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximized(listener: (maximized: boolean) => void): Promise<() => void>;
}

export interface Backend {
  list(): Promise<Download[]>;
  search(query: string): Promise<number[]>;
  diskFree(): Promise<number | null>;
  add(url: string, dir?: string, options?: AddOptions): Promise<Download>;
  // A download's own connections and speed limit; null takes Tug's.
  setOptions(id: number, connections: number | null, speedLimit: number | null): Promise<Download>;
  // Before it starts it takes the name; after it finishes its file does.
  rename(id: number, name: string): Promise<Download>;
  // A torrent's files and peers; null until its .torrent is known.
  torrentView(id: number): Promise<TorrentView | null>;
  chooseFiles(id: number, files: number[]): Promise<TorrentView | null>;
  // The browser's referrer and User-Agent, and whether cookies go along; never the cookies.
  headers(id: number): Promise<Headers>;
  setHeaders(id: number, referrer: string | null, cookies: CookiesChange, userAgent: string | null): Promise<Headers>;
  // A folder for the downloads being added, which leaves Tug's own folder alone.
  chooseFolder(from?: string): Promise<string | null>;
  // file: links to the chosen .torrent files, which add takes; none when cancelled.
  chooseTorrents(): Promise<string[]>;
  pause(id: number): Promise<void>;
  resume(id: number): Promise<void>;
  remove(id: number, deleteFile: boolean): Promise<void>;
  place(id: number, place: Place): Promise<void>;
  openFile(id: number): Promise<void>;
  showInFolder(id: number): Promise<void>;
  events(id: number): Promise<DownloadEvent[]>;
  // A running download's segments, connections, server and engine log, or the last ones in this session.
  inspect(id: number): Promise<Inspection | null>;
  settings(): Promise<Settings>;
  updateSettings(settings: Settings): Promise<void>;
  chooseDownloadFolder(): Promise<Settings | null>;
  systemColorScheme(): Promise<ColorScheme | null>;
  onColorScheme(listener: (scheme: ColorScheme | null) => void): Promise<() => void>;
  onNotice(listener: (message: string) => void): Promise<() => void>;
  onProgress(listener: (batch: ProgressBatch) => void): Promise<() => void>;
  pendingCaptures(): Promise<Download[]>;
  answerCapture(id: number, answer: CaptureAnswer): Promise<void>;
  onCaptures(listener: (captures: Download[]) => void): Promise<() => void>;
  onFocusDownload(listener: (id: number) => void): Promise<() => void>;
  windowControls: WindowControls | null;
}

export function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export class BackendError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
  }

  static from(error: unknown): BackendError {
    if (error instanceof BackendError) return error;
    if (isCommandError(error)) return new BackendError(error.kind, error.message);
    return new BackendError("internal", error instanceof Error ? error.message : String(error));
  }
}
