import { CircleAlert, FolderOpen, Globe, Minus, Plus, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import type { Appearance, Schedule, Settings } from "../backend/backend";
import { clock, minutesOf, sentence, shortDir } from "../lib/format";
import { siteOf } from "../lib/sites";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { Button } from "./Button";
import { WindowControls } from "./WindowControls";

const MB = 1 << 20;
const DEFAULT_LIMIT = 10 * MB;

function formatLimit(bytes: number | null): string {
  return bytes === null ? "" : String(Number((bytes / MB).toFixed(2)));
}

function Row({ label, description, control, labelFor }: { label: string; description: string; control: ReactNode; labelFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-4 first:border-t-0">
      <div className="min-w-0 flex-1 basis-60">
        {labelFor === undefined ? (
          <p className="text-body-strong text-ink">{label}</p>
        ) : (
          <label htmlFor={labelFor} className="text-body-strong text-ink">
            {label}
          </label>
        )}
        <p className="text-small text-ink-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        onChange(!checked);
      }}
      className="relative h-5 w-9 shrink-0 rounded-full border border-control-border bg-surface-sunken transition-colors duration-(--duration-fast) ease-(--ease-out) aria-checked:border-primary aria-checked:bg-primary"
    >
      <span
        aria-hidden="true"
        className={`absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 rounded-full transition-transform duration-(--duration-fast) ease-(--ease-out) ${checked ? "translate-x-4 bg-on-primary" : "bg-ink-muted"}`}
      />
    </button>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <Button
        size="icon"
        icon={Minus}
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => {
          onChange(value - 1);
        }}
      />
      <output aria-live="polite" className="w-8 text-center text-mono-strong text-ink">
        {value}
      </output>
      <Button
        size="icon"
        icon={Plus}
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => {
          onChange(value + 1);
        }}
      />
    </div>
  );
}

