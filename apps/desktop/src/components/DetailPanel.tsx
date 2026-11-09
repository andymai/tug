import { Check, Copy, ExternalLink, FolderOpen, ListStart, Pause, Pencil, Play, RotateCw, Trash2, X } from "lucide-react";
import { type KeyboardEvent as KeyEvent, useEffect, useId, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

import type { CookiesChange, Download, DownloadEvent, Headers } from "../backend/backend";
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
import { limitText, type Parsed, parseConnections, parseLimit } from "../lib/options";
import { ICON, STATES } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import { canRename, chosen, modalOpen, single } from "../state/downloads";
import { useDraft } from "../state/draft";
import { Button } from "./Button";
import { ConnectionsPanel, FilesPanel, HTTP_TABS, InspectorTabs, LogPanel, PeersPanel, tabIds, TORRENT_TABS, useInspection, useTorrentView } from "./Inspector";

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
  const history = useDownloads((s) => (s.history?.id === id ? s.history.data : null));
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

// Enter renames and closes the editor at once, so no answer can drop a newer
// draft; a refused name says why, and F2 opens the editor again. Escape or a
// click elsewhere keeps the name. The stem is selected first, as file managers do.
function NameEditor({ download }: { download: Download }) {
  const startRename = useDownloads((s) => s.startRename);
  const rename = useDownloads((s) => s.rename);
  const [draft, setDraft] = useState(download.name);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = field.current;
    if (input === null) return;
    input.focus();
    const dot = input.value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }, []);
  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        startRename(null);
        if (draft.trim() !== download.name) void rename(download.id, draft);
      }}
    >
      <input
        ref={field}
        aria-label="Name"
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          startRename(null);
        }}
        onBlur={() => {
          startRename(null);
        }}
        className="h-8 w-full rounded-sm border border-control-border bg-surface px-2 text-title text-ink"
      />
    </form>
  );
}

// The cookies never come back from Tug: the panel only says whether they go
// along, and replaces or clears them. A field takes the saved value (Tug cleans
// a referrer up) only if nobody typed in it since the save began.
function HeaderFields({ download, headers }: { download: Download; headers: Headers }) {
  const setHeaders = useDownloads((s) => s.setHeaders);
  const referrerDraft = useDraft(headers.referrer ?? "");
  const userAgentDraft = useDraft(headers.userAgent ?? "");
  const referrer = referrerDraft.text;
  const userAgent = userAgentDraft.text;
  const [cookie, setCookie] = useState({ text: "", replacing: !headers.hasCookies });
  // While a save is on its way, `headers` is older than what Tug will hold, so
  // text that matches it may still differ from the last save.
  const [pending, setPending] = useState(0);
  const cookies = cookie.text;
  const replacing = cookie.replacing;
  const headingId = useId();
  const referrerId = useId();
  const cookiesId = useId();
  const userAgentId = useId();
  const plain = (text: string) => (text.trim() === "" ? null : text.trim());

  const commit = (change: CookiesChange = { kind: "keep" }) => {
    const sent = { referrer: plain(referrer), userAgent: plain(userAgent) };
    const same = sent.referrer === headers.referrer && sent.userAgent === headers.userAgent;
    if (same && change.kind === "keep" && pending === 0) return;
    const referrerSave = referrerDraft.commit();
    const userAgentSave = userAgentDraft.commit();
    setPending((n) => n + 1);
    void setHeaders(download.id, sent.referrer, change, sent.userAgent).then((saved) => {
      setPending((n) => n - 1);
      if (saved === null) {
        referrerSave.failed();
        userAgentSave.failed();
        return;
      }
      referrerSave.saved(saved.referrer ?? "");
      userAgentSave.saved(saved.userAgent ?? "");
      if (change.kind === "clear") setCookie((now) => ({ ...now, replacing: true }));
      if (change.kind === "set") setCookie((now) => (now.text.trim() === change.value ? { text: "", replacing: false } : now));
    });
  };
  const commitCookies = () => {
    if (cookies.trim() !== "") commit({ kind: "set", value: cookies.trim() });
    else if (headers.hasCookies) setCookie({ text: "", replacing: false });
  };
  const enter = (save: () => void) => (event: KeyEvent<HTMLInputElement>) => {
    if (event.key === "Enter") save();
  };
  const field = "h-7 min-w-0 rounded-sm border border-control-border bg-surface px-2 text-small text-ink placeholder:text-ink-faint";

  return (
    <section aria-labelledby={headingId} className="border-t border-line px-4 py-4">
      <h3 id={headingId} className="pb-2 text-label text-ink-muted">
        Headers
      </h3>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-small">
        <label htmlFor={referrerId} className="text-ink-muted">
          Referrer
        </label>
        <input
          id={referrerId}
          spellCheck={false}
          value={referrer}
          placeholder="None"
          onChange={(event) => {
            referrerDraft.edit(event.target.value);
          }}
          onBlur={() => {
            commit();
          }}
          onKeyDown={enter(() => {
            commit();
          })}
          className={field}
        />
        <label htmlFor={cookiesId} className="text-ink-muted">
          Cookies
        </label>
        {replacing ? (
          <input
            id={cookiesId}
            type="password"
            autoComplete="off"
            value={cookies}
            placeholder="None"
            onChange={(event) => {
              setCookie({ text: event.target.value, replacing: true });
            }}
            onBlur={commitCookies}
            onKeyDown={enter(commitCookies)}
            className={field}
          />
        ) : (
          <span id={cookiesId} className="flex items-center gap-2">
            <span className="text-ink">Sent</span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setCookie({ text: "", replacing: true });
              }}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                commit({ kind: "clear" });
              }}
            >
              Clear
            </Button>
          </span>
        )}
        <label htmlFor={userAgentId} className="text-ink-muted">
          User agent
        </label>
        <input
          id={userAgentId}
          spellCheck={false}
          value={userAgent}
          placeholder="Tug's own"
          onChange={(event) => {
            userAgentDraft.edit(event.target.value);
          }}
          onBlur={() => {
            commit();
          }}
          onKeyDown={enter(() => {
            commit();
          })}
          className={field}
        />
      </div>
      {download.state === "downloading" && <p className="pt-2 text-small text-ink-muted">New headers go with the next start.</p>}
    </section>
  );
}

