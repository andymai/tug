import { CircleAlert, CopyCheck, Link, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, type SubmitEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { shortDir, sentence } from "../lib/format";
import { checkLinks, type LinkCheck } from "../lib/links";
import { ICON, STATES } from "../lib/states";
import { useDownloads } from "../state/context";
import { Button } from "./Button";

function describe(check: LinkCheck): { Icon: LucideIcon; tone: string; title: string; detail: string } {
  switch (check.kind) {
    case "ready":
      return { Icon: Link, tone: "text-ink-muted", title: check.name, detail: check.host };
    case "duplicate":
      return {
        Icon: CopyCheck,
        tone: "text-ink-muted",
        title: check.name,
        detail: `Already in your list · ${STATES[check.existing.state].word}`,
      };
    case "scheme":
      return { Icon: CircleAlert, tone: "text-state-error", title: check.input, detail: `Tug can't download ${check.scheme} links` };
    case "notLink":
      return { Icon: CircleAlert, tone: "text-state-error", title: check.input, detail: "Not a link" };
  }
}

function AddForm({ titleId }: { titleId: string }) {
  const adding = useDownloads((s) => s.adding);
  const items = useDownloads((s) => s.items);
  const downloadDir = useDownloads((s) => s.settings?.downloadDir ?? null);
  const setAddText = useDownloads((s) => s.setAddText);
  const closeAdd = useDownloads((s) => s.closeAdd);
  const addLinks = useDownloads((s) => s.addLinks);
  const [again, setAgain] = useState(false);
  const fieldId = useId();

  const checks = useMemo(() => checkLinks(adding.text, items), [adding.text, items]);
  const duplicates = checks.filter((check) => check.kind === "duplicate");
  const hrefs = checks.flatMap((check) =>
    check.kind === "ready" || (check.kind === "duplicate" && again) ? [check.href] : [],
  );
  const label = hrefs.length > 1 ? `Add ${String(hrefs.length)} links` : "Add";

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hrefs.length > 0 && !adding.busy) void addLinks(hrefs);
  };

  const submitOnCtrlEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 id={titleId} className="text-heading text-ink">
        Add downloads
      </h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-label text-ink-muted">
          Links
        </label>
        <textarea
          id={fieldId}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take a link
          autoFocus
          rows={4}
          spellCheck={false}
          readOnly={adding.busy}
          value={adding.text}
          placeholder="Paste one link per line"
          onChange={(event) => {
            setAddText(event.target.value);
          }}
          onKeyDown={submitOnCtrlEnter}
          className="resize-none rounded-sm border border-control-border bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-faint"
        />
      </div>
      {checks.length > 0 && (
        <ul aria-label="Links found" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {checks.map((check) => {
            const { Icon, tone, title, detail } = describe(check);
            return (
              <li key={check.input} className="flex min-w-0 items-center gap-2 text-small">
                <Icon {...ICON} className={`shrink-0 ${tone}`} />
                <span className="truncate text-ink">{title}</span>
                <span className="shrink-0 text-ink-muted">· {detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      {duplicates.length > 0 && (
        <label className="flex items-center gap-2 text-small text-ink">
          <input
            type="checkbox"
            checked={again}
            onChange={(event) => {
              setAgain(event.target.checked);
            }}
            className="size-4 accent-primary"
          />
          {duplicates.length === 1 ? "Download it again" : "Download them again"}
        </label>
      )}
      {adding.error !== null && (
        <p role="alert" className="flex items-center gap-2 text-small text-ink">
          <CircleAlert {...ICON} className="shrink-0 text-state-error" />
          {sentence(adding.error)}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-small text-ink-muted">
          {downloadDir !== null && `Saves to ${shortDir(downloadDir)}`}
        </p>
        <div className="flex gap-2">
          <Button onClick={closeAdd}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={hrefs.length === 0 || adding.busy}>
            {label}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function AddDialog() {
  const open = useDownloads((s) => s.adding.open);
  const closeAdd = useDownloads((s) => s.closeAdd);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) closeAdd();
      }}
      className="m-auto w-[min(560px,calc(100vw-48px))] rounded-lg border border-line bg-surface-raised p-6 text-ink shadow-dialog"
    >
      {open && <AddForm titleId={titleId} />}
    </dialog>
  );
}
