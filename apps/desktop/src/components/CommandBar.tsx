import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { type Command, commands, type Group, rank } from "../lib/commands";
import { ICON, STATES } from "../lib/states";
import { useDownloads, useDownloadsStore } from "../state/context";
import { inView } from "../state/downloads";
import { Keys } from "./Kbd";

type Entry = Omit<Command, "group"> & { group: Group | "Go to download" };

const GROUPS: readonly Entry["group"][] = ["Selected download", "Go to download", "Downloads", "Views", "Help"];

function Palette({ choose, labelId }: { choose: (run: () => void) => void; labelId: string }) {
  const store = useDownloadsStore();
  const items = useDownloads((s) => s.items);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const entries = useMemo(() => {
    const found: Entry[] = commands(store)
      .map((command) => ({ command, score: rank(command.title, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ command }) => command);
    if (query.trim() !== "") {
      const downloads = items
        .map((item) => ({ item, score: rank(item.name, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || b.item.addedMs - a.item.addedMs)
        .slice(0, 6)
        .map(
          ({ item }): Entry => ({
            id: `download-${String(item.id)}`,
            title: item.name,
            group: "Go to download",
            icon: STATES[item.state].Icon,
            run: () => {
              const state = store.getState();
              if (!inView(state.view, item)) state.setView("all");
              else state.setPage("downloads");
              state.select(item.id);
              state.requestFocus(item.id);
            },
          }),
        );
      found.push(...downloads);
    }
    return GROUPS.flatMap((group) => found.filter((entry) => entry.group === group));
  }, [store, items, query]);

  const current = Math.min(active, Math.max(0, entries.length - 1));
  const optionId = (index: number) => `${listId}-${String(index)}`;

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + delta + entries.length) % Math.max(1, entries.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[current];
      if (entry) choose(entry.run);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-line px-4">
        <Search {...ICON} className="shrink-0 text-ink-muted" />
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the command bar exists to take a query
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={entries.length > 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-labelledby={labelId}
          spellCheck={false}
          value={query}
          placeholder="Type a command or a file name"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="max-h-[min(400px,60vh)] overflow-y-auto p-2">
        {entries.length === 0 && <p className="px-2 py-3 text-small text-ink-muted">No command or download matches.</p>}
        {GROUPS.map((group) => {
          const inGroup = entries.filter((entry) => entry.group === group);
          if (inGroup.length === 0) return null;
          const headerId = `${listId}-${group.replaceAll(" ", "-")}`;
          return (
            <div key={group} role="group" aria-labelledby={headerId}>
              <div id={headerId} role="presentation" className="px-2 pt-2 pb-1 text-label text-ink-muted">
                {group}
              </div>
              {inGroup.map((entry) => {
                const at = entries.indexOf(entry);
                return (
                  <div
                    key={entry.id}
                    id={optionId(at)}
                    role="option"
                    aria-selected={at === current}
                    tabIndex={-1}
                    onMouseMove={() => {
                      if (at !== current) setActive(at);
                    }}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      choose(entry.run);
                    }}
                    className="flex h-9 cursor-default items-center gap-3 rounded-sm px-2 text-body text-ink aria-selected:bg-selection"
                  >
                    <entry.icon {...ICON} className="shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    {entry.keys && <Keys label={entry.keys.label} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CommandBar() {
  const open = useDownloads((s) => s.overlay === "commands");
  const setOverlay = useDownloads((s) => s.setOverlay);
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const labelId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const choose = (run: () => void) => {
    pending.current = run;
    setOverlay(null);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onClose={() => {
        if (open) setOverlay(null);
        const run = pending.current;
        pending.current = null;
        run?.();
      }}
      className="mx-auto mt-[12vh] mb-auto w-[min(560px,calc(100vw-48px))] overflow-hidden rounded-lg border border-line bg-surface-raised p-0 text-ink shadow-dialog"
    >
      <h2 id={labelId} className="sr-only">
        Command bar
      </h2>
      {open && <Palette choose={choose} labelId={labelId} />}
    </dialog>
  );
}
