import { ArrowDown, Check, CircleAlert, Layers, type LucideIcon, Search } from "lucide-react";
import { useShallow } from "zustand/shallow";

import lockupDark from "../../../../brand/svg/lockup-dark.svg";
import lockup from "../../../../brand/svg/lockup.svg";
import { PALETTE_KEYS } from "../lib/commands";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { countFor, type View, VIEWS } from "../state/downloads";
import { Keys } from "./Kbd";

const VIEW_ICONS: Record<View, LucideIcon> = {
  all: Layers,
  active: ArrowDown,
  done: Check,
  failed: CircleAlert,
};

export function Sidebar() {
  const view = useDownloads((s) => s.view);
  const setView = useDownloads((s) => s.setView);
  const setOverlay = useDownloads((s) => s.setOverlay);
  const counts = useDownloads(useShallow((s) => VIEWS.map((v) => countFor(s.items, v.id))));

  return (
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-r border-line bg-bg">
      <div className="flex h-12 items-center px-4">
        <picture>
          <source srcSet={lockupDark} media="(prefers-color-scheme: dark)" />
          <img src={lockup} alt="Tug" width={57} height={22} />
        </picture>
      </div>
      <nav aria-labelledby="views-label" className="flex flex-col gap-1 px-2 pt-2">
        <h2 id="views-label" className="text-label px-2 pb-1 text-ink-muted">
          Downloads
        </h2>
        <ul className="flex flex-col gap-0.5">
          {VIEWS.map((v, index) => {
            const Icon = VIEW_ICONS[v.id];
            const current = v.id === view;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  aria-current={current ? "page" : undefined}
                  onClick={() => {
                    setView(v.id);
                  }}
                  className="group flex h-8 w-full items-center gap-2 rounded-sm px-2 text-body text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-hover aria-[current=page]:bg-selection aria-[current=page]:font-medium"
                >
                  <Icon {...ICON} className="text-ink-muted group-hover:text-ink group-aria-[current=page]:text-ink" />
                  <span className="flex-1 text-left">{v.label}</span>
                  <span className="text-mono text-ink-muted">{counts[index]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto p-2">
        <button
          type="button"
          onClick={() => {
            setOverlay("commands");
          }}
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-body text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-hover hover:text-ink"
        >
          <Search {...ICON} />
          <span className="flex-1 text-left">Commands</span>
          <Keys label={PALETTE_KEYS.label} />
        </button>
      </div>
    </aside>
  );
}
