import { describe, expect, it } from "vitest";

import { COLUMNS, columnsOf, DEFAULT_COLUMNS, fit, nextSort, sortOf, sortText } from "./columns";

const ids = (columns: readonly { id: string }[]) => columns.map((column) => column.id);

describe("columns", () => {
  it("shows the chosen columns, always with name and status, or the defaults", () => {
    expect(ids(columnsOf(null))).toEqual(DEFAULT_COLUMNS);
    expect(ids(columnsOf({ columns: ["queue", "size", "nonsense"] }))).toEqual(["name", "status", "size", "queue"]);
  });

  it("drops chosen columns in a fixed order until the name has room", () => {
    const all = [...COLUMNS];
    expect(ids(fit(all, null))).toEqual(ids(all));
    expect(ids(fit(all, 2000))).toEqual(ids(all));
    expect(ids(fit(all, 900))).toEqual(["name", "status", "progress", "size", "speed", "left", "connections", "queue"]);
    expect(ids(fit(all, 300))).toEqual(["name", "status"]);
  });

  it("sorts a column down first when it holds numbers, and flips on a second click", () => {
    const size = COLUMNS.find((column) => column.id === "size");
    const name = COLUMNS.find((column) => column.id === "name");
    if (size === undefined || name === undefined) throw new Error("no column");
    const bySize = nextSort(sortOf(null), size);
    expect(sortText(bySize)).toBe("-size");
    expect(sortText(nextSort(bySize, size))).toBe("size");
    expect(sortText(nextSort(bySize, name))).toBe("name");
    expect(sortOf({ sort: "-bogus" })).toEqual(sortOf(null));
  });
});
