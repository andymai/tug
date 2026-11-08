import { useSyncExternalStore } from "react";

import type { ColorScheme } from "../backend/backend";
import { useDownloads } from "./context";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

function mediaScheme(): ColorScheme {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

export function useTheme(): ColorScheme {
  const appearance = useDownloads((s) => s.settings?.appearance ?? "system");
  const system = useDownloads((s) => s.systemScheme);
  const media = useSyncExternalStore(subscribe, mediaScheme);
  if (appearance !== "system") return appearance;
  return system ?? media;
}
