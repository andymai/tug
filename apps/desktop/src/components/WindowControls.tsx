import { Copy, Minus, Square, X } from "lucide-react";

import type { ResizeEdge } from "../backend/backend";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";

const CONTROL =
  "inline-flex size-8 items-center justify-center rounded-sm text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out)";

export function WindowControls() {
  const framed = useDownloads((s) => s.framed);
  const maximized = useDownloads((s) => s.maximized);
  const minimize = useDownloads((s) => s.minimizeWindow);
  const toggleMaximize = useDownloads((s) => s.toggleMaximizeWindow);
  const close = useDownloads((s) => s.closeWindow);
  if (!framed) return null;
  const Resize = maximized ? Copy : Square;
  const resizeLabel = maximized ? "Restore" : "Maximize";

  return (
    <div className="-mr-2 flex items-center gap-0.5 border-l border-line pl-2">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={minimize} className={`${CONTROL} hover:bg-hover hover:text-ink`}>
        <Minus {...ICON} />
      </button>
      <button
        type="button"
        aria-label={resizeLabel}
        title={resizeLabel}
        onClick={toggleMaximize}
        className={`${CONTROL} hover:bg-hover hover:text-ink`}
      >
        <Resize {...ICON} size={13} />
      </button>
      <button type="button" aria-label="Close" title="Close" onClick={close} className={`${CONTROL} hover:bg-state-error hover:text-on-primary`}>
        <X {...ICON} />
      </button>
    </div>
  );
}

const EDGES: readonly { edge: ResizeEdge; place: string }[] = [
  { edge: "North", place: "inset-x-2 top-0 h-1 cursor-n-resize" },
  { edge: "South", place: "inset-x-2 bottom-0 h-1 cursor-s-resize" },
  { edge: "West", place: "inset-y-2 left-0 w-1 cursor-w-resize" },
  { edge: "East", place: "inset-y-2 right-0 w-1 cursor-e-resize" },
  { edge: "NorthWest", place: "top-0 left-0 size-2 cursor-nw-resize" },
  { edge: "NorthEast", place: "top-0 right-0 size-2 cursor-ne-resize" },
  { edge: "SouthWest", place: "bottom-0 left-0 size-2 cursor-sw-resize" },
  { edge: "SouthEast", place: "right-0 bottom-0 size-2 cursor-se-resize" },
];

// Without the window manager's frame, GTK gives the window no edges to resize by.
export function ResizeEdges() {
  const framed = useDownloads((s) => s.framed);
  const maximized = useDownloads((s) => s.maximized);
  const startResize = useDownloads((s) => s.startResize);
  if (!framed || maximized) return null;
  return (
    <div aria-hidden="true">
      {EDGES.map(({ edge, place }) => (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a pointer-only handle; the keyboard resizes through the window manager
        <div
          key={edge}
          data-edge={edge}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            startResize(edge);
          }}
          className={`fixed z-50 ${place}`}
        />
      ))}
    </div>
  );
}
