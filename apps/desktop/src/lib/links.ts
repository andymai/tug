import type { Download } from "../backend/backend";

export const SCHEMES = new Set(["http:", "https:", "ftp:", "ftps:", "magnet:"]);

export type LinkCheck =
  | { kind: "ready"; input: string; href: string; name: string; host: string }
  | { kind: "duplicate"; input: string; href: string; name: string; existing: Download }
  | { kind: "scheme"; input: string; scheme: string }
  | { kind: "notLink"; input: string };

export function nameOf(url: URL): string {
  if (url.protocol === "magnet:") return url.searchParams.get("dn")?.trim() || "magnet link";
  const segment = url.pathname.split("/").filter(Boolean).at(-1);
  if (!segment) return url.hostname;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parse(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function splitLinks(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter((token) => token !== ""))];
}

const count = (text: string, char: string) => text.split(char).length - 1;

function trimProse(token: string): string {
  let link = token.replace(/^[^A-Za-z]+/, "");
  for (;;) {
    const last = link.at(-1);
    const unbalanced =
      (last === ")" && count(link, ")") > count(link, "(")) || (last === "]" && count(link, "]") > count(link, "["));
    if (last !== undefined && (unbalanced || `.,;:!?'">`.includes(last))) link = link.slice(0, -1);
    else return link;
  }
}

function downloadable(link: string): boolean {
  const url = parse(link);
  return url !== null && SCHEMES.has(url.protocol);
}

export function checkLinks(text: string, items: readonly Download[]): LinkCheck[] {
  const known = new Map(items.map((item) => [item.url, item]));
  const seen = new Set<string>();
  const checks: LinkCheck[] = [];
  for (const input of splitLinks(text)) {
    const url = parse(input);
    if (!url) {
      checks.push({ kind: "notLink", input });
      continue;
    }
    if (!SCHEMES.has(url.protocol)) {
      checks.push({ kind: "scheme", input, scheme: url.protocol.slice(0, -1) });
      continue;
    }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const existing = known.get(url.href);
    checks.push(
      existing
        ? { kind: "duplicate", input, href: url.href, name: nameOf(url), existing }
        : { kind: "ready", input, href: url.href, name: nameOf(url), host: url.protocol === "magnet:" ? "torrent" : url.hostname },
    );
  }
  return checks;
}

export function findLinks(text: string): string[] {
  return [...new Set(splitLinks(text).map(trimProse))].filter(downloadable);
}

export function linksFromTransfer(data: DataTransfer): string[] {
  const list = data.getData("text/uri-list");
  if (list === "") return findLinks(data.getData("text/plain"));
  const entries = list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return [...new Set(entries)].filter(downloadable);
}
