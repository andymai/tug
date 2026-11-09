import { describe, expect, it } from "vitest";

import { limitText, parseConnections, parseLimit } from "./options";

const MB = 1 << 20;

describe("own options", () => {
  it("reads an empty field as Tug's own value and refuses what can't be", () => {
    expect(parseConnections(" ")).toEqual({ ok: true, value: null });
    expect(parseConnections("4")).toEqual({ ok: true, value: 4 });
    expect(parseConnections("33").ok).toBe(false);
    expect(parseLimit("1,5")).toEqual({ ok: true, value: Math.round(1.5 * MB) });
    expect(parseLimit("0").ok).toBe(false);
  });

  it("shows a small limit with its digits, not as 0", () => {
    expect(limitText(1049)).toBe("0.001");
    expect(limitText(Math.round(1.5 * MB))).toBe("1.5");
    expect(limitText(null)).toBe("");
  });
});
