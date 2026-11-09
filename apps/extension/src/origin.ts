import type { Api, Cookie } from "./api.js";
import { isWebLink } from "./rules.js";

export interface Origin {
  referrer?: string;
  cookies?: string;
  user_agent?: string;
}

// The browser's default policy, strict-origin-when-cross-origin: another site
// learns only which site sent the request, and plain http learns nothing.
export function referrerFor(link: string, page: string | undefined): string | undefined {
  if (page === undefined || !isWebLink(page) || !isWebLink(link)) return undefined;
  const from = new URL(page);
  const to = new URL(link);
  if (from.protocol === "https:" && to.protocol !== "https:") return undefined;
  if (from.origin !== to.origin) return `${from.origin}/`;
  from.hash = "";
  from.username = "";
  from.password = "";
  return from.href;
}

export function cookieHeader(cookies: readonly Cookie[]): string {
  return [...cookies]
    .sort((a, b) => b.path.length - a.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function originOf(
  api: Api,
  link: string,
  referrer: string | undefined,
  storeId: string | undefined,
  userAgent: string,
): Promise<Origin> {
  const query = storeId === undefined ? { url: link } : { url: link, storeId };
  const cookies = cookieHeader(await api.cookies.getAll(query).catch(() => []));
  const sent = referrerFor(link, referrer);
  return {
    ...(sent === undefined ? {} : { referrer: sent }),
    ...(cookies === "" ? {} : { cookies }),
    user_agent: userAgent,
  };
}
