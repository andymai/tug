import { type SubmitEvent, useEffect, useId, useRef, useState } from "react";

import { focusRow } from "../lib/dom";
import { useDownloads } from "../state/context";
import { Button } from "./Button";

function RemoveForm({ ids, titleId }: { ids: readonly number[]; titleId: string }) {
  const items = useDownloads((s) => s.items);
  const cancel = useDownloads((s) => s.cancelRemove);
  const removeMany = useDownloads((s) => s.removeMany);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const one = ids.length === 1 ? items.find((item) => item.id === ids[0]) : undefined;
  const running = items.some((item) => ids.includes(item.id) && item.state === "downloading");

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const [first] = ids;
    void removeMany(ids, deleteFiles).then(() => {
      if (first !== undefined) focusRow(first);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 id={titleId} className="text-heading [overflow-wrap:anywhere] text-ink">
        {one === undefined ? `Remove ${String(ids.length)} downloads?` : `Remove ${one.name}?`}
      </h2>
      <p className="text-body text-ink-muted">
        {one === undefined
          ? running
            ? "Tug stops the running ones and takes them all off the list."
            : "Tug takes them off the list."
          : running
            ? "Tug stops it and takes it off the list."
            : "Tug takes it off the list."}
      </p>
      <label className="flex items-center gap-2 text-small text-ink">
        <input
          type="checkbox"
          checked={deleteFiles}
          onChange={(event) => {
            setDeleteFiles(event.target.checked);
          }}
          className="size-4 accent-primary"
        />
        {one === undefined ? "Delete their files too" : "Delete its file too"}
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={cancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Remove
        </Button>
      </div>
    </form>
  );
}

export function RemoveDialog() {
  const ids = useDownloads((s) => s.removing);
  const cancel = useDownloads((s) => s.cancelRemove);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = ids !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Delete, then Enter, removes; showModal alone gives the checkbox the focus.
      dialog.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) cancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-48px))] rounded-lg border border-line bg-surface-raised p-6 text-ink shadow-dialog"
    >
      {ids !== null && <RemoveForm key={ids.join(",")} ids={ids} titleId={titleId} />}
    </dialog>
  );
}
