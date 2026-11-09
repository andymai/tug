import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("adds with its own folder, connections and limit, paused and first in the queue", async () => {
    const { backend, user } = open();
    const add = vi.spyOn(backend, "add");
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add downloads" }));
    await user.type(dialog.getByRole("textbox", { name: "Links" }), "https://example.org/own.iso");
    await user.click(dialog.getByRole("button", { name: "Options" }));
    expect(dialog.getByRole("button", { name: "Options" })).toHaveAttribute("aria-expanded", "true");
    expect(dialog.getByRole("textbox", { name: "Connections" })).toHaveAttribute("placeholder", "8");

    await user.type(dialog.getByRole("textbox", { name: "Connections" }), "0");
    await user.click(dialog.getByRole("button", { name: "Add" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Enter 1 to 32 connections.");
    expect(add).not.toHaveBeenCalled();

    await user.clear(dialog.getByRole("textbox", { name: "Connections" }));
    await user.type(dialog.getByRole("textbox", { name: "Connections" }), "4");
    await user.clear(dialog.getByRole("textbox", { name: "Folder" }));
    expect(dialog.getByText("Saves to Downloads"), "an empty folder is Tug's own").toBeInTheDocument();
    await user.type(dialog.getByRole("textbox", { name: "Folder" }), "Media");
    await user.click(dialog.getByRole("button", { name: "Add" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Enter a full path, like /home/you/Downloads.");
    expect(add).not.toHaveBeenCalled();
    await user.type(dialog.getByRole("textbox", { name: "Speed limit" }), "2");
    await user.click(dialog.getByRole("button", { name: "Choose…" }));
    expect(await dialog.findByText("Saves to Media/Downloads")).toBeInTheDocument();
    await user.click(dialog.getByRole("checkbox", { name: "Start paused" }));
    await user.click(dialog.getByRole("checkbox", { name: "First in the queue" }));
    await user.click(dialog.getByRole("button", { name: "Add" }));

    expect(add).toHaveBeenCalledWith("https://example.org/own.iso", "/home/you/Media/Downloads", {
      paused: true,
      first: true,
      connections: 4,
      speedLimit: 2 * MB,
      name: null,
      referrer: null,
      cookies: null,
      userAgent: null,
    });
    expect(await within(await screen.findByRole("row", { name: /^own\.iso/ })).findByText("Paused")).toBeInTheDocument();
    expect((await backend.settings()).downloadDir, "Tug's own folder stays").toBe("/home/you/Downloads");
  });

  it("gives one link the name the person types", async () => {
    const { backend, user } = open();
    const add = vi.spyOn(backend, "add");
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add downloads" }));
    await user.type(dialog.getByRole("textbox", { name: "Links" }), "https://example.org/x7f3.bin");
    await user.click(dialog.getByRole("button", { name: "Options" }));
    expect(dialog.getByRole("textbox", { name: "Name" })).toHaveAttribute("placeholder", "x7f3.bin");
    await user.type(dialog.getByRole("textbox", { name: "Name" }), "firmware.bin");
    await user.click(dialog.getByRole("button", { name: "Add" }));
    expect(add).toHaveBeenCalledWith("https://example.org/x7f3.bin", undefined, expect.objectContaining({ name: "firmware.bin" }));
    expect(await screen.findByRole("row", { name: /^firmware\.bin/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add" }));
    const again = within(screen.getByRole("dialog", { name: "Add downloads" }));
    await user.type(again.getByRole("textbox", { name: "Links" }), "https://example.org/a.iso{Enter}https://example.org/b.iso");
    await user.click(again.getByRole("button", { name: "Options" }));
    expect(again.queryByRole("textbox", { name: "Name" }), "a name is for one link").not.toBeInTheDocument();
    await user.clear(again.getByRole("textbox", { name: "Links" }));
    await user.type(again.getByRole("textbox", { name: "Links" }), "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056");
    expect(again.queryByRole("textbox", { name: "Name" }), "a torrent keeps its own name").not.toBeInTheDocument();
  });

  it("sends the referrer, cookies and User-Agent the person gives", async () => {
    const { backend, user } = open();
    const add = vi.spyOn(backend, "add");
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add downloads" }));
    await user.type(dialog.getByRole("textbox", { name: "Links" }), "https://example.org/report.pdf");
    await user.click(dialog.getByRole("button", { name: "Options" }));
    await user.type(dialog.getByRole("textbox", { name: "Referrer" }), "https://example.org/reports");
    await user.type(dialog.getByLabelText("Cookies"), " session=abc ");
    await user.type(dialog.getByRole("textbox", { name: "User agent" }), "Mozilla/5.0 Test");
    await user.click(dialog.getByRole("button", { name: "Add" }));
    expect(add).toHaveBeenCalledWith(
      "https://example.org/report.pdf",
      undefined,
      expect.objectContaining({ referrer: "https://example.org/reports", cookies: "session=abc", userAgent: "Mozilla/5.0 Test" }),
    );
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

  it("shows a running download's segments, connections and server, and keeps them fresh", async () => {
    const { backend, user } = open();
    const inspect = vi.spyOn(backend, "inspect");
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    const panel = within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }));
    await user.click(panel.getByRole("tab", { name: "Connections" }));
    expect(panel.getByRole("tab", { name: "Connections" })).toHaveAttribute("aria-selected", "true");

    const tab = within(panel.getByRole("tabpanel", { name: "Connections" }));
    const segments = within(await tab.findByRole("region", { name: "Segments" }));
    expect(segments.getByRole("img")).toHaveAccessibleName(/^8 segments, .* on disk$/);
    const table = within(tab.getByRole("table", { name: "Connections" }));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    expect(within(rows[0] as HTMLElement).getByText("Receiving")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Retrying")).toHaveAttribute("title", "The server closed the connection");
    const server = within(tab.getByRole("region", { name: "Server" }));
    expect(server.getByText("203.0.113.24")).toBeInTheDocument();
    expect(server.getByText("38 ms")).toBeInTheDocument();
    expect(server.getByText("Fastly")).toBeInTheDocument();

    const calls = inspect.mock.calls.length;
    await vi.waitFor(() => {
      expect(inspect.mock.calls.length).toBeGreaterThan(calls);
    }, { timeout: 2000 });
  });

  it("keeps a stopped download's map without its connections, and explains a waiting one", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("row", { name: /^conference-talk-1080p\.mp4/ }));
    let panel = within(screen.getByRole("complementary", { name: "conference-talk-1080p.mp4" }));
    await user.click(panel.getByRole("tab", { name: "Connections" }));
    expect(await panel.findByRole("region", { name: "Segments" })).toBeInTheDocument();
    expect(panel.queryByRole("table", { name: "Connections" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("row", { name: /^blender-5\.1-linux-x64\.tar\.xz/ }));
    panel = within(screen.getByRole("complementary", { name: "blender-5.1-linux-x64.tar.xz" }));
    expect(panel.getByRole("tab", { name: "Connections" })).toHaveAttribute("aria-selected", "true");
    expect(await panel.findByText("Tug shows the segments and connections while a download runs, and keeps them until Tug quits.")).toBeInTheDocument();
  });

  it("shows the engine's log and copies it", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("row", { name: /^dataset-shard-07\.parquet/ }));
    const panel = within(screen.getByRole("complementary", { name: "dataset-shard-07.parquet" }));
    await user.click(panel.getByRole("tab", { name: "Log" }));
    const log = within(panel.getByRole("tabpanel", { name: "Log" }));
    const lines = (await log.findAllByRole("listitem")).map((item) => item.textContent);
    expect(lines[0]).toMatch(/Connected to mirror\.example\.org \(203\.0\.113\.24\)/);
    expect(lines.at(-1)).toMatch(/Connection 1: couldn't reach mirror\.example\.org$/);

    await user.click(log.getByRole("button", { name: "Copy log" }));
    expect(log.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    const copied = (await navigator.clipboard.readText()).split("\n");
    expect(copied).toHaveLength(lines.length);
    expect(copied.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Connection 1: couldn't reach mirror\.example\.org$/);
  });

  it("moves between its tabs with the arrow keys, Home and End", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    const panel = within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }));
    panel.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(panel.getByRole("tab", { name: "Connections" })).toHaveFocus();
    expect(panel.getByRole("tab", { name: "Connections" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(panel.getByRole("tab", { name: "Log" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(panel.getByRole("tab", { name: "Overview" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{Home}");
    expect(panel.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(panel.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ })).toHaveAttribute("aria-selected", "true");
  });

  it("changes a download's own connections and limit, and says what holds when", async () => {
    const { backend, user } = open();
    const setOptions = vi.spyOn(backend, "setOptions");
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    const panel = within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }));
    const options = within(panel.getByRole("region", { name: "Options" }));
    expect(options.getByText("A new limit holds at once; connections change at the next start.")).toBeInTheDocument();

    await user.type(options.getByRole("textbox", { name: "Speed limit" }), "fast{Enter}");
    expect(options.getByRole("alert")).toHaveTextContent("Enter a speed above zero.");
    expect(setOptions).not.toHaveBeenCalled();

    await user.clear(options.getByRole("textbox", { name: "Speed limit" }));
    await user.type(options.getByRole("textbox", { name: "Speed limit" }), "1.5");
    await user.type(options.getByRole("textbox", { name: "Connections" }), "4{Enter}");
    expect(setOptions).toHaveBeenCalledWith(expect.any(Number), 4, Math.round(1.5 * MB));
    await vi.waitFor(() => {
      expect(within(panel.getByRole("region", { name: "Options" })).getByRole("textbox", { name: "Connections" })).toHaveValue("4");
    });

    await user.click(screen.getByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
    expect(within(screen.getByRole("complementary", { name: "noto-fonts-2026.11.zip" })).queryByRole("region", { name: "Options" })).not.toBeInTheDocument();
  });

  it("keeps an edit made while a save is on its way, and a tiny limit as it is", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const fedora = (await backend.list()).find((d) => d.name === "fedora-kde-44-x86_64.iso")?.id ?? -1;
    await backend.setOptions(fedora, null, 1049);
    const saves: (() => void)[] = [];
    const slow = {
      ...backend,
      setOptions: (id: number, connections: number | null, speedLimit: number | null) =>
        new Promise<Awaited<ReturnType<typeof backend.setOptions>>>((resolve) => {
          saves.push(() => {
            resolve(backend.setOptions(id, connections, speedLimit));
          });
        }),
    };
    const sent = vi.spyOn(slow, "setOptions");
    render(<App store={createDownloadsStore(slow)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    const options = within(screen.getByRole("region", { name: "Options" }));
    expect(options.getByRole("textbox", { name: "Speed limit" })).toHaveValue("0.001");

    await user.type(options.getByRole("textbox", { name: "Connections" }), "4{Enter}");
    expect(sent).toHaveBeenLastCalledWith(fedora, 4, 1049);
    await user.clear(options.getByRole("textbox", { name: "Connections" }));
    await user.type(options.getByRole("textbox", { name: "Connections" }), "8");
    await act(async () => {
      saves.shift()?.();
      await Promise.resolve();
    });
    await vi.waitFor(async () => {
      expect((await backend.list()).find((d) => d.id === fedora)?.connections).toBe(4);
    });
    expect(options.getByRole("textbox", { name: "Connections" }), "the newer edit stays").toHaveValue("8");
  });

  it("renames a finished file, keeps the name on Escape, and refuses a bad one", async () => {
    const { backend, user } = open();
    const rename = vi.spyOn(backend, "rename");
    await user.click(await screen.findByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
    let panel = within(screen.getByRole("complementary", { name: "noto-fonts-2026.11.zip" }));
    await user.click(panel.getByRole("button", { name: "Rename" }));
    const field = panel.getByRole("textbox", { name: "Name" });
    expect(field).toHaveFocus();
    expect([(field as HTMLInputElement).selectionStart, (field as HTMLInputElement).selectionEnd]).toEqual([0, "noto-fonts-2026.11".length]);
    await user.keyboard("{Escape}");
    expect(panel.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "noto-fonts-2026.11.zip" }), "Escape keeps the panel").toBeInTheDocument();

    await user.keyboard("{F2}");
    await user.keyboard("a/b{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't rename it/);
    expect(panel.queryByRole("textbox", { name: "Name" }), "Enter closes the editor").not.toBeInTheDocument();
    await user.keyboard("{F2}");
    await user.clear(panel.getByRole("textbox", { name: "Name" }));
    await user.type(panel.getByRole("textbox", { name: "Name" }), "fonts.zip{Enter}");
    expect(rename).toHaveBeenLastCalledWith(expect.any(Number), "fonts.zip");
    panel = within(await screen.findByRole("complementary", { name: "fonts.zip" }));
    expect(panel.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /^fonts\.zip/ })).toBeInTheDocument();

    await user.click(screen.getByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    expect(within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" })).queryByRole("button", { name: "Rename" }), "a running download keeps its name").not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("row", { name: /^blender-5\.1-linux-x64\.tar\.xz/ }), { clientX: 200, clientY: 200 });
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Rename…" }));
    expect(within(screen.getByRole("complementary", { name: "blender-5.1-linux-x64.tar.xz" })).getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("keeps an editor open for another download when an earlier rename answers late", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const answers: (() => void)[] = [];
    const slow = {
      ...backend,
      rename: (id: number, name: string) =>
        new Promise<Awaited<ReturnType<typeof backend.rename>>>((resolve) => {
          answers.push(() => {
            resolve(backend.rename(id, name));
          });
        }),
    };
    render(<App store={createDownloadsStore(slow)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
    await user.keyboard("{F2}");
    await user.keyboard("fonts{Enter}");
    await user.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "Name" }), "a new draft while the answer is on its way").toHaveFocus();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("row", { name: /^blender-5\.1-linux-x64\.tar\.xz/ }));
    await user.keyboard("{F2}");
    const blender = within(screen.getByRole("complementary", { name: "blender-5.1-linux-x64.tar.xz" }));
    expect(blender.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await act(async () => {
      answers.shift()?.();
      await Promise.resolve();
    });
    expect(await screen.findByRole("row", { name: /^fonts\.zip/ })).toBeInTheDocument();
    expect(blender.getByRole("textbox", { name: "Name" }), "B's editor stays").toBeInTheDocument();
  });

  it("changes the headers a waiting download sends, and never shows its cookies", async () => {
    const { backend, user } = open();
    const setHeaders = vi.spyOn(backend, "setHeaders");
    await user.click(await screen.findByRole("row", { name: /^blender-5\.1-linux-x64\.tar\.xz/ }));
    const panel = within(screen.getByRole("complementary", { name: "blender-5.1-linux-x64.tar.xz" }));
    const headers = within(await panel.findByRole("region", { name: "Headers" }));

    await user.type(headers.getByRole("textbox", { name: "Referrer" }), "ftp://nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/referrer isn't a web address/);
    await user.clear(headers.getByRole("textbox", { name: "Referrer" }));
    await user.type(headers.getByRole("textbox", { name: "Referrer" }), "https://example.org/page{Enter}");
    expect(setHeaders).toHaveBeenLastCalledWith(expect.any(Number), "https://example.org/page", { kind: "keep" }, null);

    const secret = headers.getByLabelText("Cookies");
    expect(secret).toHaveAttribute("type", "password");
    await user.type(secret, "session=secret{Enter}");
    expect(setHeaders).toHaveBeenLastCalledWith(expect.any(Number), "https://example.org/page", { kind: "set", value: "session=secret" }, null);
    expect(await headers.findByText("Sent")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("session=secret")).not.toBeInTheDocument();

    await user.click(headers.getByRole("button", { name: "Clear" }));
    expect(setHeaders).toHaveBeenLastCalledWith(expect.any(Number), "https://example.org/page", { kind: "clear" }, null);
    expect(await headers.findByLabelText("Cookies")).toHaveAttribute("type", "password");
  });

  it("shows the referrer as Tug saved it, and keeps newer edits when saves answer late", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const answers: (() => void)[] = [];
    let slow = false;
    const shown = {
      ...backend,
      setHeaders: (...args: Parameters<typeof backend.setHeaders>) =>
        slow
          ? new Promise<Awaited<ReturnType<typeof backend.setHeaders>>>((resolve) => {
              answers.push(() => {
                resolve(backend.setHeaders(...args));
              });
            })
          : backend.setHeaders(...args),
    };
    const sent = vi.spyOn(shown, "setHeaders");
    render(<App store={createDownloadsStore(shown)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^blender-5\.1-linux-x64\.tar\.xz/ }));
    let headers = within(await screen.findByRole("region", { name: "Headers" }));
    await user.type(headers.getByRole("textbox", { name: "Referrer" }), "https://user:pw@example.org#top{Enter}");
    expect(await headers.findByDisplayValue("https://example.org/")).toBeInTheDocument();
    const calls = sent.mock.calls.length;
    await user.click(headers.getByRole("textbox", { name: "User agent" }));
    await user.click(headers.getByRole("textbox", { name: "Referrer" }));
    expect(sent.mock.calls.length, "the saved value is the same, so no new save").toBe(calls);

    slow = true;
    await user.type(headers.getByLabelText("Cookies"), "a=1{Enter}");
    await user.clear(headers.getByLabelText("Cookies"));
    await user.type(headers.getByLabelText("Cookies"), "b=2");
    await act(async () => {
      answers.shift()?.();
      await Promise.resolve();
    });
    expect(headers.getByLabelText("Cookies"), "the newer cookie text stays").toHaveValue("b=2");

    await user.type(headers.getByRole("textbox", { name: "User agent" }), "Late/1{Enter}");
    await user.click(screen.getByRole("row", { name: /^conference-talk-1080p\.mp4/ }));
    headers = within(await screen.findByRole("region", { name: "Headers" }));
    await act(async () => {
      answers.shift()?.();
      await Promise.resolve();
    });
    expect(screen.getByRole("region", { name: "Headers" }), "another download's late answer leaves this one").toBeInTheDocument();
    expect(headers.getByRole("textbox", { name: "User agent" })).toHaveValue("");
  });

  it("shows a torrent's files and peers, and takes the files you choose", async () => {
    const magnet = "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Open%20Movie";
    const { backend, user } = open([
      { url: magnet, state: "downloading", progress: 0.4, size: 2 * 1024 * MB },
      { url: "https://example.org/plain.iso", state: "downloading", progress: 0.2 },
    ]);
    const chooseFiles = vi.spyOn(backend, "chooseFiles");
    await user.click(await screen.findByRole("row", { name: /^Open Movie/ }));
    const panel = within(screen.getByRole("complementary", { name: "Open Movie" }));
    expect(panel.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Files", "Peers"]);

    await user.click(panel.getByRole("tab", { name: "Files" }));
    const files = within(await panel.findByRole("region", { name: "Files" }));
    expect(files.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Open Movie.mkv", "README.txt", "Subtitles/en.srt"]);
    await user.click(files.getByRole("checkbox", { name: "README.txt" }));
    expect(chooseFiles).toHaveBeenLastCalledWith(expect.any(Number), [0, 1]);
    await vi.waitFor(() => {
      expect(files.getByRole("checkbox", { name: "README.txt" })).not.toBeChecked();
    });
    await user.click(files.getByRole("checkbox", { name: "Subtitles/en.srt" }));
    await vi.waitFor(() => {
      expect(files.getByRole("checkbox", { name: "Open Movie.mkv" }), "the last file stays").toBeDisabled();
    });
    await user.click(files.getByRole("button", { name: "Choose all" }));
    await vi.waitFor(() => {
      expect(files.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);
    });

    await user.click(panel.getByRole("tab", { name: "Peers" }));
    const peers = within(await panel.findByRole("region", { name: "Peers" }));
    expect(peers.getByText("4 connected · 23 seen")).toBeInTheDocument();
    expect(peers.getByText("203.0.113.20:6881")).toBeInTheDocument();

    await user.click(screen.getByRole("row", { name: /^plain\.iso/ }));
    const plain = within(screen.getByRole("complementary", { name: "plain.iso" }));
    expect(plain.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Connections", "Log"]);
    expect(plain.getByRole("tab", { name: "Overview" }), "a tab the download lacks shows its Overview").toHaveAttribute("aria-selected", "true");
  });

  it("takes one file choice at a time, and keeps the peer totals with no peer", async () => {
    const magnet = "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Open%20Movie";
    const backend = createMockBackend({ seed: [{ url: magnet, state: "paused", progress: 0.4, size: 2 * 1024 * MB }] });
    const answers: (() => void)[] = [];
    const slow = {
      ...backend,
      chooseFiles: (id: number, files: number[]) =>
        new Promise<Awaited<ReturnType<typeof backend.chooseFiles>>>((resolve) => {
          answers.push(() => {
            resolve(backend.chooseFiles(id, files));
          });
        }),
    };
    render(<App store={createDownloadsStore(slow)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^Open Movie/ }));
    const panel = within(screen.getByRole("complementary", { name: "Open Movie" }));
    await user.click(panel.getByRole("tab", { name: "Files" }));
    const files = within(await panel.findByRole("region", { name: "Files" }));
    await user.click(files.getByRole("checkbox", { name: "README.txt" }));
    expect(files.getByRole("checkbox", { name: "Subtitles/en.srt" }), "no second choice during a save").toBeDisabled();
    await act(async () => {
      answers.shift()?.();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(files.getByRole("checkbox", { name: "Subtitles/en.srt" })).toBeEnabled();
    });

    await user.click(panel.getByRole("tab", { name: "Peers" }));
    const peers = within(await panel.findByRole("region", { name: "Peers" }));
    expect(peers.getByText("0 connected · 0 seen")).toBeInTheDocument();
    expect(peers.getByText("Tug shows the peers while the torrent runs.")).toBeInTheDocument();
    expect(peers.getByText(/Sent to peers/)).toBeInTheDocument();
  });

  it("saves the old referrer again when it comes back during a save", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    const answers: (() => void)[] = [];
    let slow = true;
    // Tug takes saves in order and only the reply is late, as with Tauri's commands.
    const shown = {
      ...backend,
      setHeaders: (...args: Parameters<typeof backend.setHeaders>) => {
        const reply = backend.setHeaders(...args);
        return slow
          ? new Promise<Awaited<typeof reply>>((resolve) => {
              answers.push(() => {
                resolve(reply);
              });
            })
          : reply;
      },
    };
    const sent = vi.spyOn(shown, "setHeaders");
    render(<App store={createDownloadsStore(shown)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("row", { name: /^blender-5\.1-linux-x64\.tar\.xz/ }));
    const headers = within(await screen.findByRole("region", { name: "Headers" }));
    await user.type(headers.getByRole("textbox", { name: "Referrer" }), "https://x.example/{Enter}");
    await user.clear(headers.getByRole("textbox", { name: "Referrer" }));
    slow = false;
    await user.type(headers.getByRole("textbox", { name: "Referrer" }), "{Enter}");
    expect(sent, "back to empty while the first save waits: a second save").toHaveBeenCalledTimes(2);
    expect(sent).toHaveBeenLastCalledWith(expect.any(Number), null, { kind: "keep" }, null);
    await act(async () => {
      answers.shift()?.();
      await Promise.resolve();
    });
    expect(headers.getByRole("textbox", { name: "Referrer" }), "the first save's late answer is outdated").toHaveValue("");
    expect((await backend.headers((await backend.list()).find((d) => d.name === "blender-5.1-linux-x64.tar.xz")?.id ?? -1)).referrer).toBeNull();
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

describe("selection", () => {
  const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(`^${name.replaceAll(".", "\\.")}`) });

  it("selects more with Ctrl, a range with Shift, and shows what they hold", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    fireEvent.click(rowOf("conference-talk-1080p.mp4"), { ctrlKey: true });
    expect(rowOf("fedora-kde-44-x86_64.iso")).toHaveAttribute("aria-selected", "true");
    expect(rowOf("conference-talk-1080p.mp4")).toHaveAttribute("aria-selected", "true");
    let panel = within(screen.getByRole("complementary", { name: "2 downloads" }));
    expect(panel.getByText("1 downloading · 1 paused")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(within(panel.getByRole("list", { name: "Selected downloads" })).getAllByRole("listitem")).toHaveLength(2);

    fireEvent.click(rowOf("dataset-shard-07.parquet"), { shiftKey: true });
    panel = within(screen.getByRole("complementary", { name: "3 downloads" }));
    expect(panel.getByText("1 paused · 1 failed · 1 done")).toBeInTheDocument();
    expect(rowOf("fedora-kde-44-x86_64.iso")).toHaveAttribute("aria-selected", "false");

    await user.click(panel.getByRole("button", { name: "Resume" }));
    expect(await within(rowOf("dataset-shard-07.parquet")).findByText("Queued")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: /downloads$/ })).not.toBeInTheDocument();
  });

  it("selects all with Ctrl+A and a range with Shift and the arrows", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>}a{/Control}");
    expect(screen.getByRole("complementary", { name: "5 downloads" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(rowOf("blender-5.1-linux-x64.tar.xz"));
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(screen.getByRole("complementary", { name: "3 downloads" })).toBeInTheDocument();
    expect(rowOf("noto-fonts-2026.11.zip")).toHaveFocus();
  });

  it("opens a menu on a right-click, moves through it with the keys, and pauses from it", async () => {
    const { user } = open();
    const fedora = await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ });
    fireEvent.contextMenu(fedora, { clientX: 300, clientY: 200 });
    let menu = within(screen.getByRole("menu", { name: "fedora-kde-44-x86_64.iso" }));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Open folder", "Copy link", "Pause", "Remove…"]);
    expect(menu.getByRole("menuitem", { name: "Open folder" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(menu.getByRole("menuitem", { name: "Remove…" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(fedora).toHaveFocus();
    expect(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }), "Escape closes only the menu").toBeInTheDocument();

    fireEvent.contextMenu(fedora, { clientX: 300, clientY: 200 });
    menu = within(screen.getByRole("menu"));
    await user.click(menu.getByRole("menuitem", { name: "Pause" }));
    expect(await within(fedora).findByText("Paused")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the menu for every selected row from the keyboard", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    fireEvent.click(rowOf("blender-5.1-linux-x64.tar.xz"), { ctrlKey: true });
    rowOf("blender-5.1-linux-x64.tar.xz").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = within(screen.getByRole("menu", { name: "2 downloads" }));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Copy links", "Start next", "Move to the end", "Pause", "Remove…"]);
  });

  it("removes after asking, with the file when chosen, and keeps everything on Cancel", async () => {
    const { backend, user } = open();
    const remove = vi.spyOn(backend, "remove");
    await user.click(await screen.findByRole("row", { name: /^noto-fonts-2026\.11\.zip/ }));
    await user.keyboard("{Delete}");
    let dialog = within(screen.getByRole("dialog", { name: "Remove noto-fonts-2026.11.zip?" }));
    expect(dialog.getByText("Tug takes it off the list.")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    await user.keyboard("{Delete}");
    dialog = within(screen.getByRole("dialog", { name: "Remove noto-fonts-2026.11.zip?" }));
    expect(dialog.getByRole("button", { name: "Remove" })).toHaveFocus();
    await user.click(dialog.getByRole("checkbox", { name: "Delete its file too" }));
    await user.click(dialog.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith(expect.any(Number), true);
    await vi.waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "All downloads" })).toHaveFocus();
    });
    expect(screen.queryByText("noto-fonts-2026.11.zip")).not.toBeInTheDocument();
  });

  it("lists the actions for several selected downloads in the command bar", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    fireEvent.click(rowOf("blender-5.1-linux-x64.tar.xz"), { ctrlKey: true });
    fireEvent.click(rowOf("conference-talk-1080p.mp4"), { ctrlKey: true });
    await user.keyboard("{Control>}k{/Control}");
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    const group = within(bar.getByRole("group", { name: "Selected downloads" }));
    expect(group.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Start next",
      "Move to the end",
      expect.stringMatching(/^PauseP$/),
      "Resume",
      "Copy links",
      expect.stringMatching(/^Remove…Del$/),
      expect.stringMatching(/^Clear the selectionEsc$/),
    ]);
  });

  it("acts on the one selected row that a search leaves in view", async () => {
    const { user, store } = open();
    await user.click(await screen.findByRole("row", { name: /^fedora-kde-44-x86_64\.iso/ }));
    fireEvent.click(rowOf("conference-talk-1080p.mp4"), { ctrlKey: true });
    act(() => {
      store.getState().setSearch("fedora");
    });
    await vi.waitFor(() => {
      expect(screen.queryByText("conference-talk-1080p.mp4")).not.toBeInTheDocument();
    });
    const panel = within(screen.getByRole("complementary", { name: "fedora-kde-44-x86_64.iso" }));
    expect(await panel.findByRole("region", { name: "History" })).toBeInTheDocument();
    await user.click(panel.getByRole("tab", { name: "Log" }));
    expect((await within(panel.getByRole("tabpanel", { name: "Log" })).findAllByRole("listitem")).length).toBeGreaterThan(0);
    await user.click(panel.getByRole("tab", { name: "Overview" }));
    await user.keyboard("p");
    await vi.waitFor(() => {
      expect(store.getState().items.find((d) => d.name === "fedora-kde-44-x86_64.iso")?.state).toBe("paused");
    });
    expect(store.getState().items.find((d) => d.name === "conference-talk-1080p.mp4")?.state).toBe("paused");
  });

  it("forgets its menu when the table gives way to the empty view", async () => {
    const backend = createMockBackend({ seed: [{ url: "https://example.org/small.iso", state: "downloading", progress: 0.9, size: MB }] });
    const store = createDownloadsStore(backend);
    render(<App store={store} />);
    const user = userEvent.setup();
    act(() => {
      store.getState().setView("active");
    });
    fireEvent.contextMenu(await screen.findByRole("row", { name: /^small\.iso/ }), { clientX: 200, clientY: 200 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    act(() => {
      backend.tick();
    });
    expect(await screen.findByRole("heading", { name: "Nothing downloading" })).toBeInTheDocument();
    expect(store.getState().menu).toBeNull();
    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("drags waiting downloads into a new order when the table is sorted by the queue", async () => {
    const queue = ["a", "b", "c"].map((name) => ({ url: `https://example.org/${name}.iso`, state: "queued" as const }));
    const { store, user } = open([{ url: "https://example.org/run.iso", state: "downloading", progress: 0.2 }, ...queue]);
    await screen.findByText("a.iso");
    expect(rowOf("a.iso")).not.toHaveAttribute("draggable");
    await act(() => store.getState().saveSettings({ sort: "queue", columns: ["queue"], maxActive: 1 }));
    const order = () => downloadRows("All downloads").map((r) => r.querySelector("td")?.textContent);
    await vi.waitFor(() => {
      expect(order()).toEqual(["a.iso", "b.iso", "c.iso", "run.iso"]);
    });
    expect(rowOf("a.iso")).toHaveAttribute("draggable", "true");

    const types: string[] = [];
    const dataTransfer = {
      types,
      setData: (type: string) => {
        types.push(type);
      },
      getData: () => "https://example.org/x.iso",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(rowOf("c.iso"), { dataTransfer });
    expect(types).toEqual(["application/x-tug-downloads"]);
    // A browser may add text to a drag; the row's own type still keeps the link overlay shut.
    types.push("text/plain");
    fireEvent.dragEnter(rowOf("a.iso"), { dataTransfer });
    expect(screen.queryByText("Drop to add")).not.toBeInTheDocument();
    // jsdom has no DragEvent, so the pointer's height goes on by hand: above the middle.
    const at = (event: Event) => Object.defineProperty(event, "clientY", { value: -1 });
    fireEvent(rowOf("a.iso"), at(createEvent.dragOver(rowOf("a.iso"), { dataTransfer })));
    fireEvent(rowOf("a.iso"), at(createEvent.drop(rowOf("a.iso"), { dataTransfer })));
    await vi.waitFor(() => {
      expect(order()).toEqual(["c.iso", "a.iso", "b.iso", "run.iso"]);
    });

    expect(rowOf("c.iso"), "the drag selects the row it carries").toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await vi.waitFor(() => {
      expect(order()).toEqual(["a.iso", "c.iso", "b.iso", "run.iso"]);
    });
  });

  it("says that a running download stops when several go", async () => {
    const { user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    await user.keyboard("{Control>}a{/Control}{Delete}");
    const dialog = within(screen.getByRole("dialog", { name: "Remove 5 downloads?" }));
    expect(dialog.getByText("Tug stops the running ones and takes them all off the list.")).toBeInTheDocument();
    expect(dialog.getByRole("checkbox", { name: "Delete their files too" })).not.toBeChecked();
  });
});

describe("table", () => {
  it("sets a column's width with the keys, a drag and a double-click", async () => {
    const { backend, user } = open();
    await screen.findByText("fedora-kde-44-x86_64.iso");
    const handle = () => screen.getByRole("separator", { name: "Width of Size" });
    const saved = async () => (await backend.settings()).widths;
    expect(handle()).toHaveAttribute("aria-valuenow", "96");

    handle().focus();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(async () => {
      expect(await saved()).toEqual({ size: 104 });
    });
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await vi.waitFor(async () => {
      expect(await saved()).toEqual({ size: 72 });
    });
    expect(handle()).toHaveAttribute("aria-valuenow", "72");

    // jsdom has no PointerEvent, so the pointer's place goes on by hand.
    const at = (event: Event, x: number) => Object.defineProperty(event, "clientX", { value: x });
    fireEvent(handle(), at(createEvent.pointerDown(handle(), { pointerId: 1 }), 500));
    fireEvent(handle(), at(createEvent.pointerMove(handle(), { pointerId: 1 }), 560));
    expect(handle(), "the column follows the pointer").toHaveAttribute("aria-valuenow", "132");
    fireEvent(handle(), at(createEvent.pointerUp(handle(), { pointerId: 1 }), 560));
    await vi.waitFor(async () => {
      expect(await saved()).toEqual({ size: 132 });
    });

    await user.dblClick(handle());
    await vi.waitFor(async () => {
      expect(await saved()).toEqual({});
    });
    expect(handle()).toHaveAttribute("aria-valuenow", "96");
  });

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

  it("shows a speed limit that changes elsewhere while Settings is open", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    await backend.updateSettings({ ...(await backend.settings()), speedLimit: 2 * MB });
    const store = createDownloadsStore(backend);
    render(<App store={store} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const field = screen.getByRole("textbox", { name: "Speed limit" });
    expect(field).toHaveValue("2");
    await act(() => store.getState().saveSettings({ speedLimit: 5 * MB }));
    expect(field).toHaveValue("5");
  });

  it("keeps a typed speed limit when Tug can't save it, so Enter tries again", async () => {
    const backend = createMockBackend({ seed: SHOWCASE });
    await backend.updateSettings({ ...(await backend.settings()), speedLimit: 10 * MB });
    render(<App store={createDownloadsStore(backend)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    vi.spyOn(backend, "updateSettings").mockRejectedValueOnce(new BackendError("storage", "the disk is full"));
    const field = screen.getByRole("textbox", { name: "Speed limit" });
    await user.clear(field);
    await user.type(field, "20{Enter}");
    expect(await screen.findByText("The disk is full")).toBeInTheDocument();
    expect(field).toHaveValue("20");
    expect((await backend.settings()).speedLimit).toBe(10 * MB);

    await user.type(field, "{Enter}");
    expect((await backend.settings()).speedLimit).toBe(20 * MB);
    expect(field).toHaveValue("20");
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