function OwnHeaders({ download }: { download: Download }) {
  const headers = useDownloads((s) => (s.headers?.id === download.id ? s.headers.data : null));
  const loadHeaders = useDownloads((s) => s.loadHeaders);
  useEffect(() => {
    void loadHeaders(download.id);
  }, [download.id, loadHeaders]);
  if (headers === null) return null;
  return <HeaderFields download={download} headers={headers} />;
}

const countText = (count: number | null) => (count === null ? "" : String(count));

// A field commits on Enter or when it loses the focus, as Settings does. A field
// takes a new stored value only when that value changes and nobody typed in it
// since the last commit, so a late save never overwrites a newer edit. A field
// whose text still shows the stored value keeps that value exactly.
function OwnOptions({ download }: { download: Download }) {
  const tug = useDownloads((s) => s.settings?.connections ?? null);
  const setOptions = useDownloads((s) => s.setOptions);
  const connectionsDraft = useDraft(countText(download.connections));
  const limitDraft = useDraft(limitText(download.speedLimit));
  const connections = connectionsDraft.text;
  const limit = limitDraft.text;
  const [pending, setPending] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const headingId = useId();
  const connectionsId = useId();
  const limitId = useId();

  const commit = () => {
    const own: Parsed = connections === countText(download.connections) ? { ok: true, value: download.connections } : parseConnections(connections);
    const cap: Parsed = limit === limitText(download.speedLimit) ? { ok: true, value: download.speedLimit } : parseLimit(limit);
    if (!own.ok || !cap.ok) {
      setProblem(own.ok ? (cap.ok ? null : cap.problem) : own.problem);
      return;
    }
    setProblem(null);
    if (own.value === download.connections && cap.value === download.speedLimit && pending === 0) return;
    const saves = [connectionsDraft.commit(), limitDraft.commit()];
    setPending((n) => n + 1);
    void setOptions(download.id, own.value, cap.value).then((saved) => {
      setPending((n) => n - 1);
      if (!saved) for (const save of saves) save.failed();
    });
  };
  const field = "h-7 w-16 rounded-sm border border-control-border bg-surface px-2 text-right text-mono text-ink placeholder:text-ink-faint aria-invalid:border-state-error";
  const keys = (event: KeyEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };

  return (
    <section aria-labelledby={headingId} className="border-t border-line px-4 py-4">
      <h3 id={headingId} className="pb-2 text-label text-ink-muted">
        Options
      </h3>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-small">
        <label htmlFor={connectionsId} className="text-ink-muted">
          Connections
        </label>
        <input
          id={connectionsId}
          inputMode="numeric"
          value={connections}
          placeholder={tug === null ? "" : String(tug)}
          aria-invalid={problem !== null && !parseConnections(connections).ok}
          onChange={(event) => {
            connectionsDraft.edit(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={keys}
          className={field}
        />
        <label htmlFor={limitId} className="text-ink-muted">
          Speed limit
        </label>
        <span className="flex items-center gap-2">
          <input
            id={limitId}
            inputMode="decimal"
            value={limit}
            placeholder="None"
            aria-invalid={problem !== null && !parseLimit(limit).ok}
            onChange={(event) => {
              limitDraft.edit(event.target.value);
            }}
            onBlur={commit}
            onKeyDown={keys}
            className={field}
          />
          <span className="text-mono text-ink-muted">MB/s</span>
        </span>
      </div>
      <p role={problem === null ? undefined : "alert"} className="pt-2 text-small text-ink-muted">
        {problem ?? (download.state === "downloading" ? "A new limit holds at once; connections change at the next start." : "Empty takes Tug's setting.")}
      </p>
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

const PANEL =
  "flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface @max-2xl/main:absolute @max-2xl/main:z-20 @max-2xl/main:inset-y-0 @max-2xl/main:right-0 @max-2xl/main:w-[min(20rem,100%)] @max-2xl/main:bg-surface-raised @max-2xl/main:shadow-popover";

function Panel({ download }: { download: Download }) {
  const live = useDownloads((s) => s.live[download.id]);
  const select = useDownloads((s) => s.select);
  const pause = useDownloads((s) => s.pause);
  const resume = useDownloads((s) => s.resume);
  const startNext = useDownloads((s) => s.startNext);
  const openFile = useDownloads((s) => s.openFile);
  const showInFolder = useDownloads((s) => s.showInFolder);
  const notify = useDownloads((s) => s.notify);
  const store = useDownloadsStore();
  const chosenTab = useDownloads((s) => s.inspectorTab);
  const torrent = download.url.startsWith("magnet:");
  const tabs = torrent ? TORRENT_TABS : HTTP_TABS;
  const tab = tabs.some((entry) => entry.id === chosenTab) ? chosenTab : "overview";
  const renaming = useDownloads((s) => s.renaming === download.id);
  const startRename = useDownloads((s) => s.startRename);
  const setTab = useDownloads((s) => s.setInspectorTab);
  const seen = useInspection(download, !torrent && tab !== "overview");
  const torrentView = useTorrentView(download, torrent && tab !== "overview");
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  const tabBase = useId();
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
    <aside ref={panel} aria-labelledby={titleId} className={PANEL}>
      <div className="flex items-start gap-2 px-4 pt-3">
        <h2 id={titleId} className={renaming ? "sr-only" : "min-w-0 flex-1 pt-0.5 text-title [overflow-wrap:anywhere] text-ink"}>
          {download.name}
        </h2>
        {renaming && <NameEditor download={download} />}
        {!renaming && canRename(download) && (
          <Button
            variant="quiet"
            size="icon"
            icon={Pencil}
            aria-label="Rename"
            title="Rename (F2)"
            onClick={() => {
              startRename(download.id);
            }}
          />
        )}
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
        <div aria-hidden="true" className="mx-4 mt-3 h-1 shrink-0 overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full transition-[width] duration-100 ease-linear ${download.state === "paused" ? "bg-ink-faint" : "bg-accent"}`}
            style={{ width: `${String(percentOf(received, total))}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2 px-4 pt-3 pb-3">
        {download.state === "done" && (
          <Button icon={ExternalLink} onClick={() => void openFile(download.id)}>
            Open
          </Button>
        )}
        {download.state === "queued" && (
          <Button icon={ListStart} onClick={() => void startNext(download.id)}>
            Start next
          </Button>
        )}
        {(download.state === "downloading" || download.state === "queued") && (
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
      <InspectorTabs base={tabBase} tabs={tabs} tab={tab} onChange={setTab} />
      <div role="tabpanel" id={tabIds(tabBase, tab).panel} aria-labelledby={tabIds(tabBase, tab).tab}>
        {tab === "overview" && (
          <>
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
            {download.state !== "done" && !download.url.startsWith("magnet:") && (
              <>
                <OwnOptions download={download} />
                <OwnHeaders download={download} />
              </>
            )}
            <History
              id={download.id}
              state={download.state}
              revision={`${String(download.finishedMs)}:${download.error ?? ""}`}
            />
          </>
        )}
        {tab === "connections" && <ConnectionsPanel download={download} seen={seen} />}
        {tab === "log" && <LogPanel seen={seen} />}
        {tab === "files" && <FilesPanel download={download} view={torrentView} />}
        {tab === "peers" && <PeersPanel download={download} view={torrentView} />}
      </div>
    </aside>
  );
}

function useEscapeCloses(back: number | null) {
  const select = useDownloads((s) => s.select);
  const store = useDownloadsStore();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || modalOpen(store.getState())) return;
      const inside = panel.current?.contains(document.activeElement) ?? false;
      select(null);
      if (inside && back !== null) focusRow(back);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [back, select, store]);
  return panel;
}

const ORDER: readonly Download["state"][] = ["downloading", "queued", "paused", "failed", "done"];

function SelectionPanel({ list }: { list: readonly Download[] }) {
  const live = useDownloads((s) => s.live);
  const selected = useDownloads((s) => s.selected);
  const select = useDownloads((s) => s.select);
  const pauseMany = useDownloads((s) => s.pauseMany);
  const resumeMany = useDownloads((s) => s.resumeMany);
  const moveMany = useDownloads((s) => s.moveMany);
  const askRemove = useDownloads((s) => s.askRemove);
  const titleId = useId();
  const panel = useEscapeCloses(selected);
  const ids = list.map((item) => item.id);
  const any = (...states: Download["state"][]) => list.some((item) => states.includes(item.state));
  const counts = ORDER.flatMap((state) => {
    const count = list.filter((item) => item.state === state).length;
    return count === 0 ? [] : [`${String(count)} ${STATES[state].word.toLowerCase()}`];
  });
  const known = list.filter((item) => (live[item.id]?.total ?? item.size) !== null);
  const size = known.reduce((sum, item) => sum + (live[item.id]?.total ?? item.size ?? 0), 0);
  const received = list.reduce((sum, item) => sum + (live[item.id]?.received ?? item.received), 0);
  const facts: Fact[] = [
    { label: "Size", value: known.length === list.length ? formatBytes(size) : `${formatBytes(size)} and ${String(list.length - known.length)} unknown`, mono: true },
    { label: "Received", value: formatBytes(received), mono: true },
  ];

  return (
    <aside ref={panel} aria-labelledby={titleId} className={PANEL}>
      <div className="flex items-start gap-2 px-4 pt-3">
        <h2 id={titleId} className="min-w-0 flex-1 pt-0.5 text-title text-ink">
          {`${String(list.length)} downloads`}
        </h2>
        <Button
          variant="quiet"
          size="icon"
          icon={X}
          aria-label="Clear the selection"
          onClick={() => {
            select(null);
            if (selected !== null) focusRow(selected);
          }}
        />
      </div>
      <p className="px-4 pt-1 text-small text-ink-muted">{counts.join(" · ")}</p>
      <div className="flex flex-wrap gap-2 border-b border-line px-4 pt-3 pb-4">
        {any("queued") && (
          <Button icon={ListStart} onClick={() => void moveMany(ids, "first")}>
            Start next
          </Button>
        )}
        {any("downloading", "queued") && (
          <Button icon={Pause} onClick={() => void pauseMany(ids)}>
            Pause
          </Button>
        )}
        {any("paused", "failed") && (
          <Button icon={any("paused") ? Play : RotateCw} onClick={() => void resumeMany(ids)}>
            {any("paused") ? "Resume" : "Retry"}
          </Button>
        )}
        <Button
          icon={Trash2}
          onClick={() => {
            askRemove(ids);
          }}
        >
          Remove…
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 text-small">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-ink-muted">{fact.label}</dt>
            <dd className={`truncate text-ink ${fact.mono ? "text-mono" : ""}`}>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <ul aria-label="Selected downloads" className="flex flex-col gap-1.5 border-t border-line px-4 py-4 text-small">
        {list.map((item) => {
          const look = STATES[item.state];
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-2">
              <look.Icon {...ICON} size={14} className={`shrink-0 ${look.tone}`} />
              <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
              <span className={`shrink-0 ${look.colorWord ? look.tone : "text-ink-muted"}`}>{look.word}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

const NONE: readonly Download[] = [];

export function DetailPanel() {
  // Sorting the view on every tick costs, so only for a real multiple selection.
  const list = useDownloads(useShallow((s) => (s.marked.length > 1 ? chosen(s) : NONE)));
  const download = useDownloads((s) => single(s));
  if (list.length > 1) return <SelectionPanel list={list} />;
  if (!download) return null;
  return <Panel key={download.id} download={download} />;
}
