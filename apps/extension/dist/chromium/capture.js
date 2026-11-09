import { originOf } from "./origin.js";
import { isWebLink, worthTaking } from "./rules.js";
import { addToTug } from "./tug.js";
export const MENU_ID = "download-with-tug";
function ignore() {
    // A download the user already removed or that finished can't be paused or resumed.
}
export class Capture {
    #api;
    #userAgent;
    #handedBack = new Set();
    constructor(api, userAgent) {
        this.#api = api;
        this.#userAgent = userAgent;
    }
    async created(item) {
        if (this.#handedBack.delete(item.url) || !worthTaking(item))
            return "skipped";
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
    async clicked(info, tab) {
        const link = info.linkUrl ?? info.srcUrl;
        if (info.menuItemId !== MENU_ID || link === undefined || !isWebLink(link))
            return "skipped";
        const taken = await this.#send(link, info.frameUrl ?? info.pageUrl, tab?.cookieStoreId);
        if (taken.ok)
            return "tug";
        // The browser downloads it instead, and this capture must let that download through.
        this.#handedBack.add(link);
        await this.#api.downloads.download({ url: link }).catch(() => {
            this.#handedBack.delete(link);
        });
        return "browser";
    }
    async #send(link, referrer, storeId) {
        try {
            const origin = await originOf(this.#api, link, referrer, storeId, this.#userAgent);
            return await addToTug(this.#api, [link], origin);
        }
        catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
    }
}
