import { describe, expect, it, vi } from "vitest";

import { start } from "../src/background.ts";
import { Capture, MENU_ID } from "../src/capture.ts";
import { cookieHeader } from "../src/origin.ts";
import { MIN_SIZE } from "../src/rules.ts";
import { HOST } from "../src/tug.ts";
import { fakeBrowser } from "./fake.ts";

const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0";
const ISO = "https://cdn.example.org/fedora.iso";

function download(overrides: Partial<Parameters<Capture["created"]>[0]> = {}) {
  return { id: 7, url: ISO, referrer: "https://example.org/get", totalBytes: 5 * MIN_SIZE, state: "in_progress", ...overrides };
}

describe("capture", () => {
  it("hands a download to Tug with its origin, then takes it out of the browser", async () => {
    const fake = fakeBrowser({
      cookies: [
        { name: "site", value: "1", path: "/" },
        { name: "files", value: "2", path: "/files" },
      ],
    });
    const capture = new Capture(fake.api, UA);

    expect(await capture.created(download())).toBe("tug");
    expect(fake.calls).toEqual(["pause 7", `native ${HOST}`, "cancel 7", "erase 7"]);
    expect(fake.sent).toEqual([
      {
        id: expect.any(Number) as number,
        type: "add",
        urls: [ISO],
        referrer: "https://example.org/get",
        cookies: "files=2; site=1",
        user_agent: UA,
      },
    ]);
    expect(fake.cookieQueries).toEqual([{ url: ISO }]);
  });

  it.each([
    ["Tug refuses", () => Promise.resolve({ ok: false, error: "Tug didn't start in time" })],
    ["Tug can't add the link", () => Promise.resolve({ ok: true, added: [], failed: [{ url: ISO, reason: "no" }] })],
    ["the host is missing", () => Promise.reject(new Error("Specified native messaging host not found."))],
    ["the answer is unreadable", () => Promise.resolve("?")],
  ])("leaves the download to the browser when %s", async (_, reply) => {
    const fake = fakeBrowser({ reply });
    expect(await new Capture(fake.api, UA).created(download())).toBe("browser");
    expect(fake.calls).toEqual(["pause 7", `native ${HOST}`, "resume 7"]);
  });

  it.each([
    ["a small file", { totalBytes: MIN_SIZE - 1 }],
    ["a private window", { incognito: true }],
    ["a finished download", { state: "complete" }],
    ["a blob link", { url: "blob:https://example.org/1234" }],
    ["a data link", { url: "data:text/plain,hi" }],
  ])("lets the browser keep %s", async (_, overrides) => {
    const fake = fakeBrowser();
    expect(await new Capture(fake.api, UA).created(download(overrides))).toBe("skipped");
    expect(fake.calls).toEqual([]);
  });

  it("takes a download whose size the browser doesn't know yet", async () => {
    const fake = fakeBrowser();
    expect(await new Capture(fake.api, UA).created(download({ totalBytes: -1 }))).toBe("tug");
  });

  it("sends no referrer that isn't a web page, and no empty cookies", async () => {
    const fake = fakeBrowser();
    await new Capture(fake.api, UA).created(download({ referrer: "about:blank" }));
    expect(fake.sent[0]).toEqual({ id: expect.any(Number) as number, type: "add", urls: [ISO], user_agent: UA });
  });

  it("reads the cookies of the download's own container", async () => {
    const fake = fakeBrowser();
    await new Capture(fake.api, UA).created(download({ cookieStoreId: "firefox-container-2" }));
    expect(fake.cookieQueries).toEqual([{ url: ISO, storeId: "firefox-container-2" }]);
  });
});

describe("Download with Tug", () => {
  it("adds the menu item on install", () => {
    const fake = fakeBrowser();
    start(fake.api, UA);
    fake.install();
    expect(fake.menus).toEqual([
      { id: MENU_ID, title: "Download with Tug", contexts: ["link", "image", "video", "audio"] },
    ]);
  });

  it("sends the link with its frame as the referrer and the tab's cookies", async () => {
    const fake = fakeBrowser();
    const capture = new Capture(fake.api, UA);
    const outcome = await capture.clicked(
      { menuItemId: MENU_ID, linkUrl: ISO, pageUrl: "https://example.org/", frameUrl: "https://example.org/frame" },
      { cookieStoreId: "firefox-container-1" },
    );
    expect(outcome).toBe("tug");
    expect(fake.sent[0]).toMatchObject({ urls: [ISO], referrer: "https://example.org/frame" });
    expect(fake.cookieQueries).toEqual([{ url: ISO, storeId: "firefox-container-1" }]);
    expect(fake.calls).toEqual([`native ${HOST}`]);
  });

  it("takes an image's source when there is no link", async () => {
    const fake = fakeBrowser();
    const image = "https://example.org/photo.jpg";
    await new Capture(fake.api, UA).clicked({ menuItemId: MENU_ID, srcUrl: image, pageUrl: "https://example.org/" });
    expect(fake.sent[0]).toMatchObject({ urls: [image], referrer: "https://example.org/" });
  });

  it("lets the browser download the link when Tug can't, and doesn't capture that download", async () => {
    const fake = fakeBrowser({ reply: () => Promise.reject(new Error("no host")) });
    const capture = new Capture(fake.api, UA);
    expect(await capture.clicked({ menuItemId: MENU_ID, linkUrl: ISO })).toBe("browser");
    expect(fake.calls).toEqual([`native ${HOST}`, `download ${ISO}`]);

    expect(await capture.created(download())).toBe("skipped");
    expect(await capture.created(download({ id: 8 }))).toBe("browser");
  });

  it("ignores other menu items and links it can't download", async () => {
    const fake = fakeBrowser();
    const capture = new Capture(fake.api, UA);
    expect(await capture.clicked({ menuItemId: "other", linkUrl: ISO })).toBe("skipped");
    expect(await capture.clicked({ menuItemId: MENU_ID, linkUrl: "mailto:me@example.org" })).toBe("skipped");
    expect(fake.calls).toEqual([]);
  });
});

describe("wiring", () => {
  it("routes browser events to the capture", async () => {
    const fake = fakeBrowser();
    const capture = start(fake.api, UA);
    const created = vi.spyOn(capture, "created");
    const clicked = vi.spyOn(capture, "clicked");
    fake.create(download());
    fake.click({ menuItemId: MENU_ID, linkUrl: ISO }, { cookieStoreId: "x" });
    await vi.waitFor(() => {
      expect(fake.calls).toContain("erase 7");
    });
    expect(created).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledWith({ menuItemId: MENU_ID, linkUrl: ISO }, { cookieStoreId: "x" });
  });
});

describe("cookieHeader", () => {
  it("puts longer paths first, as browsers do", () => {
    expect(
      cookieHeader([
        { name: "a", value: "1", path: "/" },
        { name: "b", value: "2", path: "/x/y" },
        { name: "c", value: "3", path: "/x" },
      ]),
    ).toBe("b=2; c=3; a=1");
  });
});
