import { describe, expect, it } from "vitest";

import { createMockBackend } from "../backend/mock";
import { SHOWCASE } from "../backend/showcase";
import { createDownloadsStore } from "../state/downloads";
import { commands, KEYMAP, matches, rank } from "./commands";

const press = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("matches", () => {
  it("needs the same key and modifiers", () => {
    const keys = { key: "k", ctrl: true, label: ["Ctrl", "K"] };
    expect(matches(keys, press("k", { ctrl: true }))).toBe(true);
    expect(matches(keys, press("K", { ctrl: true }))).toBe(true);
    expect(matches(keys, press("k"))).toBe(false);
    expect(matches(keys, press("k", { ctrl: true, shift: true }))).toBe(false);
    expect(matches(keys, press("k", { ctrl: true, alt: true }))).toBe(false);
  });

  it("ignores Shift for a symbol that needs it on some layouts", () => {
    const keys = { key: "?", label: ["?"] };
    expect(matches(keys, press("?", { shift: true }))).toBe(true);
    expect(matches(keys, press("?"))).toBe(true);
  });

  it("names arrow keys by their key", () => {
    expect(matches({ key: "arrowdown", label: ["↓"] }, press("ArrowDown"))).toBe(true);
  });
});

describe("rank", () => {
  it("puts a prefix first, then a word start, then any match", () => {
    expect(rank("Show finished downloads", "show")).toBe(3);
    expect(rank("Show finished downloads", "fin")).toBe(2);
    expect(rank("fedora-kde-44.iso", "kde")).toBe(2);
    expect(rank("Show finished downloads", "nish")).toBe(1);
    expect(rank("Show finished downloads", "zip")).toBe(0);
    expect(rank("anything", "  ")).toBe(1);
  });
});

describe("keyboard map", () => {
  it("lists the keys of every command, for any selected download", async () => {
    const store = createDownloadsStore(createMockBackend({ seed: SHOWCASE }));
    await store.getState().reload();
    const mapped = KEYMAP.flatMap((group) => group.entries.map((entry) => entry.label.join("+")));
    for (const selected of [null, ...store.getState().items.map((d) => d.id)]) {
      store.getState().select(selected);
      for (const command of commands(store)) {
        if (command.keys !== undefined) expect(mapped, command.title).toContain(command.keys.label.join("+"));
      }
    }
    store.getState().markAll();
    for (const command of commands(store)) {
      if (command.keys !== undefined) expect(mapped, command.title).toContain(command.keys.label.join("+"));
    }
  });
});
