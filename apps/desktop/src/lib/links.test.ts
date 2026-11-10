import { describe, expect, it } from "vitest";

import type { Download } from "../backend/backend";
import { checkLinks, findLinks, isTorrent, linksFromTransfer, splitLinks } from "./links";

const done: Download = {
  id: 4,
  url: "https://fonts.example.org/noto.zip",
  name: "noto.zip",
  category: "archive",
  dir: "/home/you/Downloads",
  file: "/home/you/Downloads/noto.zip",
  state: "done",
  size: 10,
  received: 10,
  error: null,
  addedMs: 0,
  finishedMs: 1,
  position: 4,
  connections: null,
  speedLimit: null,
};

function transfer(types: Record<string, string>): DataTransfer {
  return { getData: (type: string) => types[type] ?? "" } as unknown as DataTransfer;
}

describe("splitLinks", () => {
  it("takes one link per line or space, once each", () => {
    expect(splitLinks("  a\n\nb a\tc ")).toEqual(["a", "b", "c"]);
    expect(splitLinks("   ")).toEqual([]);
  });

  it("keeps a typed link exactly as it is", () => {
    expect(splitLinks("https://example.org/tool_(linux) https://example.org/v1.0.")).toEqual([
      "https://example.org/tool_(linux)",
      "https://example.org/v1.0.",
    ]);
  });
});

describe("checkLinks", () => {
  it("names each link and says what is wrong with the rest", () => {
    const checks = checkLinks(
      "https://Download.Example.org/iso/fedora%20kde.iso\nmailto:a@example.org\nnot-a-link\nhttps://fonts.example.org/noto.zip",
      [done],
    );
    expect(checks).toEqual([
      {
        kind: "ready",
        input: "https://Download.Example.org/iso/fedora%20kde.iso",
        href: "https://download.example.org/iso/fedora%20kde.iso",
        name: "fedora kde.iso",
        host: "download.example.org",
      },
      { kind: "scheme", input: "mailto:a@example.org", scheme: "mailto" },
      { kind: "notLink", input: "not-a-link" },
      {
        kind: "duplicate",
        input: "https://fonts.example.org/noto.zip",
        href: "https://fonts.example.org/noto.zip",
        name: "noto.zip",
        existing: done,
      },
    ]);
  });

  it("names a link whose escapes don't decode by its raw segment", () => {
    expect(checkLinks("https://example.org/%FF.iso", [])[0]).toMatchObject({ kind: "ready", name: "%FF.iso" });
  });

  it("takes a magnet link and names it after its torrent", () => {
    const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Fedora%2044";
    expect(checkLinks(magnet, [])).toEqual([{ kind: "ready", input: magnet, href: magnet, name: "Fedora 44", host: "torrent" }]);
    expect(checkLinks("magnet:?xt=urn:btih:00", [])[0]).toMatchObject({ kind: "ready", name: "magnet link" });
    expect(findLinks(`get it here: ${magnet}.`)).toEqual([magnet]);
  });

  it("takes a .torrent file on this computer and names it after the file", () => {
    const file = "file:///home/you/My%20Torrents/Fedora%2044.TORRENT";
    expect(checkLinks(`${file}\nfile:///home/you/notes.txt\nfile:///home/you/.torrent`, [])).toEqual([
      { kind: "ready", input: file, href: file, name: "Fedora 44.TORRENT", host: "torrent file" },
      { kind: "notTorrent", input: "file:///home/you/notes.txt", name: "notes.txt" },
      { kind: "notTorrent", input: "file:///home/you/.torrent", name: ".torrent" },
    ]);
    expect(findLinks(`dropped ${file}`)).toEqual([file]);
    expect([file, "MAGNET:?xt=urn:btih:00", "https://example.org/a.torrent"].map(isTorrent)).toEqual([true, true, false]);
  });

  it("keeps one of two spellings of the same link", () => {
    const checks = checkLinks("https://EXAMPLE.org/a.bin https://example.org/a.bin", []);
    expect(checks).toHaveLength(1);
  });

  it("names a link without a path after its host", () => {
    expect(checkLinks("ftp://mirror.example.org", [])[0]).toMatchObject({ kind: "ready", name: "mirror.example.org" });
  });
});

describe("findLinks", () => {
  it("finds the download links in pasted prose", () => {
    expect(findLinks("Get it at https://example.org/a.iso or ftp://example.org/b.iso, see mailto:x@y.z")).toEqual([
      "https://example.org/a.iso",
      "ftp://example.org/b.iso",
    ]);
  });

  it("trims brackets around a link only when they don't belong to it", () => {
    expect(findLinks("(https://example.org/a.iso), <https://example.org/b.iso>.")).toEqual([
      "https://example.org/a.iso",
      "https://example.org/b.iso",
    ]);
    expect(findLinks("See https://example.org/tool_(linux).")).toEqual(["https://example.org/tool_(linux)"]);
    expect(findLinks("[https://example.org/x[1].bin]")).toEqual(["https://example.org/x[1].bin"]);
  });

  it("reads a URI list without its comments, else plain text", () => {
    expect(
      linksFromTransfer(
        transfer({ "text/uri-list": "# from a page\r\nhttps://example.org/a.iso\r\nhttps://example.org/tool_(linux).\r\n" }),
      ),
    ).toEqual(["https://example.org/a.iso", "https://example.org/tool_(linux)."]);
    expect(linksFromTransfer(transfer({ "text/plain": "https://example.org/b.iso" }))).toEqual(["https://example.org/b.iso"]);
    expect(linksFromTransfer(transfer({ "text/plain": "just words" }))).toEqual([]);
  });
});