const APPEARANCES: readonly { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function AppearanceChoice({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const at = APPEARANCES.findIndex((option) => option.value === value);
    const next = APPEARANCES[(at + delta + APPEARANCES.length) % APPEARANCES.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Appearance"
      className="flex gap-0.5 rounded-sm border border-control-border bg-surface p-0.5"
    >
      {APPEARANCES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onKeyDown={move}
          onClick={() => {
            onChange(option.value);
          }}
          className="h-6 rounded-xs px-3 text-small font-medium text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-ink aria-checked:bg-selection aria-checked:text-ink"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A speed in MB/s, saved when the field loses focus or on Enter.
function LimitRow({ label, description, bytes, onChange }: { label: string; description: string; bytes: number; onChange: (bytes: number) => void }) {
  const fieldId = useId();
  const [draft, setDraft] = useState(formatLimit(bytes));
  const [problem, setProblem] = useState<string | null>(null);

  const commit = () => {
    if (draft === formatLimit(bytes)) {
      setProblem(null);
      return;
    }
    const value = Number(draft.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setProblem("Enter a speed above zero.");
      return;
    }
    setProblem(null);
    onChange(Math.round(value * MB));
  };

  return (
    <Row
      label={label}
      labelFor={fieldId}
      description={problem ?? description}
      control={
        <>
          <input
            id={fieldId}
            inputMode="decimal"
            value={draft}
            aria-invalid={problem !== null}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            className="h-[30px] w-20 rounded-sm border border-control-border bg-surface px-2 text-right text-mono text-ink aria-invalid:border-state-error"
          />
          <span className="text-mono text-ink-muted">MB/s</span>
        </>
      }
    />
  );
}

function SpeedLimit({ settings, save }: { settings: Settings; save: (patch: Partial<Settings>) => void }) {
  return (
    <>
      <Row
        label="Limit download speed"
        description="Leave room on the network for everything else."
        control={
          <Switch
            label="Limit download speed"
            checked={settings.speedLimit !== null}
            onChange={(on) => {
              save({ speedLimit: on ? DEFAULT_LIMIT : null });
            }}
          />
        }
      />
      {settings.speedLimit !== null && (
        <LimitRow
          label="Speed limit"
          description="Shared by every download."
          bytes={settings.speedLimit}
          onChange={(speedLimit) => {
            save({ speedLimit });
          }}
        />
      )}
    </>
  );
}

const EVERY_DAY = 0b111_1111;
const NIGHTS: Schedule = { days: EVERY_DAY, start: 60, stop: 7 * 60 };
const WORKDAYS: Schedule = { days: 0b001_1111, start: 9 * 60, stop: 17 * 60 };
const SLOW_LIMIT = 2 * MB;
const DAYS = [
  { name: "Monday", letter: "M" },
  { name: "Tuesday", letter: "T" },
  { name: "Wednesday", letter: "W" },
  { name: "Thursday", letter: "T" },
  { name: "Friday", letter: "F" },
  { name: "Saturday", letter: "S" },
  { name: "Sunday", letter: "S" },
] as const;

interface HoursNames {
  hours: string;
  until: string;
  days: string;
  during: string;
}

// Mounted fresh each time its section turns on, so the drafts start from the saved hours.
function HoursRows({ schedule, names, onChange }: { schedule: Schedule; names: HoursNames; onChange: (schedule: Schedule) => void }) {
  const startId = useId();
  const [drafts, setDrafts] = useState({ start: clock(schedule.start), stop: clock(schedule.stop) });
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (which: "start" | "stop") => {
    const value = minutesOf(drafts[which]);
    if (value === null) {
      setProblem("Enter a time like 23:00.");
      return;
    }
    const next = { ...schedule, [which]: value };
    if (next.start === next.stop) {
      setProblem("Pick two different times.");
      return;
    }
    setProblem(null);
    setDrafts((current) => ({ ...current, [which]: clock(value) }));
    if (value !== schedule[which]) onChange(next);
  };

  const field = (which: "start" | "stop", id?: string) => (
    <input
      id={id}
      aria-label={id === undefined ? names.until : undefined}
      inputMode="numeric"
      value={drafts[which]}
      aria-invalid={problem !== null}
      onChange={(event) => {
        setDrafts((current) => ({ ...current, [which]: event.target.value }));
      }}
      onBlur={() => {
        commit(which);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(which);
      }}
      className="h-[30px] w-16 rounded-sm border border-control-border bg-surface px-2 text-center text-mono text-ink aria-invalid:border-state-error"
    />
  );

  return (
    <>
      <Row
        label={names.hours}
        labelFor={startId}
        description={problem ?? (schedule.stop < schedule.start ? "These hours go on past midnight." : names.during)}
        control={
          <>
            {field("start", startId)}
            <span className="text-small text-ink-muted">to</span>
            {field("stop")}
          </>
        }
      />
      <Row
        label={names.days}
        description="The days on which the hours start."
        control={
          <div role="group" aria-label={names.days} className="flex gap-0.5 rounded-sm border border-control-border bg-surface p-0.5">
            {DAYS.map((day, index) => {
              const bit = 1 << index;
              const on = (schedule.days & bit) !== 0;
              return (
                <button
                  key={day.name}
                  type="button"
                  aria-pressed={on}
                  aria-label={day.name}
                  title={day.name}
                  disabled={on && schedule.days === bit}
                  onClick={() => {
                    onChange({ ...schedule, days: schedule.days ^ bit });
                  }}
                  className="h-6 w-7 rounded-xs text-small font-medium text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-ink aria-pressed:bg-selection aria-pressed:text-ink"
                >
                  {day.letter}
                </button>
              );
            })}
          </div>
        }
      />
    </>
  );
}

function Hours({ schedule, save }: { schedule: Schedule | null; save: (patch: Partial<Settings>) => void }) {
  return (
    <>
      <Row
        label="Download at set times"
        description="Outside these hours, downloads wait in the queue."
        control={
          <Switch
            label="Download at set times"
            checked={schedule !== null}
            onChange={(on) => {
              save({ schedule: on ? NIGHTS : null });
            }}
          />
        }
      />
      {schedule !== null && (
        <HoursRows
          schedule={schedule}
          names={{ hours: "Hours", until: "Until", days: "Days", during: "Downloads run from the first time until the second." }}
          onChange={(next) => {
            save({ schedule: next });
          }}
        />
      )}
    </>
  );
}

function SlowerHours({ settings, save }: { settings: Settings; save: (patch: Partial<Settings>) => void }) {
  const slow = settings.slowHours;
  return (
    <>
      <Row
        label="Slower at set hours"
        description="A lower limit for busy hours, like the working day."
        control={
          <Switch
            label="Slower at set hours"
            checked={slow !== null}
            onChange={(on) => {
              save({ slowHours: on ? { limit: SLOW_LIMIT, hours: WORKDAYS } : null });
            }}
          />
        }
      />
      {slow !== null && (
        <>
          <LimitRow
            label="Slower limit"
            description="When both limits apply, the lower one holds."
            bytes={slow.limit}
            onChange={(limit) => {
              save({ slowHours: { ...slow, limit } });
            }}
          />
          <HoursRows
            schedule={slow.hours}
            names={{ hours: "Slower hours", until: "Slower until", days: "Slower days", during: "The lower limit holds from the first time until the second." }}
            onChange={(hours) => {
              save({ slowHours: { ...slow, hours } });
            }}
          />
        </>
      )}
    </>
  );
}

function ExcludedSites({ sites, save }: { sites: readonly string[]; save: (patch: Partial<Settings>) => void }) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const site = siteOf(draft);
    if (site === null) {
      setProblem("Enter a site, like example.org.");
      return;
    }
    setProblem(null);
    setDraft("");
    if (!sites.includes(site)) save({ excludedSites: [...sites, site] });
  };

  return (
    <>
      <Row
        label="Sites Tug leaves to the browser"
        labelFor={fieldId}
        description={problem ?? "Downloads from these sites and their pages stay in the browser."}
        control={
          <>
            <input
              id={fieldId}
              value={draft}
              placeholder="example.org"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={problem !== null}
              onChange={(event) => {
                setDraft(event.target.value);
                if (problem !== null) setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") add();
              }}
              className="h-[30px] w-48 rounded-sm border border-control-border bg-surface px-2 text-mono text-ink placeholder:text-ink-faint aria-invalid:border-state-error"
            />
            <Button icon={Plus} disabled={draft.trim() === ""} onClick={add}>
              Add
            </Button>
          </>
        }
      />
      {sites.length > 0 && (
        <ul aria-label="Sites Tug leaves to the browser" className="-mt-2 flex flex-col pb-2">
          {sites.map((site) => (
            <li key={site} className="flex h-9 items-center gap-3 rounded-sm pr-1 pl-2 hover:bg-hover">
              <Globe {...ICON} className="shrink-0 text-ink-muted" />
              <span className="min-w-0 flex-1 truncate text-mono text-ink">{site}</span>
              <Button
                size="icon"
                variant="quiet"
                icon={X}
                aria-label={`Remove ${site}`}
                onClick={() => {
                  save({ excludedSites: sites.filter((entry) => entry !== site) });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SettingsPage() {
  const settings = useDownloads((s) => s.settings);
  const error = useDownloads((s) => s.settingsError);
  const saveSettings = useDownloads((s) => s.saveSettings);
  const chooseFolder = useDownloads((s) => s.chooseFolder);
  const save = (patch: Partial<Settings>) => void saveSettings(patch);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
        <h1 id="list-title" data-tauri-drag-region tabIndex={-1} className="text-title text-ink outline-none">
          Settings
        </h1>
        <WindowControls />
      </header>
      {error !== null && (
        <p role="alert" className="flex items-center gap-2 border-b border-line px-4 py-2 text-small text-ink">
          <CircleAlert {...ICON} className="shrink-0 text-state-error" />
          {sentence(error)}
        </p>
      )}
      {settings !== null && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-6">
            <section aria-labelledby="settings-downloads">
              <h2 id="settings-downloads" className="pb-1 text-label text-ink-muted">
                Downloads
              </h2>
              <Row
                label="Download folder"
                description={`New downloads save to ${shortDir(settings.downloadDir)}.`}
                control={
                  <Button icon={FolderOpen} onClick={() => void chooseFolder()} title={settings.downloadDir}>
                    Change folder
                  </Button>
                }
              />
              <Row
                label="Connections per download"
                description="More connections can be faster when a server allows them."
                control={
                  <Stepper
                    label="Connections"
                    value={settings.connections}
                    min={1}
                    max={32}
                    onChange={(connections) => {
                      save({ connections });
                    }}
                  />
                }
              />
              <Row
                label="Downloads at once"
                description="Others wait in the queue and start in order."
                control={
                  <Stepper
                    label="Downloads"
                    value={settings.maxActive}
                    min={1}
                    max={16}
                    onChange={(maxActive) => {
                      save({ maxActive });
                    }}
                  />
                }
              />
            </section>
            <section aria-labelledby="settings-speed">
              <h2 id="settings-speed" className="pb-1 text-label text-ink-muted">
                Speed
              </h2>
              <SpeedLimit settings={settings} save={save} />
              <SlowerHours settings={settings} save={save} />
            </section>
            <section aria-labelledby="settings-schedule">
              <h2 id="settings-schedule" className="pb-1 text-label text-ink-muted">
                Schedule
              </h2>
              <Hours schedule={settings.schedule} save={save} />
            </section>
            <section aria-labelledby="settings-browsers">
              <h2 id="settings-browsers" className="pb-1 text-label text-ink-muted">
                Browsers
              </h2>
              <Row
                label="Ask before each browser download"
                description="When this is off, downloads from the browser start right away."
                control={
                  <Switch
                    label="Ask before each browser download"
                    checked={settings.confirmCaptures}
                    onChange={(confirmCaptures) => {
                      save({ confirmCaptures });
                    }}
                  />
                }
              />
              <ExcludedSites sites={settings.excludedSites} save={save} />
            </section>
            <section aria-labelledby="settings-appearance">
              <h2 id="settings-appearance" className="pb-1 text-label text-ink-muted">
                Appearance
              </h2>
              <Row
                label="Theme"
                description="System follows your desktop's light or dark setting."
                control={
                  <AppearanceChoice
                    value={settings.appearance}
                    onChange={(appearance) => {
                      save({ appearance });
                    }}
                  />
                }
              />
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
