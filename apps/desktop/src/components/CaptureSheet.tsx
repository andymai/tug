import { FileDown } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import type { Download } from "../backend/backend";
import { formatBytes, shortDir } from "../lib/format";
import { ICON } from "../lib/states";
import { useDownloads } from "../state/context";
import { Button } from "./Button";

function hostOf(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

function Ask({ capture, count, titleId }: { capture: Download; count: number; titleId: string }) {
  const answer = useDownloads((s) => s.answerCapture);
  const asking = useDownloads((s) => s.settings?.confirmCaptures ?? true);
  const saveSettings = useDownloads((s) => s.saveSettings);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-heading text-ink">
          Download this file?
        </h2>
        {count > 1 && <span className="shrink-0 text-small text-ink-muted">1 of {count}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
        <FileDown {...ICON} className="shrink-0 text-ink-muted" />
        <div className="min-w-0">
          <p className="truncate text-body-strong text-ink" title={capture.name}>
            {capture.name}
          </p>
          <p className="truncate text-small text-ink-muted">
            {hostOf(capture.url)}
            {capture.size !== null && ` · ${formatBytes(capture.size)}`}
          </p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-small text-ink">
        <input
          type="checkbox"
          checked={asking}
          onChange={(event) => {
            void saveSettings({ confirmCaptures: event.target.checked });
          }}
          className="size-4 accent-primary"
        />
        Ask before each browser download
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-small text-ink-muted">Saves to {shortDir(capture.dir)}</p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              void answer(capture.id, "cancel");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            data-answer="download"
            onClick={() => {
              void answer(capture.id, "download");
            }}
          >
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CaptureSheet() {
  const captures = useDownloads((s) => s.captures);
  const answer = useDownloads((s) => s.answerCapture);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const first = captures[0];
  const shown = first?.id;

  // showModal focuses the first control, the checkbox; each capture starts on Download instead.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (shown !== undefined && !dialog.open) dialog.showModal();
    if (shown !== undefined) dialog.querySelector<HTMLElement>("[data-answer='download']")?.focus();
    if (shown === undefined && dialog.open) dialog.close();
  }, [shown]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (first) void answer(first.id, "later");
      }}
      className="m-auto w-[min(480px,calc(100vw-48px))] rounded-lg border border-line bg-surface-raised p-6 text-ink shadow-dialog"
    >
      {first && <Ask key={first.id} capture={first} count={captures.length} titleId={titleId} />}
    </dialog>
  );
}
