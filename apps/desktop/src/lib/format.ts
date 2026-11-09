const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 999.5 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${String(Math.round(value))} B`;
  const digits = value >= 99.95 ? 0 : value >= 9.995 ? 1 : 2;
  return `${value.toFixed(digits)} ${UNITS[unit] ?? ""}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`;
}

export function formatLeft(ms: number): string {
  return `${formatDuration(ms)} left`;
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatDate(ms: number): string {
  return DATE.format(ms);
}

const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

export function formatClock(ms: number): string {
  return CLOCK.format(ms);
}

export function formatPercent(received: number, total: number | null): string | null {
  if (total === null || total <= 0) return null;
  return `${String(Math.min(100, Math.floor((received * 100) / total)))}%`;
}

export function percentOf(received: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.min(100, (received * 100) / total);
}

export function shortDir(dir: string): string {
  const inHome = dir.replace(/^(?:\/var)?\/home\/[^/]+\/?/, "").replace(/\/+$/, "");
  return inHome === "" ? "Home" : inHome;
}

export function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function minutesOf(text: string): number | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
