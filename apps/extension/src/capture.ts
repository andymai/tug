import type { Api, DownloadItem, MenuClick, PageRequest, Tab } from "./api.js";
import { originOf } from "./origin.js";
import { isWebLink, worthTaking } from "./rules.js";
import { addToTug, type Taken } from "./tug.js";

export const MENU_ID = "download-with-tug";

export type Outcome = "tug" | "browser" | "skipped";

// A form's download can't be fetched again without the form, so it stays in
// the browser; a page request older than this is no longer that download's.
export const FORM_MEMORY_MS = 120_000;

function ignore(): void {
  // A download the user already removed or that finished can't be canceled, erased or resumed.
}

export class Capture {
  readonly #api: Api;
  readonly #userAgent: string;
  readonly #handedBack = new Set<string>();
  readonly #forms = new Map<string, number>();
  readonly #now: () => number;

  constructor(api: Api, userAgent: string, now: () => number = Date.now) {
    this.#api = api;
    this.#userAgent = userAgent;
    this.#now = now;
  }

  requested(request: PageRequest): void {
    if (request.method.toUpperCase() === "GET") return;
    const now = this.#now();
    for (const [url, at] of this.#forms) {
      if (now - at > FORM_MEMORY_MS) this.#forms.delete(url);
    }
    this.#forms.set(request.url, now);
  }

  #fromForm(url: string): boolean {
    const at = this.#forms.get(url);
    return at !== undefined && this.#now() - at <= FORM_MEMORY_MS;
  }

  async created(item: DownloadItem): Promise<Outcome> {
    if (this.#handedBack.delete(item.url) || !worthTaking(item) || this.#fromForm(item.url)) return "skipped";
    const { downloads } = this.#api;
    try {
      await downloads.pause(item.id);
    } catch {
      return "skipped";
    }
    const taken = await this.#send(item.url, item.referrer, item.cookieStoreId, true);
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
    const store = tab?.cookieStoreId;
    const taken = await this.#send(link, info.frameUrl ?? info.pageUrl, store, false);
    if (taken.ok) return "tug";
    // The browser downloads it instead, and this capture must let that download through.
    this.#handedBack.add(link);
    await this.#api.downloads.download(store === undefined ? { url: link } : { url: link, cookieStoreId: store }).catch(() => {
      this.#handedBack.delete(link);
    });
    return "browser";
  }

  async #send(link: string, referrer: string | undefined, storeId: string | undefined, capture: boolean): Promise<Taken> {
    try {
      const origin = await originOf(this.#api, link, referrer, storeId, this.#userAgent);
      return await addToTug(this.#api, [link], origin, capture);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
