import { createContext, useContext } from "react";
import { useStore } from "zustand";

import type { DownloadsState, DownloadsStore } from "./downloads";

export const DownloadsContext = createContext<DownloadsStore | null>(null);

export function useDownloadsStore(): DownloadsStore {
  const store = useContext(DownloadsContext);
  if (!store) throw new Error("useDownloads needs a DownloadsContext provider");
  return store;
}

export function useDownloads<T>(selector: (state: DownloadsState) => T): T {
  return useStore(useDownloadsStore(), selector);
}
