export function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
}

export function focusRow(id: number) {
  const row = document.querySelector<HTMLElement>(`[data-download="${String(id)}"]`);
  (row ?? document.getElementById("list-title"))?.focus();
}

// The data type of a drag of rows in the queue, which the link drop zone leaves alone.
export const ROW_DRAG = "application/x-tug-downloads";
