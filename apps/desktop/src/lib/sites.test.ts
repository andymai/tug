import { describe, expect, it } from "vitest";

import { siteOf } from "./sites";

describe("siteOf", () => {
  it.each([
    ["example.org", "example.org"],
    ["  Example.ORG ", "example.org"],
    ["https://mail.example.org/inbox?x=1", "mail.example.org"],
    ["*.example.org", "example.org"],
    ["example.org:8080/files", "example.org"],
    ["example.org.", "example.org"],
    ["bücher.example", "xn--bcher-kva.example"],
  ])("reads %j as %j, as Tug's core does", (typed, site) => {
    expect(siteOf(typed)).toBe(site);
  });

  it.each(["", "   ", "https://", "exa mple.org", "[::1"])("refuses %j", (typed) => {
    expect(siteOf(typed)).toBeNull();
  });
});
