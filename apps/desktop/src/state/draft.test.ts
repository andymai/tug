import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDraft } from "./draft";

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

  it("takes a save's answer only if nobody typed since the save started", () => {
    const { result } = renderHook(() => useDraft("https://example.org/"));
    act(() => {
      result.current.edit("https://example.org");
    });
    let answer: (text: string) => void = () => undefined;
    act(() => {
      answer = result.current.commit();
    });
    act(() => {
      answer("https://example.org/");
    });
    expect(result.current.text).toBe("https://example.org/");

    act(() => {
      result.current.edit("https://example.net");
    });
    act(() => {
      answer = result.current.commit();
    });
    act(() => {
      result.current.edit("https://example.net/page");
    });
    act(() => {
      answer("https://example.net/");
    });
    expect(result.current.text, "a late answer leaves the newer text").toBe("https://example.net/page");
  });
});
