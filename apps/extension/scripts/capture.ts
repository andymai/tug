import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { chromium } from "playwright";

declare const chrome: { downloads: { search(query: object): Promise<{ url: string }[]> } };

const [server, tug, profile] = process.argv.slice(2);
if (server === undefined || tug === undefined || profile === undefined) {
  throw new Error("usage: capture.ts <server> <tug> <profile>");
}
const extension = join(import.meta.dirname, "..", "dist", "chromium");

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Chromium writes Local State on its first run; Tug registers only browsers that ran.
const first = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true });
await first.close();
const registered = execFileSync(tug, ["browsers"], { encoding: "utf8" });
if (!/^Chromium +Registered$/m.test(registered)) fail(`tug browsers: ${registered}`);
console.log("ok: tug browsers registers the Chromium profile");

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await context.addCookies([{ name: "session", value: "abc123", url: server }]);
  const page = await context.newPage();
  await page.goto(`${server}/page.html`);
  await page.click("#file");

  const deadline = Date.now() + 40_000;
  let listed = "";
  while (!listed.includes("captured.bin")) {
    if (Date.now() > deadline) fail(`Tug never listed captured.bin: ${listed}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      listed = execFileSync(tug, ["list", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      listed = "";
    }
  }
  console.log("ok: a clicked download reaches Tug, which the host started");

  const left = await worker.evaluate(async () => {
    const items = await chrome.downloads.search({});
    return items.filter((item) => item.url.endsWith("/captured.bin")).length;
  });
  if (left !== 0) fail(`the browser still lists ${String(left)} download(s)`);
  console.log("ok: the browser lets go of the download");
} finally {
  await context.close();
}
