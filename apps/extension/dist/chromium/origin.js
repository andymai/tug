import { isWebLink } from "./rules.js";
export function cookieHeader(cookies) {
    return [...cookies]
        .sort((a, b) => b.path.length - a.path.length)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
}
export async function originOf(api, link, referrer, storeId, userAgent) {
    const query = storeId === undefined ? { url: link } : { url: link, storeId };
    const cookies = cookieHeader(await api.cookies.getAll(query).catch(() => []));
    return {
        ...(referrer !== undefined && isWebLink(referrer) ? { referrer } : {}),
        ...(cookies === "" ? {} : { cookies }),
        user_agent: userAgent,
    };
}
