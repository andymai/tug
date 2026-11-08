import { CircleAlert, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import markDark from "../../../../brand/svg/mark-dark.svg";
import mark from "../../../../brand/svg/mark.svg";
import { formatSpeed, sentence } from "../lib/format";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { type View, visibleItems } from "../state/downloads";
import { DownloadRow } from "./DownloadRow";

const TITLES: Record<View, string> = {
  all: "All downloads",
  active: "Active",
  done: "Done",
  failed: "Failed",
};

const EMPTY: Record<View, { title: string; body: string }> = {
  all: { title: "Nothing downloading", body: "Paste a link or drop a file here." },
  active: { title: "Nothing downloading", body: "Paste a link or drop a file here." },
  done: { title: "Nothing done yet", body: "Finished downloads show up here." },
  failed: { title: "Nothing failed", body: "Downloads that fail show up here, with the reason." },
};

function Summary() {
  const { count, speed } = useDownloads(
    useShallow((s) => {
      const running = s.items.filter((item) => item.state === "downloading");
      return {
        count: running.length,
        speed: running.reduce((sum, item) => sum + (s.live[item.id]?.speed ?? 0), 0),
      };
    }),
  );
  if (count === 0) return null;
  return (
    <p className="text-small text-ink-muted">
      {count} downloading
      {speed > 0 && (
        <>
          {" · "}
          <span className="text-mono">{formatSpeed(speed)}</span>
        </>
      )}
    </p>
  );
}

function Empty({ view, first }: { view: View; first: boolean }) {
  const copy = EMPTY[view];
  return (
    <section aria-labelledby="empty-title" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {first && (
        <picture>
          <source srcSet={markDark} media="(prefers-color-scheme: dark)" />
          <img src={mark} alt="" width={40} height={42} />
        </picture>
      )}
      <h2 id="empty-title" className="text-heading text-ink">
        {copy.title}
      </h2>
      <p className="max-w-sm text-body text-ink-muted">{copy.body}</p>
    </section>
  );
}

function LoadError({ message }: { message: string }) {
  const reload = useDownloads((s) => s.reload);
  return (
    <section aria-labelledby="error-title" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 id="error-title" className="text-heading text-ink">
        Couldn't load your downloads
      </h2>
      <p className="max-w-sm text-body text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={() => void reload()}
        className="h-[30px] rounded-sm border border-control-border bg-surface px-3 text-body-strong text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-hover"
      >
        Retry
      </button>
    </section>
  );
}

function Notice() {
  const notice = useDownloads((s) => s.notice);
  const dismiss = useDownloads((s) => s.dismissNotice);
  if (notice === null) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-line py-1 pr-2 pl-4 text-small text-ink">
      <CircleAlert {...ICON} className="shrink-0 text-state-error" />
      <p className="min-w-0 flex-1">{sentence(notice)}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-hover hover:text-ink"
      >
        <X {...ICON} />
      </button>
    </div>
  );
}

export function DownloadList() {
  const view = useDownloads((s) => s.view);
  const status = useDownloads((s) => s.status);
  const loadError = useDownloads((s) => s.loadError);
  const total = useDownloads((s) => s.items.length);
  const items = useDownloads(useShallow((s) => visibleItems(s)));
  const selected = useDownloads((s) => s.selected);

  return (
    <main className="@container flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
        <h1 className="text-title text-ink">{TITLES[view]}</h1>
        <Summary />
      </header>
      <Notice />
      {status === "error" ? (
        <LoadError message={sentence(loadError ?? "")} />
      ) : status === "ready" && items.length === 0 ? (
        <Empty view={view} first={total === 0} />
      ) : (
        <ul aria-label={TITLES[view]} className="flex-1 overflow-y-auto">
          {items.map((download) => (
            <DownloadRow key={download.id} download={download} selected={download.id === selected} />
          ))}
        </ul>
      )}
    </main>
  );
}
