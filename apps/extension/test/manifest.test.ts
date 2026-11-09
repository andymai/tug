import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHROMIUM_ID, CHROMIUM_KEY, FIREFOX_ID, manifest } from "../src/manifest.ts";
import { HOST } from "../src/tug.ts";

const registration = readFileSync(
  join(import.meta.dirname, "..", "..", "desktop", "src-tauri", "src", "browsers.rs"),
  "utf8",
);

function extensionId(key: string): string {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return digest.replace(/[0-9a-f]/g, (c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)));
}

describe("manifests", () => {
  it("the Chromium key gives the ID that Tug's host manifest allows", () => {
    expect(extensionId(CHROMIUM_KEY)).toBe(CHROMIUM_ID);
    expect(registration).toContain(`"chrome-extension://${CHROMIUM_ID}/"`);
    expect(manifest("chromium", "1.2.3")).toMatchObject({ key: CHROMIUM_KEY });
  });

  it("the Firefox ID and the host name match Tug's registration", () => {
    expect(registration).toContain(`"${FIREFOX_ID}"`);
    expect(registration).toContain(`pub const HOST_NAME: &str = "${HOST}";`);
    expect(manifest("firefox", "1.2.3")).toMatchObject({
      browser_specific_settings: { gecko: { id: FIREFOX_ID } },
    });
  });

  it("each browser gets its own background, the same permissions and the version", () => {
    const chromium = manifest("chromium", "1.2.3");
    const firefox = manifest("firefox", "1.2.3");
    expect(chromium.background).toEqual({ service_worker: "main.js", type: "module" });
    expect(firefox.background).toEqual({ scripts: ["main.js"], type: "module" });
    for (const built of [chromium, firefox]) {
      expect(built).toMatchObject({
        manifest_version: 3,
        version: "1.2.3",
        permissions: ["contextMenus", "cookies", "downloads", "nativeMessaging", "webRequest"],
        host_permissions: ["<all_urls>"],
      });
    }
    expect(firefox).not.toHaveProperty("key");
  });

  it("the extension's version follows the release", () => {
    const own = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string };
    const release = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "..", "..", ".release-please-manifest.json"), "utf8"),
    ) as Record<string, string>;
    expect(own.version).toBe(release["."]);
  });
});
