import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDate,
  formatDuration,
  formatLeft,
  formatPercent,
  formatSpeed,
  percentOf,
  sentence,
  shortDir,
} from "./format";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

describe("formatBytes", () => {
  it("keeps three significant figures, as the design system's examples do", () => {
    expect(formatBytes(4.2 * GB)).toBe("4.20 GB");
    expect(formatBytes(1.6 * GB)).toBe("1.60 GB");
    expect(formatBytes(412 * MB)).toBe("412 MB");
    expect(formatBytes(186 * MB)).toBe("186 MB");
    expect(formatBytes(18.4 * MB)).toBe("18.4 MB");
  });

  it("shows whole bytes below a kilobyte and never goes negative", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("moves to the next unit before showing four digits", () => {
    expect(formatBytes(1000 * KB)).toBe("0.98 MB");
    expect(formatBytes(999 * KB)).toBe("999 KB");
  });
});

describe("formatSpeed and formatLeft", () => {
  it("formats speed per second", () => {
    expect(formatSpeed(18.4 * MB)).toBe("18.4 MB/s");
  });

  it("formats time left as minutes and seconds, with hours when needed", () => {
    expect(formatLeft(161_000)).toBe("2:41 left");
    expect(formatLeft(3_761_000)).toBe("1:02:41 left");
    expect(formatLeft(200)).toBe("0:01 left");
    expect(formatDuration(161_000)).toBe("2:41");
  });

  it("formats a date with its year and time", () => {
    expect(formatDate(Date.UTC(2026, 10, 8, 12))).toMatch(/2026/);
  });
});

describe("shortDir and sentence", () => {
  it("shows folders relative to home, on both spellings of home", () => {
    expect(shortDir("/home/you/Downloads")).toBe("Downloads");
    expect(shortDir("/var/home/you/Downloads/ISO/")).toBe("Downloads/ISO");
    expect(shortDir("/home/you")).toBe("Home");
    expect(shortDir("/mnt/media/iso")).toBe("/mnt/media/iso");
  });

  it("starts a reason with a capital", () => {
    expect(sentence(" couldn't reach mirror.example.org")).toBe("Couldn't reach mirror.example.org");
    expect(sentence("")).toBe("");
  });
});

describe("percent", () => {
  it("rounds down and needs a size", () => {
    expect(formatPercent(38.9, 100)).toBe("38%");
    expect(formatPercent(2_900_000, 10_000_000)).toBe("29%");
    expect(formatPercent(5, null)).toBeNull();
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(10, null)).toBe(0);
    expect(percentOf(300, 200)).toBe(100);
  });
});
