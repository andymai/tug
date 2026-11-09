export interface Listener<Args extends unknown[]> {
  addListener(callback: (...args: Args) => void): void;
}

export interface DownloadItem {
  id: number;
  url: string;
  referrer?: string;
  totalBytes?: number;
  state?: string;
  incognito?: boolean;
  cookieStoreId?: string;
}

export interface Cookie {
  name: string;
  value: string;
  path: string;
}

export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string;
  srcUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
}

export interface PageRequest {
  url: string;
  method: string;
}

export interface Tab {
  cookieStoreId?: string;
  incognito?: boolean;
}

export interface Api {
  runtime: {
    sendNativeMessage(application: string, message: object): Promise<unknown>;
    onInstalled: Listener<[]>;
  };
  downloads: {
    onCreated: Listener<[DownloadItem]>;
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
    cancel(id: number): Promise<void>;
    erase(query: { id: number }): Promise<unknown>;
    download(options: { url: string; cookieStoreId?: string }): Promise<number>;
  };
  cookies: {
    getAll(details: { url: string; storeId?: string }): Promise<Cookie[]>;
  };
  webRequest: {
    onBeforeRequest: {
      addListener(callback: (request: PageRequest) => void, filter: { urls: string[]; types: string[] }): void;
    };
  };
  contextMenus: {
    create(properties: { id: string; title: string; contexts: string[] }): unknown;
    onClicked: Listener<[MenuClick, Tab?]>;
  };
}
