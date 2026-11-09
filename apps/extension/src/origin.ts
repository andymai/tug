import type { Api, Cookie } from "./api.js";
import { isWebLink } from "./rules.js";

export interface Origin {
  referrer?: string;
  cookies?: string;
  user_agent?: string;
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
  return {
    ...(referrer !== undefined && isWebLink(referrer) ? { referrer } : {}),
    ...(cookies === "" ? {} : { cookies }),
    user_agent: userAgent,
  };
}
