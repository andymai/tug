import { Check, Copy } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { Connection, ConnectionStatus, Download, Inspection, Segment, Server, TorrentView } from "../backend/backend";
import { formatBytes, formatDate, formatSeconds, formatSpeed, sentence } from "../lib/format";
import { useDownloads } from "../state/context";
import type { InspectorTab } from "../state/downloads";
import { Button } from "./Button";

type Tabs = readonly { id: InspectorTab; label: string }[];

export const HTTP_TABS: Tabs = [
  { id: "overview", label: "Overview" },
  { id: "connections", label: "Connections" },
  { id: "log", label: "Log" },
];

export const TORRENT_TABS: Tabs = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "peers", label: "Peers" },
];

const INSPECT_EVERY_MS = 1000;

export function tabIds(base: string, tab: InspectorTab) {
  return { tab: `${base}-tab-${tab}`, panel: `${base}-panel-${tab}` };
}

export function InspectorTabs({ base, tabs, tab, onChange }: { base: string; tabs: Tabs; tab: InspectorTab; onChange: (tab: InspectorTab) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = tabs.findIndex((entry) => entry.id === tab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = tabs[(to + tabs.length) % tabs.length];
    if (next === undefined) return;
    onChange(next.id);
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(tabIds(base, next.id).tab)}`)?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label="Details" className="flex gap-1 border-b border-line px-3">
      {tabs.map((entry) => {
        const ids = tabIds(base, entry.id);
        return (
          <button
            key={entry.id}
            id={ids.tab}
            type="button"
            role="tab"
            aria-selected={entry.id === tab}
            aria-controls={ids.panel}
            tabIndex={entry.id === tab ? 0 : -1}
            onKeyDown={move}
            onClick={() => {
              onChange(entry.id);
            }}
            className="relative h-8 px-2 text-small font-medium text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out) outline-offset-[-2px] hover:text-ink aria-selected:text-ink aria-selected:after:absolute aria-selected:after:inset-x-2 aria-selected:after:-bottom-px aria-selected:after:h-0.5 aria-selected:after:rounded-full aria-selected:after:bg-ink"
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

// Polls while the download runs, and reads once more when it stops, for the view Tug kept.
export function useInspection(download: Download, watching: boolean): Inspection | null | undefined {
  const inspect = useDownloads((s) => s.inspect);
  const seen = useDownloads((s) => (s.inspection?.id === download.id ? s.inspection.data : undefined));
  const running = download.state === "downloading";
  useEffect(() => {
    if (!watching) return;
    void inspect(download.id);
    if (!running) return;
    const timer = setInterval(() => void inspect(download.id), INSPECT_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [watching, running, download.id, inspect]);
  return seen;
}

function Heading({ id, children, end }: { id: string; children: string; end?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 pb-2">
      <h3 id={id} className="text-label text-ink-muted">
        {children}
      </h3>
      {end !== undefined && <span className="text-small text-ink-muted">{end}</span>}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-4 py-4 text-small text-ink-muted">{children}</p>;
}

function SegmentMap({ segments, running }: { segments: readonly Segment[]; running: boolean }) {
  const headingId = useId();
  const total = segments.at(-1)?.end ?? 0;
  if (total <= 0 || !Number.isSafeInteger(total)) return null;
  const onDisk = segments.reduce((sum, segment) => sum + segment.cursor - segment.start, 0);
  const count = segments.length === 1 ? "1 segment" : `${String(segments.length)} segments`;
  return (
    <section aria-labelledby={headingId} className="px-4 pt-4">
      <Heading id={headingId} end={count}>
        Segments
      </Heading>
      <div role="img" aria-label={`${count}, ${formatBytes(onDisk)} of ${formatBytes(total)} on disk`} className="flex h-3 gap-px">
        {segments.map((segment) => {
          const length = segment.end - segment.start;
          return (
            <span
              key={segment.start}
              className="relative h-full min-w-px basis-0 overflow-hidden bg-line first:rounded-l-xs last:rounded-r-xs"
              style={{ flexGrow: length / total }}
            >
              <span
                className={`absolute inset-y-0 left-0 ${running ? "bg-accent" : "bg-ink-faint"}`}
                style={{ width: `${String(length === 0 ? 100 : ((segment.cursor - segment.start) / length) * 100)}%` }}
              />
            </span>
          );
        })}
      </div>
      <p className="pt-1.5 text-small text-ink-muted">
        <span className="text-mono text-ink">{formatBytes(onDisk)}</span> of <span className="text-mono">{formatBytes(total)}</span> on disk
      </p>
    </section>
  );
}

function describeStatus(status: ConnectionStatus): { word: string; detail: string | null; tone: string } {
  switch (status.kind) {
    case "connecting":
      return { word: "Connecting", detail: null, tone: "text-ink-muted" };
    case "receiving":
      return { word: "Receiving", detail: null, tone: "text-ink" };
    case "retrying":
      return { word: "Retrying", detail: sentence(status.error), tone: "text-ink" };
    case "finished":
      return { word: "Finished", detail: null, tone: "text-ink-muted" };
    case "failed":
      return { word: "Failed", detail: sentence(status.error), tone: "text-state-error" };
    case "retired":
      return {
        word: "Closed",
        detail: `${status.host} allows ${String(status.cap)} ${status.cap === 1 ? "connection" : "connections"} at once.`,
        tone: "text-ink-muted",
      };
  }
}

function ConnectionTable({ connections }: { connections: readonly Connection[] }) {
  const headingId = useId();
  const receiving = connections.filter((connection) => connection.status.kind === "receiving").length;
  return (
    <section aria-labelledby={headingId} className="px-4 pt-4">
      <Heading id={headingId} end={`${String(receiving)} of ${String(connections.length)} receiving`}>
        Connections
      </Heading>
      <table aria-labelledby={headingId} className="w-full table-fixed border-collapse text-small">
        <colgroup>
          <col className="w-6" />
          <col />
          <col className="w-20" />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="text-label text-ink-muted">
            <th scope="col" className="h-6 text-left font-medium">
              #
            </th>
            <th scope="col" className="text-left font-medium">
              Status
            </th>
            <th scope="col" className="text-right font-medium">
              Received
            </th>
            <th scope="col" className="text-right font-medium">
              Speed
            </th>
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => {
            const { word, detail, tone } = describeStatus(connection.status);
            return (
              <tr key={connection.number} className="h-6 border-t border-line">
                <td className="text-mono text-ink-muted">{connection.number}</td>
                <td className={`truncate ${tone}`} title={detail ?? undefined}>
                  {word}
                </td>
                <td className="text-right text-mono text-ink">{formatBytes(connection.received)}</td>
                <td className="text-right text-mono text-ink">{connection.speed > 0 ? formatSpeed(connection.speed) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ServerFacts({ server }: { server: Server }) {
  const headingId = useId();
  const facts: [string, string][] = [];
  if (server.ip !== null) facts.push([server.proxied ? "Proxy" : "Address", server.ip]);
  if (server.rttMs !== null) facts.push(["Round trip", `${String(server.rttMs)} ms`]);
  if (server.cdn !== null) facts.push(["CDN", server.cdn]);
  if (facts.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="px-4 pt-4">
      <Heading id={headingId}>Server</Heading>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-small">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className={`truncate text-ink ${label === "CDN" ? "" : "text-mono"}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const TORRENT = "Tug shows segments and connections for downloads over HTTP.";

export function ConnectionsPanel({ download, seen }: { download: Download; seen: Inspection | null | undefined }) {
  if (seen === undefined) return null;
  if (seen === null) {
    return <Empty>{download.url.startsWith("magnet:") ? TORRENT : "Tug shows the segments and connections while a download runs, and keeps them until Tug quits."}</Empty>;
  }
  const running = download.state === "downloading";
  return (
    <div className="pb-4">
      <SegmentMap segments={seen.segments} running={running} />
      {running && seen.connections.length > 0 && <ConnectionTable connections={seen.connections} />}
      {seen.server !== null && <ServerFacts server={seen.server} />}
    </div>
  );
}

export function LogPanel({ seen }: { seen: Inspection | null | undefined }) {
  const notify = useDownloads((s) => s.notify);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);
  if (seen === undefined) return null;
  if (seen === null || seen.log.length === 0) {
    return <Empty>Tug shows the engine's log while a download runs, and keeps it until Tug quits.</Empty>;
  }
  const copy = () => {
    const text = seen.log.map((line) => `${new Date(line.atMs).toISOString()} ${line.text}`).join("\n");
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
      },
      () => {
        notify("couldn't copy the log");
      },
    );
  };
  return (
    <div className="px-4 py-3">
      <div className="flex justify-end pb-2">
        <Button size="sm" variant="quiet" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? "Copied" : "Copy log"}
        </Button>
      </div>
      <ol className="flex flex-col gap-1.5 text-small">
        {seen.log.map((line) => (
          <li key={line.seq} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3">
            <time dateTime={new Date(line.atMs).toISOString()} title={formatDate(line.atMs)} className="text-mono text-ink-muted">
              {formatSeconds(line.atMs)}
            </time>
            <span className="min-w-0 [overflow-wrap:anywhere] text-ink">{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Polls while the torrent runs, and reads once more when it stops.
export function useTorrentView(download: Download, watching: boolean): TorrentView | null | undefined {
  const load = useDownloads((s) => s.loadTorrent);
  const view = useDownloads((s) => (s.torrent?.id === download.id ? s.torrent.data : undefined));
  const running = download.state === "downloading";
  useEffect(() => {
    if (!watching) return;
    void load(download.id);
    if (!running) return;
    const timer = setInterval(() => void load(download.id), INSPECT_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [watching, running, download.id, load]);
  return view;
}

const NO_LIST = "Tug shows a torrent's files and peers once its peers send its list of files.";

export function FilesPanel({ download, view }: { download: Download; view: TorrentView | null | undefined }) {
  const chooseFiles = useDownloads((s) => s.chooseFiles);
  const headingId = useId();
  if (view === undefined) return null;
  if (view === null) return <Empty>{NO_LIST}</Empty>;
  const chosen = view.files.filter((file) => file.chosen);
  const size = chosen.reduce((sum, file) => sum + file.size, 0);
  const done = download.state === "done";
  const choose = (files: number[]) => {
    void chooseFiles(download.id, files);
  };
  const files = [...view.files].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <section aria-labelledby={headingId} className="px-4 py-4">
      <Heading id={headingId} end={`${String(chosen.length)} of ${String(view.files.length)} · ${formatBytes(size)}`}>
        Files
      </Heading>
      {!done && chosen.length < view.files.length && (
        <div className="pb-2">
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              choose(view.files.map((file) => file.index));
            }}
          >
            Choose all
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-1.5 text-small">
        {files.map((file) => {
          const only = file.chosen && chosen.length === 1;
          return (
            <li key={file.index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
              <input
                type="checkbox"
                aria-label={file.path}
                checked={file.chosen}
                disabled={done || only}
                title={only ? "A torrent needs at least one file" : undefined}
                onChange={() => {
                  choose(chosen.map((c) => c.index).filter((index) => index !== file.index).concat(file.chosen ? [] : [file.index]));
                }}
                className="size-4 accent-primary"
              />
              <span className={`truncate ${file.chosen ? "text-ink" : "text-ink-muted"}`} title={file.path}>
                {file.path}
              </span>
              <span className="text-mono text-ink-muted">
                {file.chosen ? `${String(file.size === 0 ? 100 : Math.floor((file.done / file.size) * 100))}% · ` : ""}
                {formatBytes(file.size)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PeersPanel({ download, view }: { download: Download; view: TorrentView | null | undefined }) {
  const headingId = useId();
  if (view === undefined) return null;
  if (view === null) return <Empty>{NO_LIST}</Empty>;
  if (view.peers.length === 0) {
    return <Empty>{download.state === "downloading" ? "No peer is connected yet." : "Tug shows the peers while the torrent runs."}</Empty>;
  }
  return (
    <section aria-labelledby={headingId} className="px-4 py-4">
      <Heading id={headingId} end={`${String(view.peersLive)} connected · ${String(view.peersSeen)} seen`}>
        Peers
      </Heading>
      <table aria-labelledby={headingId} className="w-full table-fixed border-collapse text-small">
        <colgroup>
          <col />
          <col className="w-20" />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="text-label text-ink-muted">
            <th scope="col" className="h-6 text-left font-medium">
              Peer
            </th>
            <th scope="col" className="text-right font-medium">
              Received
            </th>
            <th scope="col" className="text-right font-medium">
              Sent
            </th>
          </tr>
        </thead>
        <tbody>
          {view.peers.map((peer) => (
            <tr key={peer.address} className="border-t border-line">
              <td className="py-1">
                <span className="block truncate text-mono text-ink">{peer.address}</span>
                <span className="block truncate text-ink-muted">
                  {[peer.client ?? "Unknown client", peer.transport?.toUpperCase()].filter((part) => part !== undefined).join(" · ")}
                </span>
              </td>
              <td className="text-right text-mono text-ink">{formatBytes(peer.received)}</td>
              <td className="text-right text-mono text-ink-muted">{peer.sent > 0 ? formatBytes(peer.sent) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-2 text-small text-ink-muted">
        Sent to peers: <span className="text-mono text-ink">{formatBytes(view.uploaded)}</span>
      </p>
    </section>
  );
}
