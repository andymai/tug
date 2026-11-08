import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { BackendError } from "./backend/backend";
import { createMockBackend } from "./backend/mock";
import { SHOWCASE } from "./backend/showcase";
import { createDownloadsStore } from "./state/downloads";

const MB = 1 << 20;

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

  it("gives focus back to the row when it closes from inside", async () => {
    const { user } = open();
    const row = await screen.findByRole("button", { name: /^fedora-kde-44-x86_64\.iso/ });
    await user.click(row);
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(row).toHaveFocus();

    await user.click(row);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await user.keyboard("{Escape}");
    expect(row).toHaveFocus();
  });

  it("shows the download's history and adds to it", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: /^conference-talk-1080p\.mp4/ }));
    const panel = within(screen.getByRole("complementary", { name: "conference-talk-1080p.mp4" }));
    const history = within(await panel.findByRole("region", { name: "History" }));
    expect(history.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringMatching(/Added$/),
      expect.stringMatching(/Started$/),
      expect.stringMatching(/Paused at 623 MB$/),
    ]);

    await user.click(panel.getByRole("button", { name: "Resume" }));
    expect(await history.findByText("Resumed at")).toBeInTheDocument();
  });

  it("gives focus to the list's title when the row has left the view", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: /^Failed/ }));
    await user.click(screen.getByRole("button", { name: /^dataset-shard-07\.parquet/ }));
    const panel = within(screen.getByRole("complementary", { name: "dataset-shard-07.parquet" }));
    await user.click(panel.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Nothing failed" })).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Close details" }));
    expect(screen.getByRole("heading", { level: 1, name: "Failed" })).toHaveFocus();
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

describe("command bar and keyboard", () => {
  it("opens on Ctrl+K and runs the chosen command", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>}k{/Control}");
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    await user.type(bar.getByRole("combobox"), "finished");
    expect(bar.getByRole("option", { name: /Show finished downloads/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Command bar" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Done" })).toBeInTheDocument();
  });

  it("goes to a download by name, in a view that shows it", async () => {
    const { user, store } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    store.getState().setView("failed");
    await user.click(screen.getByRole("button", { name: /^Commands/ }));
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    await user.type(bar.getByRole("combobox"), "talk");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 1, name: "All downloads" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "conference-talk-1080p.mp4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^conference-talk-1080p\.mp4/ })).toHaveFocus();
  });

  it("runs a command on a primary click only", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>}k{/Control}");
    const option = within(screen.getByRole("dialog", { name: "Command bar" })).getByRole("option", { name: /Show failed downloads/ });
    await user.pointer({ keys: "[MouseRight]", target: option });
    expect(screen.getByRole("dialog", { name: "Command bar" })).toBeInTheDocument();
    await user.click(option);
    expect(screen.getByRole("heading", { level: 1, name: "Failed" })).toBeInTheDocument();
  });

  it("moves the active option with the arrow keys and offers the selected download's actions", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: /^noto-fonts-2026\.11\.zip/ }));
    await user.keyboard("{Control>}k{/Control}");
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    const options = bar.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Open/), expect.stringMatching(/^Open folder/), expect.stringMatching(/^Copy link/)]),
    );
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
  });

  it("switches views, adds, moves through rows and pauses from the keyboard", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>}2{/Control}");
    expect(screen.getByRole("heading", { level: 1, name: "Active" })).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    const fedora = screen.getByRole("button", { name: /^fedora-kde-44-x86_64\.iso/ });
    expect(fedora).toHaveFocus();
    expect(fedora).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("p");
    expect(await within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).findByText("Paused")).toBeInTheDocument();

    await user.keyboard("{Control>}n{/Control}");
    const field = screen.getByRole("textbox", { name: "Links" });
    await user.type(field, "p");
    expect(field).toHaveValue("p");
    expect(screen.queryByRole("dialog", { name: "Command bar" })).not.toBeInTheDocument();
  });

  it("lists the shortcuts on ?", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("?");
    const map = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" }));
    expect(map.getByText("Command bar")).toBeInTheDocument();
    expect(map.getByText("Show failed downloads")).toBeInTheDocument();
    await user.click(map.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });
});

describe("settings page", () => {
  it("opens from the sidebar and from Ctrl+comma, and a view brings the list back", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /^All/ })).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Done" })).toBeInTheDocument();
    await user.keyboard("{Control>},{/Control}");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("changes the folder through the chooser and the connections with the stepper", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, folder: "/home/you/Media/ISO" });
    const store = createDownloadsStore(backend);
    render(<App store={store} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByText("New downloads save to Downloads.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change folder" }));
    expect(await screen.findByText("New downloads save to Media/ISO.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More connections" }));
    await user.click(screen.getByRole("button", { name: "More connections" }));
    expect(screen.getByRole("group", { name: "Connections" })).toHaveTextContent("10");
    expect((await backend.settings()).connections).toBe(10);
  });

  it("limits speed with a switch and a field that refuses zero", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const limit = screen.getByRole("switch", { name: "Limit download speed" });
    expect(limit).toHaveAttribute("aria-checked", "false");
    await user.click(limit);
    expect(limit).toHaveAttribute("aria-checked", "true");
    expect((await backend.settings()).speedLimit).toBe(10 * MB);

    const field = screen.getByRole("textbox", { name: "Speed limit" });
    await user.clear(field);
    await user.type(field, "2.5{Enter}");
    expect((await backend.settings()).speedLimit).toBe(Math.round(2.5 * MB));
    await user.clear(field);
    await user.type(field, "0{Enter}");
    expect(screen.getByText("Enter a speed above zero.")).toBeInTheDocument();
    expect((await backend.settings()).speedLimit).toBe(Math.round(2.5 * MB));

    await user.click(limit);
    expect((await backend.settings()).speedLimit).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Speed limit" })).not.toBeInTheDocument();
  });

  it("keeps list shortcuts quiet on the settings page", async () => {
    const { user, store } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>},{/Control}");
    await user.keyboard("{ArrowDown}");
    expect(store.getState().selected).toBeNull();
  });
});

