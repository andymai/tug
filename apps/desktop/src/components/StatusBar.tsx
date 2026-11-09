import { ArrowDown, Clock, Gauge, HardDrive } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";

import { formatBytes, formatSpeed } from "../lib/format";
import { openAt } from "../lib/schedule";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { SAMPLES } from "../state/downloads";

const MB = 1 << 20;
const DEFAULT_LIMIT = 10 * MB;
const DISK_EVERY_MS = 30_000;

function Sparkline({ speeds }: { speeds: readonly number[] }) {
  const top = Math.max(1, ...speeds);
  const step = 64 / (SAMPLES - 1);
  const start = SAMPLES - speeds.length;
  const points = speeds.map((speed, at) => `${String((start + at) * step)},${String(15 - (speed / top) * 14)}`).join(" ");
  return (
    <svg aria-hidden="true" width="64" height="16" viewBox="0 0 64 16" className="shrink-0 text-accent @max-xl/main:hidden">
      {speeds.length > 1 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />}
    </svg>
  );
}

export function StatusBar() {
  const { running, queued, paused, speed } = useDownloads(
    useShallow((s) => {
      const by = (state: string) => s.items.filter((item) => item.state === state);
      const downloading = by("downloading");
      return {
        running: downloading.length,
        queued: by("queued").length,
        paused: by("paused").length,
        speed: downloading.reduce((sum, item) => sum + (s.live[item.id]?.speed ?? 0), 0),
      };
    }),
  );
  const speeds = useDownloads((s) => s.speeds);
  const settings = useDownloads((s) => s.settings);
  const savePreference = useDownloads((s) => s.savePreference);
  const diskFree = useDownloads((s) => s.diskFree);
  const checkDisk = useDownloads((s) => s.checkDisk);
  const folder = settings?.downloadDir;
  const lastLimit = useRef(settings?.speedLimit ?? DEFAULT_LIMIT);

  useEffect(() => {
    if (settings?.speedLimit != null) lastLimit.current = settings.speedLimit;
  }, [settings?.speedLimit]);

  useEffect(() => {
    void checkDisk();
    const timer = setInterval(() => void checkDisk(), DISK_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [checkDisk, folder]);

  const now = new Date();
  const slow = settings?.slowHours != null && openAt(settings.slowHours.hours, now) ? settings.slowHours : null;
  const limit = settings?.speedLimit ?? null;
  const inForce = slow === null ? limit : Math.min(slow.limit, limit ?? slow.limit);
  const outside = settings?.schedule != null && !openAt(settings.schedule, now);

  return (
    <section aria-label="Status" className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-surface px-3 text-small whitespace-nowrap text-ink-muted">
      <span className="flex items-center gap-1.5">
        <ArrowDown {...ICON} size={14} />
        <span className="text-mono text-ink">{formatSpeed(speed)}</span>
        <Sparkline speeds={speeds} />
      </span>
      <span className="truncate @max-lg/main:hidden">{`${String(running)} running · ${String(queued)} queued · ${String(paused)} paused`}</span>
      {outside && (
        <span className="flex items-center gap-1.5 truncate">
          <Clock {...ICON} size={14} />
          Outside the scheduled hours
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        aria-pressed={limit !== null}
        title={limit === null ? "Turn the speed limit on" : "Turn the speed limit off"}
        onClick={() => {
          void savePreference({ speedLimit: limit === null ? lastLimit.current : null }, "the speed limit");
        }}
        className="flex h-6 items-center gap-1.5 rounded-xs px-1.5 hover:bg-hover hover:text-ink"
      >
        <Gauge {...ICON} size={14} />
        {inForce === null ? (
          "No limit"
        ) : (
          <span>
            {slow === null ? "Limit " : "Slower hours "}
            <span className="text-mono text-ink">{formatSpeed(inForce)}</span>
          </span>
        )}
      </button>
      {diskFree !== null && (
        <span className="flex items-center gap-1.5 @max-md/main:hidden">
          <HardDrive {...ICON} size={14} />
          <span className="text-mono text-ink">{formatBytes(diskFree)}</span> free
        </span>
      )}
    </section>
  );
}
