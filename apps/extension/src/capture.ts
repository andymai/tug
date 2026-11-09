import type { Api, DownloadItem, MenuClick, Tab } from "./api.js";
import { originOf } from "./origin.js";
import { isWebLink, worthTaking } from "./rules.js";
import { addToTug, type Taken } from "./tug.js";

export const MENU_ID = "download-with-tug";

export type Outcome = "tug" | "browser" | "skipped";

function ignore(): void {
  // A download the user already removed or that finished can't be paused or resumed.
}

export class Capture {
  readonly #api: Api;
  readonly #userAgent: string;
  readonly #handedBack = new Set<string>();

  constructor(api: Api, userAgent: string) {
    this.#api = api;
    this.#userAgent = userAgent;
  }

  async created(item: DownloadItem): Promise<Outcome> {
    if (this.#handedBack.delete(item.url) || !worthTaking(item)) return "skipped";
    const { downloads } = this.#api;
    await downloads.pause(item.id).catch(ignore);
    const taken = await this.#send(item.url, item.referrer, item.cookieStoreId);
    if (taken.ok) {
      await downloads.cancel(item.id).catch(ignore);
      await downloads.erase({ id: item.id }).catch(ignore);
      return "tug";
    }
    await downloads.resume(item.id).catch(ignore);
    return "browser";
  }

  async clicked(info: MenuClick, tab?: Tab): Promise<Outcome> {
    const link = info.linkUrl ?? info.srcUrl;
    if (info.menuItemId !== MENU_ID || link === undefined || !isWebLink(link)) return "skipped";
    const taken = await this.#send(link, info.frameUrl ?? info.pageUrl, tab?.cookieStoreId);
    if (taken.ok) return "tug";
    // The browser downloads it instead, and this capture must let that download through.
    this.#handedBack.add(link);
    await this.#api.downloads.download({ url: link }).catch(() => {
      this.#handedBack.delete(link);
    });
    return "browser";
  }

  async #send(link: string, referrer: string | undefined, storeId: string | undefined): Promise<Taken> {
    try {
      const origin = await originOf(this.#api, link, referrer, storeId, this.#userAgent);
      return await addToTug(this.#api, [link], origin);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
