import { useEffect, useState } from "react";

import { editable } from "../lib/dom";
import { findLinks, linksFromTransfer } from "../lib/links";
import { useDownloads } from "../state/context";

function carriesText(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("text/uri-list") || types.includes("text/plain");
}

export function LinkCapture() {
  const openAdd = useDownloads((s) => s.openAdd);
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;

    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return;
      const links = findLinks(event.clipboardData?.getData("text/plain") ?? "");
      if (links.length === 0) return;
      event.preventDefault();
      openAdd(links.join("\n"));
    };

    const onDragEnter = (event: DragEvent) => {
      if (!carriesText(event)) return;
      depth += 1;
      setOver(true);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!carriesText(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };

    const onDragOver = (event: DragEvent) => {
      if (!carriesText(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!event.dataTransfer || !carriesText(event)) return;
      event.preventDefault();
      const links = linksFromTransfer(event.dataTransfer);
      if (links.length > 0) openAdd(links.join("\n"));
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openAdd]);

  if (!over) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-2 z-10 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-surface/85"
    >
      <p className="text-heading text-ink">Drop to add</p>
    </div>
  );
}
