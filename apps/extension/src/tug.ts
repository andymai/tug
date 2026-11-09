import type { Api } from "./api.js";
import type { Origin } from "./origin.js";

export const HOST = "io.github.andymai.tug";

export type Taken = { ok: true } | { ok: false; reason: string };

let next = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function reasonOf(failed: unknown): string | undefined {
  if (!Array.isArray(failed) || failed.length === 0) return undefined;
  const first: unknown = failed[0];
  return isRecord(first) && typeof first.reason === "string" ? first.reason : "Tug couldn't add the link";
}

export async function addToTug(api: Api, urls: readonly string[], origin: Origin): Promise<Taken> {
  next += 1;
  const reply = await api.runtime.sendNativeMessage(HOST, { id: next, type: "add", urls, ...origin });
  if (!isRecord(reply)) return { ok: false, reason: "Tug sent an answer it can't read" };
  if (reply.ok !== true) {
    return { ok: false, reason: typeof reply.error === "string" ? reply.error : "Tug refused the link" };
  }
  const reason = reasonOf(reply.failed);
  return reason === undefined ? { ok: true } : { ok: false, reason };
}
