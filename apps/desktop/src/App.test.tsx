import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("opens on the empty state in the brand's voice", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Nothing downloading" })).toBeInTheDocument();
    expect(screen.getByText("Paste a link or drop a file here.")).toBeInTheDocument();
  });

  it("labels the main landmark by its heading", () => {
    render(<App />);
    expect(screen.getByRole("region", { name: "Nothing downloading" })).toBeInTheDocument();
  });
});
