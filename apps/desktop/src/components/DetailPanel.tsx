import { Check, Copy, ExternalLink, FolderOpen, Pause, Play, RotateCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Download } from "../backend/backend";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatPercent,
  formatSpeed,
  percentOf,
  sentence,
  shortDir,
} from "../lib/format";
import { ICON, STATES } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import { Button } from "./Button";

interface Fact {
  label: string;
  value: string;
  mono: boolean;
  title?: string;
}

function focusRow(id: number) {
  document.querySelector<HTMLElement>(`[data-download="${String(id)}"]`)?.focus();
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
      if (event.key === "Escape" && !store.getState().adding.open) close();
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
    </aside>
  );
}

export function DetailPanel() {
  const download = useDownloads((s) => s.items.find((item) => item.id === s.selected));
  if (!download) return null;
  return <Panel key={download.id} download={download} />;
}
