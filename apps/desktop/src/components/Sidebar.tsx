import { ArrowDown, Check, CircleAlert, Layers, type LucideIcon, Search, Settings } from "lucide-react";
import { useShallow } from "zustand/shallow";

import lockupDark from "../../../../brand/svg/lockup-dark.svg";
import lockup from "../../../../brand/svg/lockup.svg";
import { CATEGORIES } from "../lib/categories";
import { PALETTE_KEYS } from "../lib/commands";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { countFor, type StateView, VIEWS } from "../state/downloads";
import { useTheme } from "../state/theme";
import { Keys } from "./Kbd";

const VIEW_ICONS: Record<StateView, LucideIcon> = {
  all: Layers,
  active: ArrowDown,
  done: Check,
  failed: CircleAlert,
};

function ViewItem({ label, icon: Icon, count, current, onClick }: { label: string; icon: LucideIcon; count: number; current: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={onClick}
        className="group flex h-8 w-full items-center gap-2 rounded-sm px-2 text-body text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-hover aria-[current=page]:bg-selection aria-[current=page]:font-medium"
      >
        <Icon {...ICON} className="text-ink-muted group-hover:text-ink group-aria-[current=page]:text-ink" />
        <span className="flex-1 text-left">{label}</span>
        <span className="text-mono text-ink-muted">{count}</span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const view = useDownloads((s) => s.view);
  const setView = useDownloads((s) => s.setView);
  const setOverlay = useDownloads((s) => s.setOverlay);
  const page = useDownloads((s) => s.page);
  const theme = useTheme();
  const setPage = useDownloads((s) => s.setPage);
  const counts = useDownloads(useShallow((s) => VIEWS.map((v) => countFor(s.items, v.id))));
  const types = useDownloads(useShallow((s) => CATEGORIES.map((category) => countFor(s.items, category.id))));

  return (
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-r border-line bg-bg">
      <div data-tauri-drag-region className="flex h-12 items-center px-4">
        <img data-tauri-drag-region draggable={false} src={theme === "dark" ? lockupDark : lockup} alt="Tug" width={57} height={22} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <nav aria-labelledby="views-label" className="flex flex-col gap-1 px-2 pt-2">
          <h2 id="views-label" className="text-label px-2 pb-1 text-ink-muted">
            Downloads
          </h2>
          <ul className="flex flex-col gap-0.5">
            {VIEWS.map((v, index) => (
              <ViewItem
                key={v.id}
                label={v.label}
                icon={VIEW_ICONS[v.id]}
                count={counts[index] ?? 0}
                current={page === "downloads" && v.id === view}
                onClick={() => {
                  setView(v.id);
                }}
              />
            ))}
          </ul>
        </nav>
        {types.some((count) => count > 0) && (
          <nav aria-labelledby="types-label" className="flex flex-col gap-1 px-2 pt-4">
            <h2 id="types-label" className="text-label px-2 pb-1 text-ink-muted">
              Types
            </h2>
            <ul className="flex flex-col gap-0.5">
              {CATEGORIES.map((category, index) =>
                (types[index] ?? 0) > 0 ? (
                  <ViewItem
                    key={category.id}
                    label={category.label}
                    icon={category.icon}
                    count={types[index] ?? 0}
                    current={page === "downloads" && category.id === view}
                    onClick={() => {
                      setView(category.id);
                    }}
                  />
                ) : null,
              )}
            </ul>
          </nav>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        <button
          type="button"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => {
            setPage("settings");
          }}
          className="group flex h-8 w-full items-center gap-2 rounded-sm px-2 text-body text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-hover aria-[current=page]:bg-selection aria-[current=page]:font-medium"
        >
          <Settings {...ICON} className="text-ink-muted group-hover:text-ink group-aria-[current=page]:text-ink" />
          <span className="flex-1 text-left">Settings</span>
        </button>
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
