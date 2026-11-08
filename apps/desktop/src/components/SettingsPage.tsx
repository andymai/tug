import { CircleAlert, FolderOpen, Minus, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import type { Appearance, Settings } from "../backend/backend";
import { sentence, shortDir } from "../lib/format";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { Button } from "./Button";

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

function SpeedLimit({ settings, save }: { settings: Settings; save: (patch: Partial<Settings>) => void }) {
  const fieldId = useId();
  const [draft, setDraft] = useState(formatLimit(settings.speedLimit));
  const [problem, setProblem] = useState<string | null>(null);
  const limited = settings.speedLimit !== null;

  const commit = () => {
    if (draft === formatLimit(settings.speedLimit)) {
      setProblem(null);
      return;
    }
    const value = Number(draft.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setProblem("Enter a speed above zero.");
      return;
    }
    setProblem(null);
    save({ speedLimit: Math.round(value * MB) });
  };

  return (
    <>
      <Row
        label="Limit download speed"
        description="Leave room on the network for everything else."
        control={
          <Switch
            label="Limit download speed"
            checked={limited}
            onChange={(on) => {
              setDraft(on ? formatLimit(DEFAULT_LIMIT) : "");
              setProblem(null);
              save({ speedLimit: on ? DEFAULT_LIMIT : null });
            }}
          />
        }
      />
      {limited && (
        <Row
          label="Speed limit"
          labelFor={fieldId}
          description={problem ?? "Shared by every download."}
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
      <header className="flex h-12 shrink-0 items-center border-b border-line px-4">
        <h1 id="list-title" tabIndex={-1} className="text-title text-ink outline-none">
          Settings
        </h1>
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
            </section>
            <section aria-labelledby="settings-speed">
              <h2 id="settings-speed" className="pb-1 text-label text-ink-muted">
                Speed
              </h2>
              <SpeedLimit settings={settings} save={save} />
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
