import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { BackendError } from "./backend/backend";
import { createMockBackend } from "./backend/mock";
import { SHOWCASE } from "./backend/showcase";
import { createDownloadsStore } from "./state/downloads";

function open(seed = SHOWCASE) {
  const backend = createMockBackend({ seed });
  const store = createDownloadsStore(backend);
  render(<App store={store} />);
  return { backend, store, user: userEvent.setup() };
}

function row(name: string) {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`no row for ${name}`);
  return within(item);
}

describe("main window", () => {
  it("opens on the empty state in the brand's voice", async () => {
    open([]);
    expect(await screen.findByRole("heading", { name: "Nothing downloading" })).toBeInTheDocument();
    expect(screen.getByText("Paste a link or drop a file here.")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("counts each view in the sidebar and marks the current one", async () => {
    open();
    const nav = within(await screen.findByRole("navigation", { name: "Downloads" }));
    const counts = ["All", "Active", "Done", "Failed"].map((label) => {
      const button = nav.getByRole("button", { name: new RegExp(`^${label}`) });
      return within(button).getByText(/^\d+$/).textContent;
    });
    expect(counts).toEqual(["5", "3", "1", "1"]);
    expect(nav.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows every state as an icon and a word, with its numbers", async () => {
    open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    expect(row("fedora-kde-44-x86_64.iso").getByText("Downloading")).toBeInTheDocument();
    expect(row("fedora-kde-44-x86_64.iso").getByText("4.20 GB")).toBeInTheDocument();
    expect(row("blender-5.1-linux-x64.tar.xz").getByText("Queued")).toBeInTheDocument();
    expect(row("conference-talk-1080p.mp4").getByText("38%")).toBeInTheDocument();
    expect(row("noto-fonts-2026.11.zip").getByText("Saved to Downloads/Fonts")).toBeInTheDocument();
    expect(row("dataset-shard-07.parquet").getByText("Couldn't reach mirror.example.org")).toBeInTheDocument();
  });

  it("updates speed and time left as progress arrives", async () => {
    const { backend } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    act(() => {
      backend.tick();
    });
    const fedora = row("fedora-kde-44-x86_64.iso");
    expect(fedora.getByText("18.4 MB/s")).toBeInTheDocument();
    expect(fedora.getByText(/^\d+:\d{2} left$/)).toBeInTheDocument();
    expect(screen.getByText(/1 downloading/)).toBeInTheDocument();
  });

  it("filters by view and retries a failed download", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: /^Failed/ }));
    expect(screen.getByRole("heading", { name: "Failed" })).toBeInTheDocument();
    expect(screen.queryByText("fedora-kde-44-x86_64.iso")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry dataset-shard-07.parquet" }));
    expect(await screen.findByRole("heading", { name: "Nothing failed" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Active/ }));
    expect(row("dataset-shard-07.parquet").getByText("Downloading")).toBeInTheDocument();
  });

  it("selects a row and clears the selection on a second click", async () => {
    const { user } = open();
    const fedora = await screen.findByRole("button", { name: /^fedora-kde-44-x86_64\.iso/ });
    await user.click(fedora);
    expect(fedora).toHaveAttribute("aria-pressed", "true");
    await user.click(fedora);
    expect(fedora).toHaveAttribute("aria-pressed", "false");
  });

  it("says when the list can't load, and loads again on Retry", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    let fail = true;
    const store = createDownloadsStore({
      ...backend,
      list: () => (fail ? Promise.reject(new BackendError("storage", "the library is locked")) : backend.list()),
    });
    render(<App store={store} />);
    expect(await screen.findByRole("heading", { name: "Couldn't load your downloads" })).toBeInTheDocument();
    expect(screen.getByText("The library is locked")).toBeInTheDocument();

    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("fedora-kde-44-x86_64.iso")).toBeInTheDocument();
  });
});
