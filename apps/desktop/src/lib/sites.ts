export function siteOf(input: string): string | null {
  const bare = input.trim().replace(/^\*\./, "");
  if (bare === "") return null;
  try {
    const host = new URL(bare.includes("://") ? bare : `https://${bare}`).hostname.replace(/\.$/, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}
