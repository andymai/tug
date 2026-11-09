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

function downloadRows(title: string) {
  return within(screen.getByRole("grid", { name: title })).getAllByRole("row").slice(1);
}

function row(name: string) {
  const item = screen.getByText(name).closest("tr");
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
    expect(fedora.getByText(/^\d+:\d{2}$/)).toBeInTheDocument();
    const status = within(screen.getByRole("region", { name: "Status" }));
    expect(status.getByText("1 running · 1 queued · 1 paused")).toBeInTheDocument();
    expect(status.getByText("18.4 MB/s")).toBeInTheDocument();
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
    const fedora = await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ });
    await user.click(fedora);
    expect(fedora).toHaveAttribute("aria-selected", "true");
    await user.click(fedora);
    expect(fedora).toHaveAttribute("aria-selected", "false");
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
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
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
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
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
    await user.click(await screen.findByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
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
    await user.click(await screen.findByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open it: no app for zip files");
  });

  it("gives focus back to the row when it closes from inside", async () => {
    const { user } = open();
    const row = await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ });
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
    await user.click(await screen.findByRole("row", { name: /^conference-talk-1080p\.mp4/ }));
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
    await user.click(screen.getByRole("row", { name: /^dataset-shard-07\.parquet/ }));
    const panel = within(screen.getByRole("complementary", { name: "dataset-shard-07.parquet" }));
    await user.click(panel.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Nothing failed" })).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Close details" }));
    expect(screen.getByRole("heading", { level: 1, name: "Failed" })).toHaveFocus();
  });

  it("closes with its button and with Escape", async () => {
    const { user } = open();
    const row = await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ });
    await user.click(row);
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).not.toBeInTheDocument();
    await user.click(row);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).not.toBeInTheDocument();
  });
});

describe("capture sheet", () => {
  const REPORT = "https://cdn.example.org/files/report-2026.pdf";
  const TALK = "https://media.example.net/talk.mp4";

  it("asks before a browser download and starts it on Download", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await act(async () => {
      await backend.capture(REPORT);
    });

    const sheet = await screen.findByRole("dialog", { name: "Download this file?" });
    expect(within(sheet).getByText("report-2026.pdf")).toBeInTheDocument();
    expect(within(sheet).getByText(/^cdn\.example\.org/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/of \d/)).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Download" })).toHaveFocus();
    expect((await backend.list()).find((d) => d.url === REPORT)?.state).toBe("paused");

    await user.click(within(sheet).getByRole("button", { name: "Download" }));
    expect(screen.queryByRole("dialog", { name: "Download this file?" })).not.toBeInTheDocument();
    expect((await backend.list()).find((d) => d.url === REPORT)?.state).toBe("downloading");
    expect(await backend.pendingCaptures()).toEqual([]);
  });

  it("takes several in order: Cancel removes one, Escape leaves one paused", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, captures: [REPORT, TALK] });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();

    const sheet = await screen.findByRole("dialog", { name: "Download this file?" });
    expect(within(sheet).getByText("1 of 2")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect((await backend.list()).some((d) => d.url === REPORT)).toBe(false);

    expect(await within(sheet).findByText("talk.mp4")).toBeInTheDocument();
    expect(within(sheet).queryByText("1 of 2")).not.toBeInTheDocument();
    fireEvent(sheet, new Event("cancel", { cancelable: true }));
    expect(await backend.pendingCaptures()).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Download this file?" })).not.toBeInTheDocument();
    expect((await backend.list()).find((d) => d.url === TALK)?.state).toBe("paused");
  });

  it("stops asking from the sheet or from settings", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, captures: [REPORT] });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();

    const sheet = await screen.findByRole("dialog", { name: "Download this file?" });
    await user.click(within(sheet).getByRole("checkbox", { name: "Ask before each browser download" }));
    expect((await backend.settings()).confirmCaptures).toBe(false);
    await user.click(within(sheet).getByRole("button", { name: "Download" }));
    await act(async () => {
      await backend.capture(TALK);
    });
    expect(screen.queryByRole("dialog", { name: "Download this file?" })).not.toBeInTheDocument();
    expect((await backend.list()).find((d) => d.url === TALK)?.state, "three downloads already run").toBe("queued");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const ask = screen.getByRole("switch", { name: "Ask before each browser download" });
    expect(ask).toHaveAttribute("aria-checked", "false");
    await user.click(ask);
    expect((await backend.settings()).confirmCaptures).toBe(true);
  });

  it("stops asking about a capture that starts from the list", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, captures: [REPORT] });
    render(<App store={createDownloadsStore(backend)} />);
    await screen.findByRole("dialog", { name: "Download this file?" });
    const waiting = (await backend.pendingCaptures())[0];
    await act(async () => {
      await backend.resume(waiting?.id ?? 0);
    });
    expect(screen.queryByRole("dialog", { name: "Download this file?" })).not.toBeInTheDocument();
  });

  it("says so in the sheet when it can't save the checkbox", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, captures: [REPORT] });
    const store = createDownloadsStore({
      ...backend,
      updateSettings: () => Promise.reject(new BackendError("internal", "the disk is full")),
    });
    render(<App store={store} />);
    const user = userEvent.setup();
    const sheet = await screen.findByRole("dialog", { name: "Download this file?" });
    await user.click(within(sheet).getByRole("checkbox", { name: "Ask before each browser download" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("The disk is full");
    expect(within(sheet).getByRole("checkbox", { name: "Ask before each browser download" })).toBeChecked();
  });

  it("keeps Escape for the sheet while it is open", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const store = createDownloadsStore(backend);
    render(<App store={store} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    await act(async () => {
      await backend.capture(REPORT);
    });
    await screen.findByRole("dialog", { name: "Download this file?" });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).toBeInTheDocument();
  });
});

