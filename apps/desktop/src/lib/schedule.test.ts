import { describe, expect, it } from "vitest";

import { openAt } from "./schedule";

const MONDAY = 0;
const SUNDAY = 6;
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, 9 + day, hours, minutes);

describe("schedule", () => {
  it("is open from its start until its stop on its days", () => {
    const work = { days: 1 << MONDAY, start: 9 * 60, stop: 17 * 60 + 30 };
    expect([at(MONDAY, 8, 59), at(MONDAY, 9), at(MONDAY, 17, 29), at(MONDAY, 17, 30), at(1, 12)].map((d) => openAt(work, d))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it("runs past midnight from the day it starts on", () => {
    const night = { days: 1 << SUNDAY, start: 23 * 60, stop: 7 * 60 };
    expect([at(SUNDAY, 23, 30), at(7, 6, 59), at(7, 7), at(SUNDAY, 6)].map((d) => openAt(night, d))).toEqual([true, true, false, false]);
  });
});
