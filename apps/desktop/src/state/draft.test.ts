import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type Save, useDraft } from "./draft";

const idle: Save = { saved: () => undefined, failed: () => undefined };

describe("useDraft", () => {
  it("follows the saved value until the person types, and again after a save", () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft(saved), { initialProps: { saved: "a" } });
    rerender({ saved: "b" });
    expect(result.current.text).toBe("b");
    act(() => {
      result.current.edit("typed");
    });
    rerender({ saved: "c" });
    expect(result.current.text, "an edit stays when the saved value moves").toBe("typed");
    act(() => {
      result.current.commit();
    });
    rerender({ saved: "typed, cleaned" });
    expect(result.current.text, "after a save it follows again").toBe("typed, cleaned");
  });

  it("takes a save's answer unless the person typed something else since it started", () => {
    const { result } = renderHook(() => useDraft("https://example.org/"));
    let save = idle;
    act(() => {
      result.current.edit("https://example.org");
    });
    act(() => {
      save = result.current.commit();
    });
    act(() => {
      save.saved("https://example.org/");
    });
    expect(result.current.text).toBe("https://example.org/");

    act(() => {
      result.current.edit("https://example.net");
      save = result.current.commit();
    });
    act(() => {
      result.current.edit("https://example.net/page");
      save.saved("https://example.net/");
    });
    expect(result.current.text, "a late answer leaves the newer text").toBe("https://example.net/page");

    act(() => {
      save = result.current.commit();
      result.current.edit("https://example.net/pag");
      result.current.edit("https://example.net/page");
    });
    act(() => {
      save.saved("https://example.net/page/");
    });
    expect(result.current.text, "typed back to what it sent: the answer still lands").toBe("https://example.net/page/");
  });

  it("keeps the typed text after a failed save, and drops an older save's answer", () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft(saved), { initialProps: { saved: "old" } });
    let first = idle;
    let second = idle;
    act(() => {
      result.current.edit("mine");
      first = result.current.commit();
    });
    act(() => {
      first.failed();
    });
    rerender({ saved: "from elsewhere" });
    expect(result.current.text, "an unsaved edit stays").toBe("mine");

    act(() => {
      first = result.current.commit();
      second = result.current.commit();
    });
    act(() => {
      first.saved("first answer");
    });
    expect(result.current.text, "the older save's answer is outdated").toBe("mine");
    act(() => {
      second.saved("second answer");
    });
    expect(result.current.text).toBe("second answer");
  });

  it("brings back the sent text when a failed save's value showed early and rolled back", () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft(saved), { initialProps: { saved: "10" } });
    let save = idle;
    act(() => {
      result.current.edit("20");
      save = result.current.commit();
    });
    rerender({ saved: "20" });
    rerender({ saved: "10" });
    expect(result.current.text, "the rollback shows first").toBe("10");
    act(() => {
      save.failed();
    });
    expect(result.current.text).toBe("20");
    rerender({ saved: "12" });
    expect(result.current.text, "it stays until the next save").toBe("20");

    act(() => {
      save = result.current.commit();
      result.current.edit("30");
    });
    act(() => {
      save.failed();
    });
    expect(result.current.text, "text typed since the save stays").toBe("30");
  });
});