describe("notifications", () => {
  it("goes to the download a notification shows, from any page", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const done = (await backend.list()).find((d) => d.state === "done");
    expect(done).toBeDefined();

    act(() => {
      backend.focus(done?.id ?? 0);
    });
    expect(await screen.findByRole("complementary", { name: done?.name ?? "" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Settings" })).not.toBeInTheDocument();
  });

  it("closes the command bar before it goes to the download", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const store = createDownloadsStore(backend);
    render(<App store={store} />);
    await screen.findByText("fedora-kde-44-x86_64.iso");
    act(() => {
      store.getState().setOverlay("commands");
    });
    expect(screen.getByRole("dialog", { name: "Command bar" })).toBeInTheDocument();
    const done = (await backend.list()).find((d) => d.state === "done");

    act(() => {
      backend.focus(done?.id ?? 0);
    });
    expect(await screen.findByRole("complementary", { name: done?.name ?? "" })).toBeInTheDocument();
    expect(store.getState().overlay).toBeNull();
  });
});

describe("window title bar", () => {
  it("minimizes, maximizes, restores and closes through its own buttons", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const { container } = render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-tauri-drag-region");

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(container.querySelector("[data-edge]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(backend.windowCalls).toEqual(["minimize", "toggleMaximize", "toggleMaximize", "close"]);
  });

  it("resizes from its edges while the window isn't maximized", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const { container } = render(<App store={createDownloadsStore(backend)} />);
    await screen.findByText("fedora-kde-44-x86_64.iso");
    const east = container.querySelector("[data-edge=East]");
    expect(east).not.toBeNull();
    fireEvent.mouseDown(east ?? document.body, { button: 2 });
    fireEvent.mouseDown(east ?? document.body, { button: 0 });
    expect(backend.windowCalls).toEqual(["resize East"]);
    act(() => {
      backend.setMaximized(true);
    });
    expect(container.querySelector("[data-edge]")).toBeNull();
  });

  it("keeps the window buttons on the settings page", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("queue", () => {
  it("sets how many downloads run at once", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(within(screen.getByRole("group", { name: "Downloads" })).getByText("3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More downloads" }));
    expect((await backend.settings()).maxActive).toBe(4);
    await user.click(screen.getByRole("button", { name: "Fewer downloads" }));
    await user.click(screen.getByRole("button", { name: "Fewer downloads" }));
    expect((await backend.settings()).maxActive).toBe(2);
  });

  it("starts the download chosen to go next when a place frees up", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    await backend.updateSettings({ ...(await backend.settings()), maxActive: 1 });
    const later = await backend.add("https://example.org/later.iso");
    expect(later.state).toBe("queued");
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^later\.iso/ }));
    const panel = within(screen.getByRole("complementary", { name: "later.iso" }));
    await user.click(panel.getByRole("button", { name: "Start next" }));

    const state = async (name: string) => (await backend.list()).find((d) => d.name === name)?.state;
    const running = (await backend.list()).find((d) => d.state === "downloading");
    await backend.pause(running?.id ?? -1);
    expect(await state("later.iso")).toBe("downloading");
    expect(await state("blender-5.1-linux-x64.tar.xz")).toBe("queued");
  });

  it("takes a waiting download out of the queue with Pause", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    const queued = (await backend.list()).find((d) => d.state === "queued");
    expect(queued).toBeDefined();
    await user.click(await screen.findByRole("row", { name: new RegExp(`^${queued?.name ?? ""}`) }));
    const panel = within(screen.getByRole("complementary", { name: queued?.name ?? "" }));
    await user.click(panel.getByRole("button", { name: "Pause" }));
    expect((await backend.list()).find((d) => d.id === queued?.id)?.state).toBe("paused");
    expect(panel.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});

