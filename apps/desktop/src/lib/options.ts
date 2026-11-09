const MB = 1 << 20;
// The same bound as the engine's MAX_CONNECTIONS.
export const MAX_CONNECTIONS = 32;

export type Parsed = { ok: true; value: number | null } | { ok: false; problem: string };

// An empty field takes Tug's own value.
export function parseConnections(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONNECTIONS) {
    return { ok: false, problem: `Enter 1 to ${String(MAX_CONNECTIONS)} connections.` };
  }
  return { ok: true, value };
}

// In MB/s, as Settings takes it; an empty field is no limit of its own.
export function parseLimit(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return { ok: false, problem: "Enter a speed above zero." };
  return { ok: true, value: Math.max(1, Math.round(value * MB)) };
}

export function limitText(bytes: number | null): string {
  return bytes === null ? "" : String(Number((bytes / MB).toFixed(2)));
}
