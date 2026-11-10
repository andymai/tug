export type Target = "chromium" | "chrome-web-store" | "firefox";

// The public half of the key that fixes the Chromium extension ID; no private
// half exists, because Chrome on Linux loads only store and unpacked extensions.
export const CHROMIUM_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5X+RWQ2/oLo2gLwVmvOWU/mNiiNE+D93g2KK70NKtzUxIUNGHaB8QvMpkEHNLx7D49yctOohS+vuaoNBdy/cAoczwaCiSPk0rsYtruGoSCQqc1W7TC9Tu4DnQ49KhLo0erD8q+N5PWzWTfz25fL+ptPdkBZsw5W4bTaDf8XALqTpGVDoGG59yjGxjDQkQr6sM9r+ODAxq7cy5x4unWRy0L3QQmuQnqR7LbvyZ4ZF/xOp0ScIW5z0dwY4e4H921a/c81wDHPsH48aIh270NSXxNSOOQJd9oJxmc4wWwz+NQd2a3F9JNI6C9yZelVQsIVPvCOy00lvr6DrznPzqtWE8QIDAQAB";
export const CHROMIUM_ID = "adkjolghaomejbdpmjgloncdniplghfg";
export const FIREFOX_ID = "tug@andymai.github.io";

const ICONS = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" };

export function manifest(target: Target, version: string): Record<string, unknown> {
  const common = {
    manifest_version: 3,
    name: "Tug",
    description: "Hands your downloads to Tug, the fast, resumable download manager for Linux.",
    version,
    icons: ICONS,
    permissions: ["contextMenus", "cookies", "downloads", "nativeMessaging", "storage", "webRequest"],
    host_permissions: ["<all_urls>"],
  };
  if (target !== "firefox") {
    const chromium = {
      ...common,
      minimum_chrome_version: "120",
      background: { service_worker: "main.js", type: "module" },
    };
    // The store gives its item an ID of its own, so the store's package carries no key.
    return target === "chromium" ? { ...chromium, key: CHROMIUM_KEY } : chromium;
  }
  return {
    ...common,
    background: { scripts: ["main.js"], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ID,
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
  };
}
