import { Check, Copy, ExternalLink, FolderOpen, Pause, Play, RotateCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Download, DownloadEvent } from "../backend/backend";
import {
  formatBytes,
  formatClock,
  formatDate,
  formatDuration,
  formatPercent,
  formatSpeed,
  percentOf,
  sentence,
  shortDir,
} from "../lib/format";
import { focusRow } from "../lib/dom";
import { ICON, STATES } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import { modalOpen } from "../state/downloads";
import { Button } from "./Button";

interface Fact {
  label: string;
  value: string;
  mono: boolean;
  title?: string;
}

function describeEvent(event: DownloadEvent): { text: string; bytes: string | null; detail: string | null } {
  const bytes = event.bytes === null ? null : formatBytes(event.bytes);
  switch (event.kind) {
    case "added":
      return { text: "Added", bytes: null, detail: null };
    case "started":
      return { text: "Started", bytes: null, detail: null };
    case "resumed":
      return { text: bytes === null ? "Resumed" : "Resumed at", bytes, detail: null };
    case "paused":
      return { text: bytes === null ? "Paused" : "Paused at", bytes, detail: null };
    case "finished":
      return { text: "Finished", bytes, detail: null };
    case "failed":
      return { text: "Failed", bytes: null, detail: event.detail === null ? null : sentence(event.detail) };
  }
}

function History({ id, state, revision }: { id: number; state: Download["state"]; revision: string }) {
  const history = useDownloads((s) => (s.history?.id === id ? s.history.events : null));
  const loadHistory = useDownloads((s) => s.loadHistory);

  useEffect(() => {
    void loadHistory(id);
  }, [id, state, revision, loadHistory]);

  if (history === null || history.length === 0) return null;
  return (
    <section aria-labelledby={`history-${String(id)}`} className="border-t border-line px-4 py-4">
      <h3 id={`history-${String(id)}`} className="pb-2 text-label text-ink-muted">
        History
      </h3>
      <ol className="flex flex-col gap-1.5 text-small">
        {history.map((event, index) => {
          const { text, bytes, detail } = describeEvent(event);
          return (
            <li key={`${String(index)}-${event.kind}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
              <time dateTime={new Date(event.atMs).toISOString()} title={formatDate(event.atMs)} className="text-mono text-ink-muted">
                {formatClock(event.atMs)}
              </time>
              <span className="min-w-0 text-ink">
                {text}
                {bytes !== null && <span className="text-mono"> {bytes}</span>}
                {detail !== null && <span className="text-ink-muted"> · {detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

function Panel({ download }: { download: Download }) {
  const live = useDownloads((s) => s.live[download.id]);
  const select = useDownloads((s) => s.select);
  const pause = useDownloads((s) => s.pause);
  const resume = useDownloads((s) => s.resume);
  const openFile = useDownloads((s) => s.openFile);
  const showInFolder = useDownloads((s) => s.showInFolder);
  const notify = useDownloads((s) => s.notify);
  const store = useDownloadsStore();
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  useEffect(() => {
    const close = () => {
      const inside = panel.current?.contains(document.activeElement) ?? false;
      select(null);
      if (inside) focusRow(download.id);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !modalOpen(store.getState())) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [download.id, select, store]);

  const closeFromButton = () => {
    select(null);
    focusRow(download.id);
  };

  const look = STATES[download.state];
  const received = live?.received ?? download.received;
  const total = live?.total ?? download.size;
  const running = download.state === "downloading" && live !== undefined;
  const percent = formatPercent(received, total);

  const facts: Fact[] = [
    { label: download.state === "done" ? "Saved to" : "Saving to", value: shortDir(download.dir), mono: false, title: download.dir },
    { label: "Source", value: hostOf(download.url), mono: false, title: download.url },
    { label: "Size", value: total === null ? "Unknown" : formatBytes(total), mono: total !== null },
  ];
  if (download.state !== "done") {
    facts.push({ label: "Received", value: percent ? `${formatBytes(received)} · ${percent}` : formatBytes(received), mono: true });
  }
  if (running) {
    facts.push({ label: "Speed", value: formatSpeed(live.speed), mono: true });
    if (live.leftMs !== null) facts.push({ label: "Time left", value: formatDuration(live.leftMs), mono: true });
    facts.push({ label: "Connections", value: String(live.connections), mono: true });
  }
  facts.push({ label: "Added", value: formatDate(download.addedMs), mono: false });
  if (download.finishedMs !== null) facts.push({ label: "Finished", value: formatDate(download.finishedMs), mono: false });

  const copy = () => {
    navigator.clipboard.writeText(download.url).then(
      () => {
        setCopied(true);
      },
      () => {
        notify("couldn't copy the link");
      },
    );
  };

  return (
    <aside
      ref={panel}
      aria-labelledby={titleId}
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface @max-2xl/main:absolute @max-2xl/main:inset-y-0 @max-2xl/main:right-0 @max-2xl/main:w-[min(20rem,100%)] @max-2xl/main:bg-surface-raised @max-2xl/main:shadow-popover"
    >
      <div className="flex items-start gap-2 px-4 pt-3">
        <h2 id={titleId} className="min-w-0 flex-1 pt-0.5 text-title [overflow-wrap:anywhere] text-ink">
          {download.name}
        </h2>
        <Button
          variant="quiet"
          size="icon"
          icon={X}
          aria-label="Close details"
          onClick={closeFromButton}
        />
      </div>
      <p className="flex items-center gap-1.5 px-4 pt-1 text-small text-ink-muted">
        <look.Icon {...ICON} className={look.tone} />
        <span className={look.colorWord ? look.tone : undefined}>{look.word}</span>
      </p>
      {download.state === "failed" && download.error !== null && (
        <p className="px-4 pt-1 text-small text-ink">{sentence(download.error)}</p>
      )}
      {(download.state === "downloading" || download.state === "paused") && (
        <div aria-hidden="true" className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full transition-[width] duration-100 ease-linear ${download.state === "paused" ? "bg-ink-faint" : "bg-accent"}`}
            style={{ width: `${String(percentOf(received, total))}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-b border-line px-4 pt-3 pb-4">
        {download.state === "done" && (
          <Button icon={ExternalLink} onClick={() => void openFile(download.id)}>
            Open
          </Button>
        )}
        {download.state === "downloading" && (
          <Button icon={Pause} onClick={() => void pause(download.id)}>
            Pause
          </Button>
        )}
        {download.state === "paused" && (
          <Button icon={Play} onClick={() => void resume(download.id)}>
            Resume
          </Button>
        )}
        {download.state === "failed" && (
          <Button icon={RotateCw} onClick={() => void resume(download.id)}>
            Retry
          </Button>
        )}
        <Button icon={FolderOpen} onClick={() => void showInFolder(download.id)}>
          Open folder
        </Button>
        <Button icon={copied ? Check : Copy} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 text-small">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-ink-muted">{fact.label}</dt>
            <dd title={fact.title} className={`truncate text-ink ${fact.mono ? "text-mono" : ""}`}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      <History
        id={download.id}
        state={download.state}
        revision={`${String(download.finishedMs)}:${download.error ?? ""}`}
      />
    </aside>
  );
}

export function DetailPanel() {
  const download = useDownloads((s) => s.items.find((item) => item.id === s.selected));
  if (!download) return null;
  return <Panel key={download.id} download={download} />;
}
