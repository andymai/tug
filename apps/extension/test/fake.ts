import type { Api, Cookie, DownloadItem, MenuClick, PageRequest, Tab } from "../src/api.ts";

export interface Fake {
  api: Api;
  calls: string[];
  sent: Record<string, unknown>[];
  menus: unknown[];
  cookieQueries: unknown[];
  requestFilters: unknown[];
  install(): void;
  request(request: PageRequest): void;
  create(item: DownloadItem): void;
  click(info: MenuClick, tab?: Tab): void;
}

export interface FakeOptions {
  reply?: (message: Record<string, unknown>) => Promise<unknown>;
  cookies?: Cookie[];
  pauseFails?: boolean;
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
  const requested: ((request: PageRequest) => void)[] = [];
  const requestFilters: unknown[] = [];
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
      pause: (id) => (options.pauseFails === true ? Promise.reject(new Error("Download must be in progress")) : done(`pause ${String(id)}`)),
      resume: (id) => done(`resume ${String(id)}`),
      cancel: (id) => done(`cancel ${String(id)}`),
      erase: ({ id }) => done(`erase ${String(id)}`),
      download: ({ url, cookieStoreId }) => {
        calls.push(cookieStoreId === undefined ? `download ${url}` : `download ${url} in ${cookieStoreId}`);
        return Promise.resolve(99);
      },
    },
    cookies: {
      getAll: (details) => {
        cookieQueries.push(details);
        return Promise.resolve(options.cookies ?? []);
      },
    },
    webRequest: {
      onBeforeRequest: {
        addListener: (callback, filter) => {
          requested.push(callback);
          requestFilters.push(filter);
        },
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
    requestFilters,
    request: (request) => {
      for (const listener of requested) listener(request);
    },
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
