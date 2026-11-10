# Privacy

Tug and its browser extension send none of your data to me. They have no analytics and no ads.

## The browser extension

When the extension hands a download to Tug, it reads these items:

- The download's link.
- The address of the page that the link came from (the referrer). The extension cuts it down by the browser's default rule. For a link to another site, the referrer is only the address of the page's site. For an `http` link on an `https` page, the extension sends no referrer.
- The cookies that the browser keeps for the link.
- The browser's User-Agent.

The extension sends these items only to Tug, through native messaging, which stays on your computer. Tug uses them to request the file, so a download that needs a sign-in works in Tug as it does in the browser.

A download from a form stays in the browser, because Tug can't send the form again. To find these downloads, the extension notes the address of each form that a page sends, with the time. A note counts for 2 minutes. The extension removes old notes when it saves a new one, and the browser clears them when it closes.

The extension doesn't catch downloads in private windows, and it runs no remote code.

## Tug

Tug keeps the referrer, the cookies and the User-Agent in its database until the download finishes. Only your user account can read the database. Tug sends these items with the requests for that download.

Tug keeps each download's link, name and folder in its list until you remove the download.

## Questions

Open an issue at <https://github.com/andymai/tug/issues>.