describe("schedule", () => {
  it("sets the hours and the days on which downloads run", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Download at set times" }));
    expect((await backend.settings()).schedule).toEqual({ days: 0b111_1111, start: 60, stop: 420 });

    const from = screen.getByRole("textbox", { name: "Hours" });
    await user.clear(from);
    await user.type(from, "23:00{Enter}");
    expect((await backend.settings()).schedule?.start).toBe(23 * 60);
    expect(screen.getByText("These hours go on past midnight.")).toBeInTheDocument();

    const until = screen.getByRole("textbox", { name: "Until" });
    await user.clear(until);
    await user.type(until, "23:00{Enter}");
    expect(screen.getByText("Pick two different times.")).toBeInTheDocument();
    expect((await backend.settings()).schedule?.stop).toBe(420);
    await user.clear(until);
    await user.type(until, "noon{Enter}");
    expect(screen.getByText("Enter a time like 23:00.")).toBeInTheDocument();

    const days = within(screen.getByRole("group", { name: "Days" }));
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      await user.click(days.getByRole("button", { name: day }));
    }
    expect((await backend.settings()).schedule?.days).toBe(0b100_0000);
    expect(days.getByRole("button", { name: "Sunday" })).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Download at set times" }));
    expect((await backend.settings()).schedule).toBeNull();
  });

  it("sets a slower limit for set hours, apart from the schedule", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Download at set times" }));
    await user.click(screen.getByRole("switch", { name: "Slower at set hours" }));
    expect((await backend.settings()).slowHours).toEqual({ limit: 2 << 20, hours: { days: 0b001_1111, start: 540, stop: 1020 } });

    const limit = screen.getByRole("textbox", { name: "Slower limit" });
    await user.clear(limit);
    await user.type(limit, "0.5{Enter}");
    expect((await backend.settings()).slowHours?.limit).toBe(512 << 10);
    const from = screen.getByRole("textbox", { name: "Slower hours" });
    await user.clear(from);
    await user.type(from, "8:00{Enter}");
    await user.click(within(screen.getByRole("group", { name: "Slower days" })).getByRole("button", { name: "Saturday" }));
    expect((await backend.settings()).slowHours?.hours).toEqual({ days: 0b011_1111, start: 480, stop: 1020 });
    expect((await backend.settings()).schedule, "the schedule keeps its own hours").toEqual({ days: 0b111_1111, start: 60, stop: 420 });

    await user.click(screen.getByRole("switch", { name: "Slower at set hours" }));
    expect((await backend.settings()).slowHours).toBeNull();
  });

  it("says why queued downloads wait outside the scheduled hours", async () => {
    const backend = createMockBackend({ seed: [{ url: "https://example.org/night.iso", state: "queued" }] });
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const later = (by: number) => (minute + by) % 1440;
    await backend.updateSettings({ ...(await backend.settings()), schedule: { days: 0b111_1111, start: later(120), stop: later(180) } });
    render(<App store={createDownloadsStore(backend)} />);
    expect(await screen.findByText("Outside the scheduled hours")).toBeInTheDocument();
    expect((await backend.list())[0]?.state).toBe("queued");
  });
});

