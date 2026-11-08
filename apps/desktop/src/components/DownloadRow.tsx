import { memo } from "react";

import type { Download, ProgressUpdate } from "../backend/backend";
import { formatBytes, formatLeft, formatPercent, formatSpeed, percentOf, sentence, shortDir } from "../lib/format";
import { ICON, STATES } from "../lib/states";
import { useDownloads } from "../state/context";
import { Button } from "./Button";

interface Detail {
  text: string;
  mono: boolean;
}

function details(download: Download, live: ProgressUpdate | undefined): Detail[] {
  const received = live?.received ?? download.received;
  const total = live?.total ?? download.size;
  const percent = formatPercent(received, total);
  switch (download.state) {
    case "downloading":
      if (live && live.speed > 0) {
        const parts: Detail[] = [{ text: formatSpeed(live.speed), mono: true }];
        if (live.leftMs !== null) parts.push({ text: formatLeft(live.leftMs), mono: true });
        return parts;
      }
      return percent ? [{ text: percent, mono: true }] : [];
    case "paused":
      return percent ? [{ text: percent, mono: true }] : [];
    case "queued":
      return [];
    case "done":
      return [{ text: `Saved to ${shortDir(download.dir)}`, mono: false }];
    case "failed":
      return [{ text: sentence(download.error ?? "Tug couldn't finish this download"), mono: false }];
  }
}

export interface DownloadRowProps {
  download: Download;
  selected: boolean;
}

export const DownloadRow = memo(function DownloadRow({ download, selected }: DownloadRowProps) {
  const live = useDownloads((s) => s.live[download.id]);
  const select = useDownloads((s) => s.select);
  const resume = useDownloads((s) => s.resume);
  const fresh = useDownloads((s) => s.fresh.includes(download.id));
  const settleFresh = useDownloads((s) => s.settleFresh);
  const look = STATES[download.state];
  const received = live?.received ?? download.received;
  const total = live?.total ?? download.size;
  const showBar = download.state === "downloading" || download.state === "paused";
  const failed = download.state === "failed";

  return (
    <li className="relative border-t border-line first:border-t-0">
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => {
          select(selected ? null : download.id);
        }}
        className="grid min-h-(--row-height) w-full grid-cols-[16px_minmax(0,1fr)_132px_76px] items-center gap-3 px-3 py-0.5 text-left transition-colors duration-(--duration-fast) ease-(--ease-out) outline-offset-[-2px] hover:bg-hover focus-visible:bg-selection aria-pressed:bg-selection @max-xl:grid-cols-[16px_minmax(0,1fr)_72px_76px]"
      >
        <look.Icon
          {...ICON}
          className={fresh ? `${look.tone} animate-tug` : look.tone}
          onAnimationEnd={
            fresh
              ? () => {
                  settleFresh(download.id);
                }
              : undefined
          }
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-strong text-ink">{download.name}</span>
          <span className="flex min-w-0 items-center gap-1 text-small whitespace-nowrap text-ink-muted">
            <span className={look.colorWord ? look.tone : undefined}>{look.word}</span>
            {details(download, live).map((detail) => (
              <span key={detail.text} className={detail.mono ? "flex gap-1 text-mono" : "flex min-w-0 gap-1"}>
                <span aria-hidden="true" className="font-sans">
                  ·
                </span>
                <span className={detail.mono ? undefined : "truncate"}>{detail.text}</span>
              </span>
            ))}
          </span>
        </span>
        {showBar ? (
          <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-line">
            <span
              className={`block h-full rounded-full transition-[width] duration-100 ease-linear ${download.state === "paused" ? "bg-ink-faint" : "bg-accent"}`}
              style={{ width: `${String(percentOf(received, total))}%` }}
            />
          </span>
        ) : (
          <span />
        )}
        <span className="text-right text-mono-strong text-ink">{failed ? "" : formatBytes(total ?? received)}</span>
      </button>
      {failed && (
        <Button
          size="sm"
          aria-label={`Retry ${download.name}`}
          onClick={() => void resume(download.id)}
          className="absolute top-1/2 right-3 -translate-y-1/2"
        >
          Retry
        </Button>
      )}
    </li>
  );
});
