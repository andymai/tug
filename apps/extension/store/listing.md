# The Chrome Web Store listing

The fields for the item in the Developer Dashboard. The name and the summary come from the manifest (`src/manifest.ts`).

## Store listing

**Description**

```text
Tug is a fast, resumable download manager for Linux, made for KDE Plasma first. This extension hands your browser's downloads to Tug. It needs the Tug app on the same computer.

• A download that the browser starts goes to Tug, with the page's referrer, the site's cookies and the browser's User-Agent. A download that needs a sign-in works in Tug as it does in the browser.
• By default, Tug asks first. Click Download to keep the file in Tug, or Cancel to drop it.
• Right-click a link, an image, a video or an audio file, and click "Download with Tug".
• The browser keeps a download when Tug can't take it or when it comes from a form. It also keeps downloads from the sites on your list in Tug's settings.
• Downloads in private windows, and files under 1 MiB, stay in the browser.

In Tug, each file downloads over many connections and resumes after a stop or a crash. Tug's inspector shows each connection's speed.

To set up Tug for the browser:
1. Download Tug's AppImage from https://github.com/andymai/tug/releases/latest
2. Run it once with the browsers command: ./Tug_*_amd64.AppImage browsers
It connects Tug to each browser that ran at least once. A browser from Flatpak also needs the permission that this command prints.

If Tug is not open, it starts by itself for the download.

Privacy: the extension sends what it reads only to Tug, on your computer. The policy: https://github.com/andymai/tug/blob/main/PRIVACY.md
Source code (GPL-3.0-or-later): https://github.com/andymai/tug
```

- **Category:** Productivity, Tools
- **Language:** English
- **Store icon:** `icon-128.png` (the mark at 96 px, as the store's image guide asks)
- **Screenshots:** `screenshot-1-capture.png`, `screenshot-2-browsers.png`, `screenshot-3-connections.png`, `screenshot-4-list.png`
- **Small promo tile:** `promo-440x280.png`
- **Homepage URL:** https://github.com/andymai/tug
- **Support URL:** https://github.com/andymai/tug/issues
- **Mature content:** off

## Privacy

**Single purpose**

```text
Hand the browser's downloads to Tug, a download manager on the same computer.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `contextMenus` | Adds "Download with Tug" to the menu of links, images, videos and audio. |
| `cookies` | Reads the cookies for a download's link and gives them to Tug, so a download that needs a sign-in works in Tug. |
| `downloads` | Pauses a download that the browser starts while Tug decides. When Tug takes it, the extension cancels and erases the browser's copy. When Tug can't, the extension resumes it, or starts it for a menu link. |
| `nativeMessaging` | Sends each download to Tug's native messaging host, io.github.andymai.tug, which passes it to the Tug app. |
| `storage` | Keeps the address and time of each form that a page sent in the last 2 minutes, in session storage. The service worker can stop between a form and its download, and the note must stay. |
| `webRequest` | Observes the page and frame requests that send a form (not GET), so a form's download stays in the browser. The extension doesn't block or change requests. |
| Host permission `<all_urls>` | Downloads come from any site. The extension needs access to a download's site to read its cookies and to see its form requests. |

**Remote code:** "No, I am not using remote code."

**Data usage:** the extension handles these types. The store's FAQ asks for a disclosure even when the data stays on the computer.

- **Authentication information:** the cookies for a download's link.
- **Web history:** the download's link and the address of its page.
- **User activity:** the addresses of the forms that pages send.

Select the three certifications: no sale or transfer to third parties, no use outside the single purpose, and no use for credit or loans.

**Privacy policy URL:** https://github.com/andymai/tug/blob/main/PRIVACY.md

## Distribution

- **Visibility:** Public
- **Regions:** all
