import type { Api, Cookie, DownloadItem, MenuClick, Tab } from "../src/api.ts";

export interface Fake {
  api: Api;
  calls: string[];
  sent: Record<string, unknown>[];
  menus: unknown[];
  cookieQueries: unknown[];
  install(): void;
  create(item: DownloadItem): void;
  click(info: MenuClick, tab?: Tab): void;
}

export interface FakeOptions {
  reply?: (message: Record<string, unknown>) => Promise<unknown>;
  cookies?: Cookie[];
}

export const ADDED = { ok: true, type: "added", added: [{ name: "a.iso" }], failed: [] };

export function fakeBrowser(options: FakeOptions = {}): Fake {
  const calls: string[] = [];
  const sent: Record<string, unknown>[] = [];
  const menus: unknown[] = [];
  const cookieQueries: unknown[] = [];
  const installed: (() => void)[] = [];
  const created: ((item: DownloadItem) => void)[] = [];
  const clicked: ((info: MenuClick, tab?: Tab) => void)[] = [];
  const done = (call: string) => {
    calls.push(call);
    return Promise.resolve();
  };
  const api: Api = {
    runtime: {
      sendNativeMessage: (application, message) => {
        calls.push(`native ${application}`);
        const body = message as Record<string, unknown>;
        sent.push(body);
        return options.reply ? options.reply(body) : Promise.resolve(ADDED);
      },
      onInstalled: { addListener: (callback) => installed.push(callback) },
    },
    downloads: {
      onCreated: { addListener: (callback) => created.push(callback) },
      pause: (id) => done(`pause ${String(id)}`),
      resume: (id) => done(`resume ${String(id)}`),
      cancel: (id) => done(`cancel ${String(id)}`),
      erase: ({ id }) => done(`erase ${String(id)}`),
      download: ({ url }) => {
        calls.push(`download ${url}`);
        return Promise.resolve(99);
      },
    },
    cookies: {
      getAll: (details) => {
        cookieQueries.push(details);
        return Promise.resolve(options.cookies ?? []);
      },
    },
    contextMenus: {
      create: (properties) => menus.push(properties),
      onClicked: { addListener: (callback) => clicked.push(callback) },
    },
  };
  return {
    api,
    calls,
    sent,
    menus,
    cookieQueries,
    install: () => {
      for (const listener of installed) listener();
    },
    create: (item) => {
      for (const listener of created) listener(item);
    },
    click: (info, tab) => {
      for (const listener of clicked) listener(info, tab);
    },
  };
}
