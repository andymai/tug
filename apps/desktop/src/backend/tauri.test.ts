import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const { PROGRESS_EVENT, tauriBackend } = await import("./tauri");
const { BackendError } = await import("./backend");

describe("tauri backend", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    listen.mockReset().mockResolvedValue(() => undefined);
  });

  it("calls the Rust commands by name with camelCase arguments", async () => {
    await tauriBackend.list();
    await tauriBackend.add("https://example.org/a.iso");
    await tauriBackend.add("https://example.org/b.iso", "/data");
    await tauriBackend.pause(3);
    await tauriBackend.resume(3);
    await tauriBackend.remove(3, true);
    await tauriBackend.openFile(3);
    await tauriBackend.showInFolder(3);
    await tauriBackend.events(3);
    await tauriBackend.settings();
    const settings = { downloadDir: "/d", connections: 8, speedLimit: null };
    await tauriBackend.updateSettings(settings);

    expect(invoke.mock.calls).toEqual([
      ["list_downloads", undefined],
      ["add_download", { url: "https://example.org/a.iso", dir: null }],
      ["add_download", { url: "https://example.org/b.iso", dir: "/data" }],
      ["pause_download", { id: 3 }],
      ["resume_download", { id: 3 }],
      ["remove_download", { id: 3, deleteFile: true }],
      ["open_file", { id: 3 }],
      ["show_in_folder", { id: 3 }],
      ["download_events", { id: 3 }],
      ["get_settings", undefined],
      ["update_settings", { settings }],
    ]);
  });

  it("passes each progress event's payload to the listener", async () => {
    const seen: unknown[] = [];
    await tauriBackend.onProgress((batch) => seen.push(batch));
    const [event, handler] = listen.mock.calls[0] as [string, (e: { payload: unknown }) => void];
    expect(event).toBe(PROGRESS_EVENT);
    handler({ payload: { seq: 1, updates: [], settled: [], error: null } });
    expect(seen).toEqual([{ seq: 1, updates: [], settled: [], error: null }]);
  });

  it("turns a command's error into a BackendError with its kind", async () => {
    invoke.mockRejectedValueOnce({ kind: "notFound", message: "there is no download 9" });
    const error: unknown = await tauriBackend.pause(9).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({ kind: "notFound", message: "there is no download 9" });
  });
});