describe("types", () => {
  it("lists the types of the downloads and shows one type at a time", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    const types = within(await screen.findByRole("navigation", { name: "Types" }));
    expect(types.getAllByRole("button").map((button) => button.textContent)).toEqual(["Videos1", "Archives2", "Disk images1", "Other files1"]);

    await user.click(types.getByRole("button", { name: /Archives/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Archives" })).toBeInTheDocument();
    const list = within(screen.getByRole("grid", { name: "Archives" }));
    expect(downloadRows("Archives")).toHaveLength(2);
    expect(list.getByText("blender-5.1-linux-x64.tar.xz")).toBeInTheDocument();
    expect(list.getByText("noto-fonts-2026.11.zip")).toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    await user.type(bar.getByRole("combobox"), "disk images");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 1, name: "Disk images" })).toBeInTheDocument();
  });
});

describe("status bar", () => {
  it("shows the free space and turns the speed limit on and off", async () => {
    const { backend, user } = open();
    const status = within(await screen.findByRole("region", { name: "Status" }));
    expect(await status.findByText("412 GB")).toBeInTheDocument();
    const limit = status.getByRole("button", { name: /No limit/ });
    expect(limit).toHaveAttribute("aria-pressed", "false");

    await user.click(limit);
    expect((await backend.settings()).speedLimit).toBe(10 * MB);
    expect(status.getByRole("button", { name: /Limit 10\.0 MB\/s/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(status.getByRole("button", { name: /Limit/ }));
    expect((await backend.settings()).speedLimit).toBeNull();
  });

  it("says when the slower hours hold the speed down", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    await backend.updateSettings({
      ...(await backend.settings()),
      speedLimit: 8 * MB,
      slowHours: { limit: 2 * MB, hours: { days: 0b111_1111, start: (minute + 1380) % 1440, stop: (minute + 60) % 1440 } },
    });
    render(<App store={createDownloadsStore(backend)} />);
    const status = within(await screen.findByRole("region", { name: "Status" }));
    expect(await status.findByRole("button", { name: /Slower hours 2\.00 MB\/s/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the plain limit when it is lower than the slower hours' one", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    await backend.updateSettings({
      ...(await backend.settings()),
      speedLimit: 2 * MB,
      slowHours: { limit: 8 * MB, hours: { days: 0b111_1111, start: 0, stop: 1439 } },
    });
    render(<App store={createDownloadsStore(backend)} />);
    const status = within(await screen.findByRole("region", { name: "Status" }));
    expect(await status.findByRole("button", { name: /^Limit 2\.00 MB\/s/ })).toBeInTheDocument();
  });

  it("brings back the last limit after a visit to Settings", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    await backend.updateSettings({ ...(await backend.settings()), speedLimit: 2 * MB });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    const status = () => within(screen.getByRole("region", { name: "Status" }));
    await user.click(await status().findByRole("button", { name: /Limit 2\.00 MB\/s/ }));
    expect((await backend.settings()).speedLimit).toBeNull();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(await status().findByRole("button", { name: /No limit/ }));
    expect((await backend.settings()).speedLimit).toBe(2 * MB);
  });
});

describe("table", () => {
  it("sorts by a column's header, down first for numbers, and keeps the sort", async () => {
    const { backend, user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    const names = () => downloadRows("All downloads").map((r) => r.querySelector("td")?.textContent);
    const size = screen.getByRole("columnheader", { name: "Size" });

    await user.click(within(size).getByRole("button"));
    expect(size).toHaveAttribute("aria-sort", "descending");
    expect(names()[0]).toBe("fedora-kde-44-x86_64.iso");
    expect((await backend.settings()).sort).toBe("-size");

    await user.click(within(size).getByRole("button"));
    expect(size).toHaveAttribute("aria-sort", "ascending");
    expect(names()[0]).toBe("noto-fonts-2026.11.zip");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "none");
  });

  it("moves through the Columns menu with the keyboard and gives focus back", async () => {
    const { store, user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    const trigger = screen.getByRole("button", { name: "Columns" });
    await user.click(trigger);
    const menu = within(screen.getByRole("menu", { name: "Columns" }));
    expect(menu.getByRole("menuitemcheckbox", { name: "Progress" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(menu.getByRole("menuitemcheckbox", { name: "Size" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(menu.getByRole("menuitemcheckbox", { name: "Queue" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(menu.getByRole("menuitemcheckbox", { name: "Progress" })).toHaveFocus();
    expect(store.getState().selected, "the arrows stay in the menu").toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Columns" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("says why a sort didn't save", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore({ ...backend, updateSettings: () => Promise.reject(new BackendError("storage", "the disk is full")) })} />);
    const user = userEvent.setup();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.click(within(screen.getByRole("columnheader", { name: "Size" })).getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the sort: the disk is full");
  });

  it("picks the columns it shows, and always keeps name and status", async () => {
    const { backend, user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.click(screen.getByRole("button", { name: "Columns" }));
    const menu = within(screen.getByRole("menu", { name: "Columns" }));
    expect(menu.queryByRole("menuitemcheckbox", { name: "Name" })).not.toBeInTheDocument();
    await user.click(menu.getByRole("menuitemcheckbox", { name: "Source" }));
    await user.click(menu.getByRole("menuitemcheckbox", { name: "Queue" }));
    expect((await backend.settings()).columns).toEqual(["name", "status", "progress", "size", "speed", "left", "connections", "queue"]);
    expect(screen.queryByRole("columnheader", { name: "Source" })).not.toBeInTheDocument();
    expect(row("blender-5.1-linux-x64.tar.xz").getByText("#1")).toBeInTheDocument();
  });
});

describe("search", () => {
  it("narrows the list to the downloads whose name or link has the words", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await screen.findByText("fedora-kde-44-x86_64.iso");

    await user.keyboard("{Control>}f{/Control}");
    const field = screen.getByRole("searchbox", { name: "Search downloads" });
    expect(field).toHaveFocus();
    await user.type(field, "mirror");
    const list = within(screen.getByRole("grid", { name: "All downloads" }));
    await vi.waitFor(() => {
      expect(downloadRows("All downloads")).toHaveLength(2);
    });
    expect(list.getByText("blender-5.1-linux-x64.tar.xz")).toBeInTheDocument();

    await user.type(field, " zzz");
    expect(await screen.findByRole("heading", { name: "Nothing matches" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("");
    await vi.waitFor(() => {
      expect(downloadRows("All downloads")).toHaveLength(5);
    });
  });
});

describe("saved views", () => {
  it("saves a search, opens it again from the sidebar, and removes it", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.click(screen.getByRole("button", { name: /Archives/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search downloads" }), "mirror");
    await user.click(await screen.findByRole("button", { name: "Save view" }));
    expect((await backend.settings()).savedViews).toEqual([{ name: "mirror", view: "archive", query: "mirror" }]);
    expect(screen.queryByRole("button", { name: "Save view" }), "a saved search has no Save").not.toBeInTheDocument();

    const saved = within(screen.getByRole("navigation", { name: "Saved" }));
    expect(saved.getByRole("button", { name: "mirror" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Archives/ })).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.clear(screen.getByRole("searchbox", { name: "Search downloads" }));
    await user.click(saved.getByRole("button", { name: "mirror" }));
    expect(screen.getByRole("searchbox", { name: "Search downloads" })).toHaveValue("mirror");
    expect(screen.getByRole("heading", { level: 1, name: "Archives" })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(downloadRows("Archives")).toHaveLength(1);
    });

    await user.click(saved.getByRole("button", { name: "Remove mirror" }));
    expect((await backend.settings()).savedViews).toEqual([]);
    expect(screen.queryByRole("navigation", { name: "Saved" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("row", { name: /^conference-talk-1080p\.mp4/ })).toHaveFocus();
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
    await user.click(await screen.findByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
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
    const fedora = screen.getByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ });
    expect(fedora).toHaveFocus();
    expect(fedora).toHaveAttribute("aria-selected", "true");
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

  it("keeps a list of sites that Tug leaves to the browser", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const field = screen.getByRole("textbox", { name: "Sites Tug leaves to the browser" });
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();

    await user.type(field, "https://Mail.Example.org/inbox{Enter}");
    expect((await backend.settings()).excludedSites).toEqual(["mail.example.org"]);
    expect(field).toHaveValue("");
    await user.type(field, "*.bank.example");
    await user.click(add);
    expect((await backend.settings()).excludedSites).toEqual(["mail.example.org", "bank.example"]);

    await user.type(field, "mail.example.org{Enter}");
    expect((await backend.settings()).excludedSites).toEqual(["mail.example.org", "bank.example"]);

    await user.type(field, "exa mple{Enter}");
    expect(screen.getByText("Enter a site, like example.org.")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    await user.type(field, "x");
    expect(screen.queryByText("Enter a site, like example.org.")).not.toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Sites Tug leaves to the browser" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["mail.example.org", "bank.example"]);
    await user.click(screen.getByRole("button", { name: "Remove mail.example.org" }));
    expect((await backend.settings()).excludedSites).toEqual(["bank.example"]);
  });

  it("goes to a download from the settings page", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox"), "fedora");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 1, name: "All downloads" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).toBeInTheDocument();
  });

  it("leaves a precise speed limit alone when its field is only visited", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    await backend.updateSettings({ ...(await backend.settings()), speedLimit: Math.round(0.14 * MB) });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const field = screen.getByRole("textbox", { name: "Speed limit" });
    expect(field).toHaveValue("0.14");
    await user.click(field);
    await user.tab();
    expect((await backend.settings()).speedLimit).toBe(Math.round(0.14 * MB));
    expect(screen.queryByText("Enter a speed above zero.")).not.toBeInTheDocument();
  });

  it("keeps list shortcuts quiet on the settings page", async () => {
    const { user, store } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>},{/Control}");
    await user.keyboard("{ArrowDown}");
    expect(store.getState().selected).toBeNull();
  });
});

describe("appearance", () => {
  const theme = () => document.documentElement.dataset.theme;

  it("follows the system's color scheme as it changes", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, colorScheme: "dark" });
    render(<App store={createDownloadsStore(backend)} />);
    await screen.findByText("fedora-kde-44-x86_64.iso");
    expect(theme()).toBe("dark");
    act(() => {
      backend.setColorScheme("light");
    });
    expect(theme()).toBe("light");
    act(() => {
      backend.setColorScheme(null);
    });
    expect(theme()).toBe("light");
  });

  it("keeps the theme the person picks, with the arrow keys too", async () => {
    const backend = createMockBackend({ seed: SHOWCASE, colorScheme: "light" });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const group = within(screen.getByRole("radiogroup", { name: "Appearance" }));
    expect(group.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");

    await user.click(group.getByRole("radio", { name: "Dark" }));
    expect(theme()).toBe("dark");
    expect((await backend.settings()).appearance).toBe("dark");
    act(() => {
      backend.setColorScheme("light");
    });
    expect(theme()).toBe("dark");

    await user.keyboard("{ArrowRight}");
    expect(group.getByRole("radio", { name: "System" })).toHaveFocus();
    expect(theme()).toBe("light");
    await user.keyboard("{ArrowRight}");
    expect(group.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect((await backend.settings()).appearance).toBe("light");
  });
});

