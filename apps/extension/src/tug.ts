import type { Api } from "./api.js";
import type { Origin } from "./origin.js";

export const HOST = "io.github.andymai.tug";

export type Taken = { ok: true } | { ok: false; reason: string };

let next = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UNREADABLE: Taken = { ok: false, reason: "Tug sent an answer it can't read" };

export async function addToTug(api: Api, urls: readonly string[], origin: Origin, capture: boolean): Promise<Taken> {
  next += 1;
  const message = { id: next, type: "add", urls, ...origin, ...(capture ? { capture } : {}) };
  const reply = await api.runtime.sendNativeMessage(HOST, message);
  if (!isRecord(reply)) return UNREADABLE;
  if (reply.ok !== true) {
    return { ok: false, reason: typeof reply.error === "string" ? reply.error : "Tug refused the link" };
  }
  const { added, failed } = reply;
  if (!Array.isArray(added) || !Array.isArray(failed)) return UNREADABLE;
  const first: unknown = failed[0];
  if (first !== undefined) {
    return { ok: false, reason: isRecord(first) && typeof first.reason === "string" ? first.reason : "Tug couldn't add the link" };
  }
  return added.length === urls.length ? { ok: true } : UNREADABLE;
}
