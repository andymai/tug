import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

  it("shows why a retry failed until it is dismissed", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const store = createDownloadsStore({
      ...backend,
      resume: () => Promise.reject(new BackendError("engine", "the mirror refused the range request")),
    });
    render(<App store={store} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Retry dataset-shard-07.parquet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The mirror refused the range request");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

describe("adding links", () => {
  it("checks each link as it is typed and adds the good ones", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add downloads" }));
    await user.type(
      dialog.getByRole("textbox", { name: "Links" }),
      "https://example.org/a.iso{Enter}mailto:me@example.org{Enter}nope{Enter}https://example.org/b.iso",
    );
    const found = within(dialog.getByRole("list", { name: "Links found" }));
    expect(found.getByText("Tug can't download mailto links", { exact: false })).toBeInTheDocument();
    expect(found.getByText("Not a link", { exact: false })).toBeInTheDocument();
    expect(dialog.getByText("Saves to Downloads")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Add 2 links" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("a.iso")).toBeInTheDocument();
    expect(screen.getByText("b.iso")).toBeInTheDocument();
  });

  it("skips a link already in the list unless asked to download it again", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByRole("textbox", { name: "Links" }), "https://fonts.example.org/noto-fonts-2026.11.zip");
    expect(dialog.getByText("Already in your list · Done", { exact: false })).toBeInTheDocument();
    const add = dialog.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();

    await user.click(dialog.getByRole("checkbox", { name: "Download it again" }));
    await user.click(add);
    expect(await screen.findAllByText("noto-fonts-2026.11.zip")).toHaveLength(2);
  });

  it("closes on Cancel without adding", async () => {
    const { user, store } = open();
    await user.click(await screen.findByRole("button", { name: "Add" }));
    await user.type(screen.getByRole("textbox", { name: "Links" }), "https://example.org/a.iso");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.getState().items).toHaveLength(5);
  });

  it("opens with the links pasted anywhere in the window", async () => {
    open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    fireEvent.paste(document.body, {
      clipboardData: { getData: () => "Grab https://example.org/c.iso, please" },
    });
    expect(await screen.findByRole("textbox", { name: "Links" })).toHaveValue("https://example.org/c.iso");
  });

  it("ignores a paste of plain words", async () => {
    open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    fireEvent.paste(document.body, { clipboardData: { getData: () => "just words" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with a link dropped on the window", async () => {
    open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    const dataTransfer = {
      types: ["text/uri-list"],
      getData: (type: string) => (type === "text/uri-list" ? "https://example.org/d.iso" : ""),
      dropEffect: "none",
    };
    fireEvent.dragEnter(document.body, { dataTransfer });
    expect(await screen.findByText("Drop to add")).toBeInTheDocument();
    fireEvent.drop(document.body, { dataTransfer });
    expect(screen.queryByText("Drop to add")).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Links" })).toHaveValue("https://example.org/d.iso");
  });
});

describe("detail panel", () => {
  it("opens on a selected row with its facts and live numbers", async () => {
    const { backend, user } = open();
    await user.click(await screen.findByRole("button", { name: /^fedora-kde-44-x86_64\.iso/ }));
    const panel = within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }));
    expect(panel.getByText("download.example.org")).toHaveAttribute(
      "title",
      "https://download.example.org/fedora-kde-44-x86_64.iso",
    );
    expect(panel.getByText("4.20 GB")).toBeInTheDocument();
    act(() => {
      backend.tick();
    });
    expect(panel.getByText("18.4 MB/s")).toBeInTheDocument();
    expect(panel.getByText("8")).toBeInTheDocument();
  });

  it("pauses and resumes the download it shows", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: /^fedora-kde-44-x86_64\.iso/ }));
    const panel = within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }));
    await user.click(panel.getByRole("button", { name: "Pause" }));
    expect(await panel.findByText("Paused")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Resume" }));
    expect(await panel.findByText("Downloading")).toBeInTheDocument();
  });

  it("opens a finished file and its folder, and copies the link", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const openFile = vi.fn(() => Promise.resolve());
    const showInFolder = vi.fn(() => Promise.resolve());
    const store = createDownloadsStore({ ...backend, openFile, showInFolder });
    render(<App store={store} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^noto-fonts-2026\.11\.zip/ }));
    const panel = within(screen.getByRole("complementary", { name: "noto-fonts-2026.11.zip" }));
    const id = store.getState().selected;

    await user.click(panel.getByRole("button", { name: "Open" }));
    await user.click(panel.getByRole("button", { name: "Open folder" }));
    expect(openFile).toHaveBeenCalledWith(id);
    expect(showInFolder).toHaveBeenCalledWith(id);

    await user.click(panel.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe("https://fonts.example.org/noto-fonts-2026.11.zip");
    expect(panel.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says why a file couldn't open", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const store = createDownloadsStore({
      ...backend,
      openFile: () => Promise.reject(new BackendError("internal", "couldn't open it: no app for zip files")),
    });
    render(<App store={store} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^noto-fonts-2026\.11\.zip/ }));
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open it: no app for zip files");
  });

  it("closes with its button and with Escape", async () => {
    const { user } = open();
    const row = await screen.findByRole("button", { name: /^fedora-kde-44-x86_64\.iso/ });
    await user.click(row);
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).not.toBeInTheDocument();
    await user.click(row);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).not.toBeInTheDocument();
  });
});
