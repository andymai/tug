import type { DownloadItem } from "./api.js";

export const MIN_SIZE = 1 << 20;

export function isWebLink(link: string): boolean {
  try {
    const { protocol } = new URL(link);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function worthTaking(item: DownloadItem): boolean {
  if (item.incognito === true) return false;
  if (item.state !== undefined && item.state !== "in_progress") return false;
  if (!isWebLink(item.url)) return false;
  const size = item.totalBytes ?? 0;
  return size <= 0 || size >= MIN_SIZE;
}
