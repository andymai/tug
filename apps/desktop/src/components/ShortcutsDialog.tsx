import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { KEYMAP } from "../lib/commands";
import { useDownloads } from "../state/context";
import { Button } from "./Button";
import { Keys } from "./Kbd";

export function ShortcutsDialog() {
  const open = useDownloads((s) => s.overlay === "shortcuts");
  const setOverlay = useDownloads((s) => s.setOverlay);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) setOverlay(null);
      }}
      className="m-auto w-[min(480px,calc(100vw-48px))] rounded-lg border border-line bg-surface-raised p-6 text-ink shadow-dialog outline-none"
    >
      {open && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-heading text-ink">
              Keyboard shortcuts
            </h2>
            <Button
              variant="quiet"
              size="icon"
              icon={X}
              aria-label="Close"
              onClick={() => {
                setOverlay(null);
              }}
            />
          </div>
          {KEYMAP.map(({ group, entries }) => (
            <section key={group} aria-label={group} className="flex flex-col gap-1.5">
              <h3 className="text-label text-ink-muted">{group}</h3>
              <dl className="flex flex-col gap-1">
                {entries.map((entry) => (
                  <div key={entry.title} className="flex h-7 items-center justify-between gap-4 text-body">
                    <dt className="text-ink">{entry.title}</dt>
                    <dd>
                      <Keys label={entry.label} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </dialog>
  );
}
