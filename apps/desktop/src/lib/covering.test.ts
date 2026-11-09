import { describe, expect, it } from "vitest";

import { covering } from "./covering";

type Color = "red" | "green" | "blue";

describe("covering", () => {
  it("takes a list that names every member once, and the typecheck refuses a gap or a repeat", () => {
    expect(covering<Color>().names(["red", "green", "blue"])).toHaveLength(3);
    expect(covering<Color>().by<"id">()([{ id: "red" }, { id: "green" }, { id: "blue", label: "Blue" }])).toHaveLength(3);
    // @ts-expect-error "blue" is missing
    covering<Color>().names(["red", "green"]);
    // @ts-expect-error "green" is missing
    covering<Color>().by<"id">()([{ id: "red" }, { id: "blue" }]);
    // @ts-expect-error "red" is there twice
    covering<Color>().names(["red", "green", "blue", "red"]);
    // @ts-expect-error "blue" is there twice
    covering<Color>().by<"id">()([{ id: "red" }, { id: "green" }, { id: "blue" }, { id: "blue" }]);
    const typed: Color[] = ["red"];
    // @ts-expect-error a typed array could hold anything
    covering<Color>().names(typed);
    const entries: { id: Color }[] = [{ id: "red" }];
    // @ts-expect-error a typed array could hold anything
    covering<Color>().by<"id">()(entries);
  });
});
