import type { Download } from "../backend/backend";

export const SCHEMES = new Set(["http:", "https:", "ftp:", "ftps:"]);

export type LinkCheck =
  | { kind: "ready"; input: string; href: string; name: string; host: string }
  | { kind: "duplicate"; input: string; href: string; name: string; existing: Download }
  | { kind: "scheme"; input: string; scheme: string }
  | { kind: "notLink"; input: string };

export function nameOf(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).at(-1);
  return segment ? decodeURIComponent(segment) : url.hostname;
}

function parse(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function splitLinks(text: string): string[] {
  const tokens = text.split(/\s+/).map((token) => token.replace(/^[(<["']+/, "").replace(/[)>\]"',.;:!?]+$/, ""));
  return [...new Set(tokens.filter((token) => token !== ""))];
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
        : { kind: "ready", input, href: url.href, name: nameOf(url), host: url.hostname },
    );
  }
  return checks;
}

export function findLinks(text: string): string[] {
  return splitLinks(text).filter((token) => {
    const url = parse(token);
    return url !== null && SCHEMES.has(url.protocol);
  });
}

export function linksFromTransfer(data: DataTransfer): string[] {
  const list = data.getData("text/uri-list");
  if (list !== "") {
    return findLinks(
      list
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#"))
        .join("\n"),
    );
  }
  return findLinks(data.getData("text/plain"));
}
