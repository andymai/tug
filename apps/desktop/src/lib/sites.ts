import { trimmed } from "./rust";

export function siteOf(input: string): string | null {
  const bare = trimmed(input).replace(/^\*\./, "");
  if (bare === "") return null;
  try {
    const host = new URL(bare.includes("://") ? bare : `https://${bare}`).hostname.replace(/\.$/, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}
