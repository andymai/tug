import { BookmarkPlus, CircleAlert, ListX, Plus, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";

import markDark from "../../../../brand/svg/mark-dark.svg";
import mark from "../../../../brand/svg/mark.svg";
import { sentence } from "../lib/format";
import { CATEGORIES, isCategory } from "../lib/categories";
import { ICON } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import { finished, hasFinished, savedViewOf, type StateView, type View, visibleItems } from "../state/downloads";
import { useTheme } from "../state/theme";
import { Button } from "./Button";
import { DetailPanel } from "./DetailPanel";
import { WindowControls } from "./WindowControls";
import { DownloadTable } from "./DownloadTable";
import { StatusBar } from "./StatusBar";

const TITLES: Record<StateView, string> = {
  all: "All downloads",
  active: "Active",
  done: "Done",
  failed: "Failed",
};

const EMPTY: Record<StateView, { title: string; body: string }> = {
  all: { title: "Nothing downloading", body: "Paste a link or drop a file here." },
  active: { title: "Nothing downloading", body: "Paste a link or drop a file here." },
  done: { title: "Nothing done yet", body: "Finished downloads show up here." },
  failed: { title: "Nothing failed", body: "Downloads that fail show up here, with the reason." },
};

function SearchField() {
  const search = useDownloads((s) => s.search);
  const setSearch = useDownloads((s) => s.setSearch);
  const request = useDownloads((s) => s.searchRequest);
  const saveView = useDownloads((s) => s.saveView);
  const savable = useDownloads((s) => s.search.trim() !== "" && savedViewOf(s) === null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (request > 0) field.current?.focus();
  }, [request]);
  return (
    <div className="relative flex min-w-0 shrink items-center">
      <Search {...ICON} className="pointer-events-none absolute left-2 text-ink-muted" />
      <input
        ref={field}
        type="search"
        aria-label="Search downloads"
        placeholder="Search"
        spellCheck={false}
        autoComplete="off"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && search !== "") {
            event.preventDefault();
            setSearch("");
          }
        }}
        className={`h-[30px] w-44 min-w-0 rounded-sm ${savable ? "@max-xl/main:w-28" : "@max-xl/main:w-24"} border border-control-border bg-surface pl-8 text-body text-ink placeholder:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none ${savable ? "pr-8" : "pr-2"}`}
      />
      {savable && (
        <button
          type="button"
          aria-label="Save view"
          title="Save view"
          onClick={saveView}
          className="absolute right-1 inline-flex size-6 items-center justify-center rounded-xs text-ink-muted hover:bg-hover hover:text-ink"
        >
          <BookmarkPlus {...ICON} size={14} />
        </button>
      )}
    </div>
  );
}

function NoMatches() {
  return (
    <section aria-labelledby="empty-title" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 id="empty-title" className="text-heading text-ink">
        Nothing matches
      </h2>
      <p className="max-w-sm text-body text-ink-muted">No download here has these words in its name or link.</p>
    </section>
  );
}

const OF_A_TYPE = { title: "Nothing of this type", body: "Downloads of this type show up here." };

function titleOf(view: View): string {
  return isCategory(view) ? (CATEGORIES.find((category) => category.id === view)?.label ?? view) : TITLES[view];
}

function Empty({ view, first }: { view: View; first: boolean }) {
  const copy = isCategory(view) ? OF_A_TYPE : EMPTY[view];
  const theme = useTheme();
  return (
    <section aria-labelledby="empty-title" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {first && (
        <img src={theme === "dark" ? markDark : mark} alt="" width={40} height={42} />
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
      <Button onClick={() => void reload()}>Retry</Button>
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
      <Button variant="quiet" size="icon" icon={X} aria-label="Dismiss" onClick={dismiss} />
    </div>
  );
}

function ClearFinished() {
  const store = useDownloadsStore();
  const shown = useDownloads(hasFinished);
  if (!shown) return null;
  return (
    // A square icon in a narrow window, so the title and the search field keep their room.
    <Button
      icon={ListX}
      title="Clear finished…"
      className="@max-3xl/main:w-[30px] @max-3xl/main:px-0"
      onClick={() => {
        const state = store.getState();
        state.askRemove(finished(state).map((item) => item.id));
      }}
    >
      <span className="@max-3xl/main:sr-only">Clear finished…</span>
    </Button>
  );
}

export function DownloadList() {
  const view = useDownloads((s) => s.view);
  const status = useDownloads((s) => s.status);
  const loadError = useDownloads((s) => s.loadError);
  const total = useDownloads((s) => s.items.length);
  const items = useDownloads(useShallow((s) => visibleItems(s)));
  const openAdd = useDownloads((s) => s.openAdd);
  const searching = useDownloads((s) => s.matches !== null);

  return (
    <main className="@container/main flex min-w-0 flex-1 flex-col bg-surface">
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
        <h1 id="list-title" data-tauri-drag-region tabIndex={-1} className="min-w-0 truncate text-title text-ink outline-none">
          {titleOf(view)}
        </h1>
        <div className="flex min-w-0 items-center gap-4 @max-3xl/main:gap-2">
          <ClearFinished />
          <SearchField />
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              openAdd();
            }}
          >
            Add
          </Button>
          <WindowControls />
        </div>
      </header>
      <Notice />
      <div className="relative flex min-h-0 flex-1">
        <div className="@container flex min-w-0 flex-1 flex-col">
          {status === "error" ? (
            <LoadError message={sentence(loadError ?? "")} />
          ) : status === "ready" && items.length === 0 ? (
            searching ? (
              <NoMatches />
            ) : (
              <Empty view={view} first={total === 0} />
            )
          ) : (
            <DownloadTable title={titleOf(view)} />
          )}
        </div>
        <DetailPanel />
      </div>
      <StatusBar />
    </main>
  );
}
