import { describe, expect, it } from "vitest";

import { covering } from "./covering";

type Color = "red" | "green" | "blue";

describe("covering", () => {
  it("takes a list that names every member, and the typecheck refuses one that misses any", () => {
    expect(covering<Color>().names(["red", "green", "blue"])).toHaveLength(3);
    expect(covering<Color>().by<"id">()([{ id: "red" }, { id: "green" }, { id: "blue", label: "Blue" }])).toHaveLength(3);
    // @ts-expect-error "blue" is missing
    covering<Color>().names(["red", "green"]);
    // @ts-expect-error "green" is missing
    covering<Color>().by<"id">()([{ id: "red" }, { id: "blue" }]);
  });
});
